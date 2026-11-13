import * as vscode from 'vscode';
import { buildWebviewHtml } from '../common/webview';

const VIEW_TYPE = 'docbench.html';
const DEBOUNCE_MS = 300;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** CSP applied to the previewed page itself (it is additionally sandboxed in an iframe). */
function pageCsp(cspSource: string): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `media-src ${cspSource}`,
  ].join('; ');
}

/**
 * With a <base href>, "#fragment" links resolve against the base and would navigate the srcdoc
 * frame away from the preview. This tiny script keeps in-page anchors scrolling in place.
 */
const ANCHOR_FIX =
  `<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href^="#"]');` +
  `if(!a)return;e.preventDefault();var id=decodeURIComponent(a.getAttribute('href').slice(1));` +
  `var t=id?(document.getElementById(id)||document.getElementsByName(id)[0]):document.documentElement;if(t)t.scrollIntoView();});</script>`;

/** Injects <base> + CSP <meta> at the top of <head> (creating one if needed). */
export function prepareDocument(text: string, baseHref: string, cspSource: string): string {
  const inject =
    `<base href="${escapeAttr(baseHref)}">` +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(pageCsp(cspSource))}">` +
    ANCHOR_FIX;
  const head = /<head(\s[^>]*)?>/i.exec(text);
  if (head) {
    const at = head.index + head[0].length;
    return text.slice(0, at) + inject + text.slice(at);
  }
  const html = /<html(\s[^>]*)?>/i.exec(text);
  if (html) {
    const at = html.index + html[0].length;
    return text.slice(0, at) + `<head>${inject}</head>` + text.slice(at);
  }
  // Keep a leading doctype first so the page does not fall into quirks mode.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
  const at = doctype ? doctype[0].length : 0;
  return text.slice(0, at) + `<head>${inject}</head>` + text.slice(at);
}

/**
 * The previewed page lives in a srcdoc iframe, and srcdoc documents INHERIT the embedding
 * document's CSP (CSP3 "local scheme" inheritance). The strict nonce-only shell policy would
 * therefore block the user's own scripts (and 'unsafe-inline' is ignored once a nonce is
 * present). So for this viewer only, the shell's script-src/img-src are rewritten to what the
 * preview needs. The shell itself still contains no inline script and no user markup (the
 * HTML is assigned via the iframe's srcdoc property, never parsed into the shell), and the
 * preview stays sandboxed (allow-scripts only: opaque origin, no top navigation, no forms,
 * no popups) with connect-src limited to webview resources.
 * frame-src 'about:' is added defensively; srcdoc loads are not subject to it in Chromium.
 */
