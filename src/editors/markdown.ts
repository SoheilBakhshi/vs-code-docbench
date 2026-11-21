import * as vscode from 'vscode';
import { MAX_FILE_BYTES } from '../common/files';
import { buildWebviewHtml } from '../common/webview';

const VIEW_TYPE = 'docbench.markdown';
const MEDIA_NAME = 'markdown';
const OUTLINE_POSITION_KEY = 'docbench.markdown.outlinePosition';
const OUTLINE_WIDTH_KEY = 'docbench.markdown.outlineWidth';

/** Desktop-only PDF exporter, installed by extension.ts; absent in the web extension. */
export type PdfExporter = (docUri: vscode.Uri, html: string, extensionUri: vscode.Uri) => Promise<void>;
let pdfExporter: PdfExporter | undefined;
export function setPdfExporter(fn: PdfExporter): void {
  pdfExporter = fn;
}

/** Asks where to save, writes the .docx (base64 from the editor) and offers to open it. Desktop and web. */
async function saveDocx(docUri: vscode.Uri, base64: string): Promise<void> {
  const name = docUri.path.substring(docUri.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '') || 'document';
  const target = await vscode.window.showSaveDialog({
    title: 'Export Markdown to Word',
    saveLabel: 'Export Word',
    defaultUri: vscode.Uri.joinPath(docUri, '..', `${name}.docx`),
    filters: { 'Word document': ['docx'] },
  });
  if (!target) {
    return;
  }
  try {
    await vscode.workspace.fs.writeFile(target, fromBase64(base64));
  } catch (e) {
    void vscode.window.showErrorMessage(`Docbench: could not save the Word file (${e instanceof Error ? e.message : String(e)}).`);
    return;
  }
  const open = 'Open';
  const reveal = 'Show in Folder';
  const choice = await vscode.window.showInformationMessage(
    `Docbench: exported ${target.path.substring(target.path.lastIndexOf('/') + 1)}`,
    open,
    ...(target.scheme === 'file' ? [reveal] : []),
  );
  if (choice === open) {
    await vscode.commands.executeCommand('vscode.openWith', target, 'docbench.docx');
  } else if (choice === reveal) {
    await vscode.commands.executeCommand('revealFileInOS', target);
  }
}

const normEol = (s: string): string => s.replace(/\r\n?/g, '\n');

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
const baseName = (p: string): string => p.substring(p.lastIndexOf('/') + 1);
const isImage = (p: string): boolean => IMAGE_EXTS.includes(baseName(p).split('.').pop()?.toLowerCase() ?? '');

/** True when `uri` is `folder` itself or lies inside it. */
function isInside(folder: vscode.Uri, uri: vscode.Uri): boolean {
  if (folder.scheme !== uri.scheme || folder.authority !== uri.authority) {
    return false;
  }
  const base = folder.path.replace(/\/?$/, '/');
  const fold = (s: string) => (uri.scheme === 'file' ? s.toLowerCase() : s);
  return fold(uri.path).startsWith(fold(base));
}

/**
 * The link to put in the markdown: a path relative to the document's folder (forward slashes, URL-
 * escaped so spaces and brackets survive), or the full URI when no relative path exists.
 */
