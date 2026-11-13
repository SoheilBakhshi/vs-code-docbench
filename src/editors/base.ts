import * as vscode from 'vscode';
import { basename, extname, readFileGuarded } from '../common/files';
import { buildWebviewHtml, CspExtras, viewerWebviewOptions } from '../common/webview';

/** Host -> webview: `{ type: 'load', fileName, ext, data }`; webview -> host: `{ type: 'ready' }`. */
export interface LoadMessage {
  type: 'load';
  fileName: string;
  ext: string;
  data: Uint8Array;
}

/**
 * Base class for read-only binary viewers. The webview posts `{ type: 'ready' }` once its
 * bundle has booted; the host answers with a `load` message carrying the file bytes.
 * The file is re-sent when it changes on disk.
 */
export abstract class BinaryReadonlyEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(
    protected readonly context: vscode.ExtensionContext,
    /** Folder name under `media/` (and `src/webview/`). */
    protected readonly mediaName: string,
    protected readonly title: string,
  ) {}

  protected csp(): CspExtras | undefined {
    return undefined;
  }

  protected moduleScript(): boolean {
    return false;
  }

  /** Hook for viewer-specific messages (anything other than `ready`). */
  protected onMessage(
    _msg: { type: string; [k: string]: unknown },
    _doc: vscode.CustomDocument,
    _panel: vscode.WebviewPanel,
  ): void {}

  /** Hook to add extra body markup / bodyData for the shell. */
  protected shellExtras(_webview: vscode.Webview): { body?: string; bodyData?: Record<string, string> } {
    return {};
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(doc: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    const { webview } = panel;
    webview.options = viewerWebviewOptions(this.context.extensionUri, this.mediaName);
    webview.html = buildWebviewHtml({
      webview,
      extensionUri: this.context.extensionUri,
      mediaName: this.mediaName,
      title: this.title,
      csp: this.csp(),
      moduleScript: this.moduleScript(),
      ...this.shellExtras(webview),
    });

    const send = async () => {
      try {
        const data = await readFileGuarded(doc.uri);
        if (!data) {
          void webview.postMessage({ type: 'error', message: 'File is too large to display.' });
          return;
        }
        const msg: LoadMessage = { type: 'load', fileName: basename(doc.uri), ext: extname(doc.uri), data };
        void webview.postMessage(msg);
      } catch (e) {
        void webview.postMessage({ type: 'error', message: String(e instanceof Error ? e.message : e) });
      }
    };

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(doc.uri, '..'), basename(doc.uri)),
    );
    const sub = webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        void send();
      } else if (msg) {
        this.onMessage(msg, doc, panel);
      }
    });
    const reload = watcher.onDidChange(() => void send());
    panel.onDidDispose(() => {
      sub.dispose();
      reload.dispose();
      watcher.dispose();
    });
  }
}
