import * as vscode from 'vscode';
import { MAX_FILE_BYTES } from '../common/files';
import { buildWebviewHtml } from '../common/webview';

const VIEW_TYPE = 'docbench.markdown';
const MEDIA_NAME = 'markdown';

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
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    await vscode.workspace.fs.writeFile(target, bytes);
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