function linkTarget(dir: vscode.Uri | undefined, uri: vscode.Uri): string {
  if (!dir || dir.scheme !== uri.scheme || dir.authority !== uri.authority) {
    return uri.toString();
  }
  const fold = (s: string) => (uri.scheme === 'file' ? s.toLowerCase() : s);
  const from = dir.path.split('/').filter(Boolean);
  const to = uri.path.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && fold(from[i]) === fold(to[i])) {
    i++;
  }
  // Different Windows drives have nothing in common.
  if (i === 0 && uri.scheme === 'file') {
    return uri.toString();
  }
  const rel = [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
  return encodeURI(rel).replace(/[()#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `![name](path)` for images, `[name](path)` for any other file. */
function markdownLink(dir: vscode.Uri | undefined, uri: vscode.Uri): string {
  const name = decodeURIComponent(baseName(uri.path));
  const label = (isImage(uri.path) ? name.replace(/\.[^.]+$/, '') : name).replace(/[[\]\\]/g, '\\$&');
  return `${isImage(uri.path) ? '!' : ''}[${label}](${linkTarget(dir, uri)})`;
}

/** A file name in `dir` that does not exist yet: `name.png`, `name-1.png`, ... */
async function freeName(dir: vscode.Uri, name: string): Promise<vscode.Uri> {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_') || 'file';
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  for (let n = 0; ; n++) {
    const candidate = vscode.Uri.joinPath(dir, n === 0 ? safe : `${stem}-${n}${ext}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}

function fromBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * WYSIWYG markdown editor (vditor). The text document stays the source of truth: the webview
 * reports edits as full-document text and the host mirrors them into the TextDocument, so
 * undo/redo, save, dirty state and external changes all go through VS Code's normal text pipeline.
 */
class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  /** Open editors, so the export command can reach the one that is active. */
  private readonly panels = new Set<vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Asks the active editor to build a .docx; it answers with an `exportDocx` message (base64). */
  requestExportDocx(): void {
    const panel = [...this.panels].find((p) => p.active);
    if (!panel) {
      void vscode.window.showInformationMessage('Docbench: open a Markdown file in the Docbench editor first.');
      return;
    }
    void panel.webview.postMessage({ type: 'requestExportDocx' });
  }

  /** Asks the active editor for its rendered HTML; it answers with an `exportPdf` message. */
  requestExport(): void {
    const panel = [...this.panels].find((p) => p.active);
    if (!panel) {
      void vscode.window.showInformationMessage('Docbench: open a Markdown file in the Docbench editor first.');
      return;
    }
    void panel.webview.postMessage({ type: 'requestExport' });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const { webview } = panel;
    this.panels.add(panel);
    const { extensionUri } = this.context;
    // Images: the webview may read the media folder, the markdown file's own folder and the workspace
    // folder that contains it (so `../assets/x.png` works). Nothing else.
    const roots = [vscode.Uri.joinPath(extensionUri, 'media', MEDIA_NAME)];
    const dir = document.uri.scheme === 'untitled' ? undefined : vscode.Uri.joinPath(document.uri, '..');
    if (dir) {
      roots.push(dir);
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) {
      roots.push(folder.uri);
    }
    webview.options = { enableScripts: true, localResourceRoots: roots };
    // Vditor rewrites relative image / link paths against this base for display only; when the
    // document is saved Lute writes the original relative paths back unchanged.
    const linkBase = dir ? webview.asWebviewUri(dir).toString().replace(/\/?$/, '/') : '';
    // Remote (https) images are off by default so the editor makes no network requests on its own.
    const remoteImages = () =>
      vscode.workspace.isTrusted && vscode.workspace.getConfiguration('docbench').get<boolean>('markdown.loadRemoteImages', false);

    // Vditor expects `<cdn>/dist/<asset>`. esbuild.mjs copies vditor's dist folder to
    // media/markdown/vditor; support both that flat layout and a nested `.../dist` layout.
    const vditorDir = vscode.Uri.joinPath(extensionUri, 'media', MEDIA_NAME, 'vditor');
    const assetRoot = (await exists(vscode.Uri.joinPath(vditorDir, 'dist')))
      ? vscode.Uri.joinPath(vditorDir, 'dist')
      : vditorDir;
    const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, ...parts));

    const shell = () => buildWebviewHtml({
      webview,
      extensionUri,
      mediaName: MEDIA_NAME,
      title: 'Markdown',
      csp: remoteImages() ? { imgSrc: ['https:'] } : undefined,
      // Vditor lazy-loads these via runtime <script> tags, which the nonce-only CSP would block.
      // They are loaded here with the nonce instead; the bundle then marks them as already loaded.
      extraScripts: [
        asset('js', 'i18n', 'en_US.js'),
        asset('js', 'icons', 'ant.js'),
        asset('js', 'lute', 'lute.min.js'),
        // Renderers for Mermaid diagrams, KaTeX maths and code highlighting; loaded here with the nonce
        // because vditor would otherwise inject them as un-nonced <script> tags.
        asset('js', 'mermaid', 'mermaid.min.js'),
        asset('js', 'katex', 'katex.min.js'),
        asset('js', 'katex', 'mhchem.min.js'),
        asset('js', 'highlight.js', 'highlight.min.js'),
        asset('js', 'highlight.js', 'third-languages.js'),
      ],
      bodyData: {
        // Never a remote CDN: always the local webview URI.
        'vditor-cdn': webview.asWebviewUri(vditorDir).toString(),
        'vditor-root': asset().toString(),
        'link-base': linkBase,
        'remote-images': remoteImages() ? 'true' : 'false',
        // Where the user last put the outline pane, and how wide (remembered on this machine).
        'outline-position': this.context.globalState.get<string>(OUTLINE_POSITION_KEY) === 'left' ? 'left' : 'right',
        'outline-width': String(this.context.globalState.get<number>(OUTLINE_WIDTH_KEY) ?? ''),
      },
    });
    webview.html = shell();

    const docKey = document.uri.toString();
    // Last text known to be in sync between document and webview (EOL-normalised).
    let lastKnown: string | undefined;
    let applyingEdit = false;
    let ready = false;
    let queue: Promise<void> = Promise.resolve();

    const tooLarge = () => document.getText().length > MAX_FILE_BYTES;

    const pushToWebview = () => {
      if (!ready || applyingEdit) {
        return;
      }
      if (tooLarge()) {
        void webview.postMessage({ type: 'error', message: 'File is too large to edit in the Markdown editor.' });
        return;
      }
      const text = normEol(document.getText());
      if (text === lastKnown) {
        return;
      }
      lastKnown = text;
      void webview.postMessage({ type: 'update', text });
    };

    const applyEdit = async (text: string): Promise<void> => {
      if (normEol(document.getText()) === text) {
        return;
      }
      applyingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const full = new vscode.Range(0, 0, document.lineCount, 0);
        edit.replace(document.uri, document.validateRange(full), text);
        if (!(await vscode.workspace.applyEdit(edit))) {
          lastKnown = undefined;
          void vscode.window.showWarningMessage('Docbench: could not apply the Markdown edit to the document.');
        }
      } finally {
        // The change event for our own edit fires before applyEdit resolves, so it was
        // suppressed above; later events (undo/redo, external edits) are pushed normally.
        applyingEdit = false;
      }
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === docKey && e.contentChanges.length > 0) {
        pushToWebview();
      }
    });

    const msgSub = webview.onDidReceiveMessage((msg: { type?: string; text?: unknown; html?: unknown; data?: unknown; message?: unknown }) => {
      if (msg?.type === 'ready') {
        ready = true;
        lastKnown = undefined;
        pushToWebview();
      } else if (msg?.type === 'exportPdf' && typeof msg.html === 'string') {
        if (pdfExporter) {
          void pdfExporter(document.uri, msg.html, extensionUri);
        } else {
          void vscode.window.showInformationMessage('Docbench: PDF export is only available in the desktop version of VS Code.');
        }
      } else if (msg?.type === 'exportDocx' && typeof msg.data === 'string') {
        void saveDocx(document.uri, msg.data);
      } else if (msg?.type === 'exportDocxFailed') {
        void vscode.window.showErrorMessage(`Docbench: Word export failed. ${String(msg.message ?? '')}`);
      } else if (msg?.type === 'enableRemoteImages') {
        void enableRemoteImages();
      } else if (msg?.type === 'outlineLayout') {
        const layout = msg as { position?: unknown; width?: unknown };
        void this.context.globalState.update(OUTLINE_POSITION_KEY, layout.position === 'left' ? 'left' : 'right');
        if (typeof layout.width === 'number' && layout.width >= 100 && layout.width <= 4000) {
          void this.context.globalState.update(OUTLINE_WIDTH_KEY, Math.round(layout.width));
        }
      } else if (msg?.type === 'pickImage') {
        void pickImage();
      } else if (msg?.type === 'dropFiles') {
        void dropFiles(msg as { uris?: unknown; files?: unknown; tooBig?: unknown });
      } else if (msg?.type === 'edit' && typeof msg.text === 'string') {
        const text = normEol(msg.text);
        lastKnown = text;
        // Serialise edits so rapid messages apply in order.
        queue = queue.then(() => applyEdit(text)).catch((e) => {
          lastKnown = undefined;
          void vscode.window.showErrorMessage(`Docbench: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    });

    const insert = (links: string[]) => {
      if (links.length) {
        void webview.postMessage({ type: 'insertMarkdown', markdown: links.join(' ') });
      }
    };
    /** The editor can only show files in the document's folder or its workspace folder. */
    const visible = (uri: vscode.Uri) => (!!dir && isInside(dir, uri)) || (!!folder && isInside(folder.uri, uri));

    /** Copies files next to the document (never overwriting) and returns the new locations. */
    const copyNextToDocument = async (items: { name: string; bytes: () => Thenable<Uint8Array> }[]): Promise<vscode.Uri[]> => {
      if (!dir) {
        void vscode.window.showWarningMessage('Docbench: save the Markdown file first, so files can be added next to it.');
        return [];
      }
      const out: vscode.Uri[] = [];
      for (const item of items) {
        try {
          const target = await freeName(dir, item.name);
          await vscode.workspace.fs.writeFile(target, await item.bytes());
          out.push(target);
        } catch (e) {
          void vscode.window.showErrorMessage(`Docbench: could not add ${item.name} (${e instanceof Error ? e.message : String(e)}).`);
        }
      }
      return out;
    };

    // Ribbon "Insert image": pick image files and link them with a relative path. Images outside the
    // document's folder and workspace would not show in the editor, so offer to copy those next to it.
    const pickImage = async (): Promise<void> => {
      const picked = await vscode.window.showOpenDialog({
        title: 'Insert image',
        openLabel: 'Insert',
        canSelectMany: true,
        defaultUri: dir,
        filters: { Images: IMAGE_EXTS, 'All files': ['*'] },
      });
      if (!picked?.length) {
        return;
      }
      const outside = picked.filter((u) => !visible(u));
      let copied = new Map<string, vscode.Uri>();
      if (outside.length && dir) {
        const copy = 'Copy next to document';
        const choice = await vscode.window.showInformationMessage(
          outside.length === 1
            ? `${decodeURIComponent(baseName(outside[0].path))} is outside this document's folder and workspace, so the editor cannot show it.`
            : `${outside.length} images are outside this document's folder and workspace, so the editor cannot show them.`,
          { modal: true },
          copy,
          'Link anyway',
        );
        if (!choice) {
          return;
        }
        if (choice === copy) {
          const targets = await copyNextToDocument(
            outside.map((u) => ({ name: decodeURIComponent(baseName(u.path)), bytes: () => vscode.workspace.fs.readFile(u) })),
          );
          copied = new Map(outside.slice(0, targets.length).map((u, i) => [u.toString(), targets[i]]));
        }
      }
      insert(picked.map((u) => markdownLink(dir, copied.get(u.toString()) ?? u)));
    };

    // Shift+drag into the editor: Explorer items arrive as URIs and are linked where they are; files
    // from the operating system arrive as bytes and are copied next to the document first.
    const dropFiles = async (msg: { uris?: unknown; files?: unknown; tooBig?: unknown }): Promise<void> => {
      if (Array.isArray(msg.tooBig) && msg.tooBig.length) {
        void vscode.window.showWarningMessage(`Docbench: skipped files larger than 25 MB: ${msg.tooBig.map(String).join(', ')}.`);
      }
      if (Array.isArray(msg.uris)) {
        const uris: vscode.Uri[] = [];
        for (const raw of msg.uris) {
          try {
            uris.push(vscode.Uri.parse(String(raw), true));
          } catch {
            // not a URI: ignore
          }
        }
        insert(uris.map((u) => markdownLink(dir, u)));
        return;
      }
      if (Array.isArray(msg.files)) {
        const items = (msg.files as { name?: unknown; data?: unknown }[])
          .filter((f) => typeof f?.name === 'string' && typeof f?.data === 'string')
          .map((f) => ({ name: baseName(String(f.name).replace(/\\/g, '/')), bytes: async () => fromBase64(String(f.data)) }));
        insert((await copyNextToDocument(items)).map((u) => markdownLink(dir, u)));
      }
    };

    // The in-editor "Show images" button: turn the setting on (User settings); the change listener
    // below reloads the editor.
    const enableRemoteImages = async (): Promise<void> => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showInformationMessage('Docbench: trust this workspace to show images from the internet.');
        return;
      }
      try {
        await vscode.workspace
          .getConfiguration('docbench')
          .update('markdown.loadRemoteImages', true, vscode.ConfigurationTarget.Global);
      } catch (e) {
        void vscode.window.showErrorMessage(`Docbench: could not update the setting (${e instanceof Error ? e.message : String(e)}).`);
      }
    };

    // Turning remote images on or off reloads the editor (the text document is the source of truth).
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docbench.markdown.loadRemoteImages')) {
        ready = false;
        webview.html = shell();
      }
    });
    panel.onDidDispose(() => {
      this.panels.delete(panel);
      configSub.dispose();
      changeSub.dispose();
      msgSub.dispose();
    });
  }
}

export function registerMarkdown(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = new MarkdownEditorProvider(context);
  return vscode.Disposable.from(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('docbench.exportMarkdownPdf', () => provider.requestExport()),
    vscode.commands.registerCommand('docbench.exportMarkdownDocx', () => provider.requestExportDocx()),
  );
}