function relaxShellCsp(html: string, cspSource: string): string {
  return html
    .replace(/script-src [^;"]*/, `script-src ${cspSource} 'unsafe-inline'`)
    .replace(/img-src [^;"]*/, `img-src ${cspSource} data: blob:`)
    .replace(/(content="[^"]*)"/, `$1; frame-src about:"`);
}

/*
 * Local resources (relative CSS / JS / images) are inlined by the host. The preview frame is a
 * sandboxed srcdoc iframe, and VS Code's webview service worker only serves vscode-resource
 * requests for the top-level webview document (it resolves the webview id from the client URL,
 * which is "about:srcdoc" here, and sandboxed frames are not service-worker controlled at all).
 * So asWebviewUri references inside the frame would not resolve; reading through workspace.fs does.
 */
const MAX_RESOURCE = 10 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
const TOKEN =
  /<!--[\s\S]*?-->|<(script)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>|<(style)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/style\s*>|<([a-zA-Z][a-zA-Z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

interface InlineCtx {
  roots: vscode.Uri[];
  used: number;
}

function isLocalRef(ref: string): boolean {
  const r = ref.trim();
  return r !== '' && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(r);
}

function within(uri: vscode.Uri, roots: vscode.Uri[]): boolean {
  return roots.some((r) => {
    const base = r.path.replace(/\/?$/, '/');
    return uri.scheme === r.scheme && uri.authority === r.authority && (uri.path === r.path || uri.path.startsWith(base));
  });
}

function findAttr(attrs: string, name: string): { raw: string; ws: string; value: string } | undefined {
  const m = new RegExp(`(\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? { raw: m[0], ws: m[1], value: m[2] ?? m[3] ?? m[4] ?? '' } : undefined;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x4000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  }
  return btoa(bin);
}

async function readLocal(
  ctx: InlineCtx,
  base: vscode.Uri,
  ref: string,
): Promise<{ uri: vscode.Uri; bytes: Uint8Array } | undefined> {
  try {
    const clean = ref.trim().split(/[?#]/)[0];
    if (!clean) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(base, ...decodeURIComponent(clean).split('/'));
    if (!within(uri, ctx.roots)) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_RESOURCE || ctx.used + bytes.byteLength > MAX_TOTAL) {
      return undefined;
    }
    ctx.used += bytes.byteLength;
    return { uri, bytes };
  } catch {
    return undefined;
  }
}

async function toDataUri(ctx: InlineCtx, base: vscode.Uri, ref: string): Promise<string | undefined> {
  const res = await readLocal(ctx, base, ref);
  if (!res) {
    return undefined;
  }
  const ext = /\.([a-z0-9]+)$/i.exec(res.uri.path)?.[1].toLowerCase() ?? '';
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${toBase64(res.bytes)}`;
}

/** Rewrites local url(...) references in CSS to data: URIs (unquoted, so it is attribute-safe). */
async function inlineCssUrls(css: string, base: vscode.Uri, ctx: InlineCtx): Promise<string> {
  let out = '';
  let last = 0;
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)/gi)) {
    const start = m.index ?? 0;
    const ref = m[1] ?? m[2] ?? m[3] ?? '';
    out += css.slice(last, start);
    last = start + m[0].length;
    const data = isLocalRef(ref) ? await toDataUri(ctx, base, ref) : undefined;
    out += data ? `url(${data})` : m[0];
  }
  return out + css.slice(last);
}

async function rewriteToken(m: RegExpMatchArray, dir: vscode.Uri, ctx: InlineCtx): Promise<string> {
  const whole = m[0];
  if (m[1]) {
    const src = findAttr(m[2], 'src');
    if (src && isLocalRef(src.value)) {
      const res = await readLocal(ctx, dir, src.value);
      if (res) {
        const code = new TextDecoder().decode(res.bytes).replace(/<\/(script)/gi, '<\\/$1');
        return `<script${m[2].replace(src.raw, '')}>${code}</script>`;
      }
    }
    return whole;
  }
  if (m[4]) {
    return `<style${m[5]}>${await inlineCssUrls(m[6], dir, ctx)}</style>`;
  }
  if (!m[7]) {
    return whole; // comment
  }
  const name = m[7].toLowerCase();
  const attrs = m[8];
  let out = whole;
  if (name === 'link') {
    const rel = findAttr(attrs, 'rel');
    const href = findAttr(attrs, 'href');
    if (rel && /\bstylesheet\b/i.test(rel.value) && href && isLocalRef(href.value)) {
      const res = await readLocal(ctx, dir, href.value);
      if (res) {
        const css = await inlineCssUrls(new TextDecoder().decode(res.bytes), vscode.Uri.joinPath(res.uri, '..'), ctx);
        const media = findAttr(attrs, 'media');
        return `<style${media ? ` media="${escapeAttr(media.value)}"` : ''}>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>`;
      }
    }
  } else if (name === 'img') {
    const src = findAttr(attrs, 'src');
    if (src && isLocalRef(src.value)) {
      const data = await toDataUri(ctx, dir, src.value);
      if (data) {
        out = out.replace(src.raw, () => `${src.ws}src="${data}"`);
      }
    }
  }
  const style = findAttr(attrs, 'style');
  if (style && /url\(/i.test(style.value)) {
    const css = await inlineCssUrls(style.value, dir, ctx);
    out = out.replace(style.raw, () => `${style.ws}style="${css.replace(/"/g, '&quot;')}"`);
  }
  return out;
}

/** Inlines local stylesheets, scripts and images (within `roots`) so the sandboxed frame needs no resource access. */
export async function inlineResources(text: string, dir: vscode.Uri, roots: vscode.Uri[]): Promise<string> {
  const ctx: InlineCtx = { roots, used: 0 };
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    out += text.slice(last, start) + (await rewriteToken(m, dir, ctx));
    last = start + m[0].length;
  }
  return out + text.slice(last);
}

function parentDir(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..');
}

class HtmlPreviewProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    const dir = parentDir(document.uri);
    // Narrowest practical roots: this viewer's bundle, the html file's folder, and the
    // workspace folder containing it (so ../assets references resolve).
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'html'), dir];
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) {
      roots.push(folder.uri);
    }
    webview.options = { enableScripts: true, localResourceRoots: roots };

    const shell = buildWebviewHtml({
      webview,
      extensionUri: this.context.extensionUri,
      mediaName: 'html',
      title: 'HTML Preview',
      body: '<iframe id="preview" sandbox="" title="HTML preview"></iframe>',
    });
    webview.html = relaxShellCsp(shell, webview.cspSource);

    const baseHref = webview.asWebviewUri(dir).toString().replace(/\/?$/, '/');
    const inlineRoots = folder ? [dir, folder.uri] : [dir];
    let disposed = false;
    let seq = 0;
    const render = async () => {
      const mine = ++seq;
      const prepared = prepareDocument(document.getText(), baseHref, webview.cspSource);
      let html = prepared;
      try {
        html = await inlineResources(prepared, dir, inlineRoots);
      } catch {
        // fall back to the document without inlined resources
      }
      if (!disposed && mine === seq) {
        // Scripts inside the previewed page only run once the workspace is trusted.
        void webview.postMessage({ type: 'render', html, scripts: vscode.workspace.isTrusted });
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void render(), DEBOUNCE_MS);
    };
    const key = document.uri.toString();
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === key) {
        schedule();
      }
    });
    // Saving a linked stylesheet / script refreshes the preview too.
    const saveSub = vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.toString() !== key && within(d.uri, inlineRoots)) {
        schedule();
      }
    });
    const trustSub = vscode.workspace.onDidGrantWorkspaceTrust(() => void render());
    const msgSub = webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        void render();
      }
    });
    panel.onDidDispose(() => {
      disposed = true;
      clearTimeout(timer);
      changeSub.dispose();
      saveSub.dispose();
      trustSub.dispose();
      msgSub.dispose();
    });
  }
}

export function registerHtml(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = vscode.window.registerCustomEditorProvider(VIEW_TYPE, new HtmlPreviewProvider(context), {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  });
  // Reuses the custom text editor (same renderer) opened beside the source editor.
  const command = vscode.commands.registerCommand('docbench.openHtmlPreview', async (arg?: vscode.Uri) => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Beside);
  });
  return vscode.Disposable.from(provider, command);
}
