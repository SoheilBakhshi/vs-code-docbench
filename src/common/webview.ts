import * as vscode from 'vscode';

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** Extra CSP sources a particular viewer needs on top of the strict defaults. */
export interface CspExtras {
  /** Appended to `worker-src` (defaults already allow webview resources and blob:). */
  workerSrc?: string[];
  /** Appended to `connect-src` (default: webview resources only). */
  connectSrc?: string[];
  /** Appended to `frame-src` (default: none). */
  frameSrc?: string[];
  /** Appended to `img-src` (default allows webview resources, data: and blob:). */
  imgSrc?: string[];
  /** Allow `'wasm-unsafe-eval'` in script-src. */
  wasm?: boolean;
}

export interface WebviewShellOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** Directory under `media/` holding this viewer's bundle (index.js / index.css). */
  mediaName: string;
  title: string;
  /** HTML placed inside <body> before the bundle script. Must not contain inline scripts. */
  body?: string;
  csp?: CspExtras;
  /** Extra data attributes on <body>, e.g. to hand URIs to the bundle. */
  bodyData?: Record<string, string>;
  /** Extra stylesheet / script URIs (already passed through asWebviewUri). */
  extraStyles?: vscode.Uri[];
  extraScripts?: vscode.Uri[];
  /** Load the bundle as an ES module instead of a classic script. */
  moduleScript?: boolean;
}

/** Webview options with `localResourceRoots` scoped to one viewer's media folder. */
export function viewerWebviewOptions(extensionUri: vscode.Uri, mediaName: string): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media', mediaName)],
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds the webview HTML shell: nonce-based CSP, bundle loaded via asWebviewUri. */
export function buildWebviewHtml(opts: WebviewShellOptions): string {
  const { webview, extensionUri, mediaName } = opts;
  const nonce = getNonce();
  const media = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', mediaName, file));
  const src = webview.cspSource;
  const extras = opts.csp ?? {};

  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'${extras.wasm ? " 'wasm-unsafe-eval'" : ''}`,
    // Libraries (docx-preview, x-spreadsheet, vditor) set inline styles; scripts stay nonce-only.
    `style-src ${src} 'unsafe-inline'`,
    `img-src ${src} data: blob:${extras.imgSrc?.length ? ' ' + extras.imgSrc.join(' ') : ''}`,
    `font-src ${src} data:`,
    `worker-src ${src} blob:${extras.workerSrc?.length ? ' ' + extras.workerSrc.join(' ') : ''}`,
    `connect-src ${src}${extras.connectSrc?.length ? ' ' + extras.connectSrc.join(' ') : ''}`,
    extras.frameSrc?.length ? `frame-src ${extras.frameSrc.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  const styles = [media('index.css'), ...(opts.extraStyles ?? [])]
    .map((u) => `<link rel="stylesheet" href="${u}">`)
    .join('\n');
  const scripts = [...(opts.extraScripts ?? []), media('index.js')]
    .map((u) => `<script nonce="${nonce}"${opts.moduleScript ? ' type="module"' : ''} src="${u}"></script>`)
    .join('\n');
  const data = Object.entries(opts.bodyData ?? {})
    .map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeAttr(opts.title)}</title>
${styles}
</head>
<body${data}>
${opts.body ?? '<div id="app"></div>'}
${scripts}
</body>
</html>`;
}
