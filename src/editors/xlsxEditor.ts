import * as vscode from 'vscode';
import { basename, extname, readFileGuarded } from '../common/files';
import { buildWebviewHtml, viewerWebviewOptions } from '../common/webview';

const VIEW_TYPE = 'docbench.xlsxEditor';
const MEDIA_NAME = 'xlsx-editor';
const SAVE_TIMEOUT_MS = 30_000;
const ACK_KEY = 'docbench.xlsxLossySaveAck';

/** Extensions whose saved container is rewritten by SheetJS (formatting is not preserved). */
const LOSSY_EXTS = new Set(['.xlsx', '.xlsm', '.xls', '.ods']);

interface SaveResult {
  data: Uint8Array;
  sheetCount: number;
}

interface Pending {
  resolve(r: SaveResult): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Document model. `content` is the last known on-disk (or backup) representation; the live,
 * edited workbook lives in the webview and is pulled on demand with `requestSave`.
 */
class XlsxDocument implements vscode.CustomDocument {
  /** Set once the user confirmed the lossy-save notice for this document. */
  acknowledged = false;
  dirty = false;

  constructor(
    readonly uri: vscode.Uri,
    public content: Uint8Array,
  ) {}

  dispose(): void {}
}

/** Normalises a typed array / ArrayBuffer / index-keyed object received from the webview. */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  if (v && typeof v === 'object') return Uint8Array.from(Object.values(v as Record<string, number>));
  throw new Error('The spreadsheet editor returned no file data.');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Editable spreadsheet provider.
 *
 * Edit model: CustomDocumentContentChangeEvent. The webview (x-data-spreadsheet) owns the
 * undo/redo history (Ctrl+Z / Ctrl+Y inside the grid or the toolbar buttons), so VS Code is only
 * told "the content changed" (dirty marker). A VS Code-level undo that returns to the saved state
 * therefore does not clear the dirty marker; that is the accepted trade-off for not keeping two
 * competing undo stacks.
 *
 * The editor is registered with retainContextWhenHidden: the unsaved workbook lives only in the
 * webview, so it must not be torn down when the tab is hidden.
 */
class XlsxEditorProvider implements vscode.CustomEditorProvider<XlsxDocument> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<XlsxDocument>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;

  private readonly panels = new Map<XlsxDocument, vscode.WebviewPanel>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void {
    this.changeEmitter.dispose();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Editor disposed.'));
    }
    this.pending.clear();
  }

  // --- document lifecycle -------------------------------------------------------------------

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
  ): Promise<XlsxDocument> {
    if (openContext.backupId) {
      // Hot-exit restore: the backup holds the unsaved workbook in the file's own format.
      const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId));
      const doc = new XlsxDocument(uri, data);
      doc.dirty = true;
      return doc;
    }
    const data = await readFileGuarded(uri);
    if (!data) {
      throw new Error(`"${basename(uri)}" is too large to open in the spreadsheet editor.`);
    }
    return new XlsxDocument(uri, data);
  }

  async resolveCustomEditor(doc: XlsxDocument, panel: vscode.WebviewPanel): Promise<void> {
    const { webview } = panel;
    this.panels.set(doc, panel);
    webview.options = viewerWebviewOptions(this.context.extensionUri, MEDIA_NAME);
    webview.html = buildWebviewHtml({
      webview,
      extensionUri: this.context.extensionUri,
      mediaName: MEDIA_NAME,
      title: basename(doc.uri),
    });

    const sendLoad = () =>
      webview.postMessage({
        type: 'load',
        fileName: basename(doc.uri),
        ext: extname(doc.uri),
        data: doc.content,
      });

    const sub = webview.onDidReceiveMessage((msg: { type?: string; [k: string]: unknown }) => {
      switch (msg?.type) {
        case 'ready':
          void sendLoad();
          break;
        case 'edit':
          doc.dirty = true;
          this.changeEmitter.fire({ document: doc });
          break;
        case 'saveData': {
          const p = this.take(msg.id);
          if (p) {
            try {
              p.resolve({ data: toBytes(msg.data), sheetCount: Number(msg.sheetCount) || 1 });
            } catch (e) {
              p.reject(e instanceof Error ? e : new Error(String(e)));
            }
          }
          break;
        }
        case 'saveError': {
          const p = this.take(msg.id);
          if (p) p.reject(new Error(String(msg.message)));
          break;
        }
      }
    });

    // Pick up external changes (git checkout, another tool) while the document has no unsaved edits.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(doc.uri, '..'), basename(doc.uri)),
    );
    const onDisk = watcher.onDidChange(async () => {
      if (doc.dirty) return;
      try {
        const data = await readFileGuarded(doc.uri);
        if (data && !sameBytes(data, doc.content)) {
          doc.content = data;
          void sendLoad();
        }
      } catch {
        // File may be mid-write or gone; the next change event retries.
      }
    });

    panel.onDidDispose(() => {
      this.panels.delete(doc);
      sub.dispose();
      onDisk.dispose();
      watcher.dispose();
    });
  }

  // --- save / revert / backup ---------------------------------------------------------------

  async saveCustomDocument(doc: XlsxDocument, token: vscode.CancellationToken): Promise<void> {
    await this.writeTo(doc, doc.uri, token);
    doc.dirty = false;
  }

  async saveCustomDocumentAs(
    doc: XlsxDocument,
    destination: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<void> {
    await this.writeTo(doc, destination, token);
  }

  async revertCustomDocument(doc: XlsxDocument, _token: vscode.CancellationToken): Promise<void> {
    const data = await readFileGuarded(doc.uri);
    if (!data) throw new Error(`"${basename(doc.uri)}" is too large to reload.`);
    doc.content = data;
    doc.dirty = false;
    void this.panels.get(doc)?.webview.postMessage({
      type: 'load',
      fileName: basename(doc.uri),
      ext: extname(doc.uri),
      data,
    });
  }

  async backupCustomDocument(
    doc: XlsxDocument,
    context: vscode.CustomDocumentBackupContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    const { data } = await this.requestBytes(doc, extname(doc.uri), token);
    await vscode.workspace.fs.writeFile(context.destination, data);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // Already removed.
        }
      },
    };
  }

  // --- helpers ------------------------------------------------------------------------------

  private async writeTo(doc: XlsxDocument, target: vscode.Uri, token: vscode.CancellationToken): Promise<void> {
    const ext = extname(target);
    const { data, sheetCount } = await this.requestBytes(doc, ext, token);
    await this.confirmLossy(doc, ext, sheetCount);
    const isSelf = target.toString() === doc.uri.toString();
    const previous = doc.content;
    // Set before writing so the file watcher recognises our own write as "no external change".
    if (isSelf) doc.content = data;
    try {
      await vscode.workspace.fs.writeFile(target, data);
    } catch (e) {
      if (isSelf) doc.content = previous;
      throw e;
    }
  }

  /**
   * One-time (per document, or forever via "don't ask again") notice that saving rewrites the file
   * with SheetJS Community Edition: values, formulas, merges, column widths and row heights are
   * kept; cell styling, charts, images and pivot tables are not.
   */
  private async confirmLossy(doc: XlsxDocument, ext: string, sheetCount: number): Promise<void> {
    const isCsv = ext === '.csv' || ext === '.tsv';
    const lines: string[] = [];
    if (isCsv) {
      if (sheetCount > 1) {
        lines.push(`This workbook has ${sheetCount} sheets. A ${ext} file holds one sheet, so only the first sheet is saved.`);
      }
    } else if (LOSSY_EXTS.has(ext)) {
      lines.push(
        'Saving rewrites the file with a community spreadsheet library: cell formatting (fonts, colors, borders, number formats you change), charts, images and pivot tables are not preserved. Values, formulas, merged cells, column widths and row heights are kept.',
      );
      if (ext === '.xlsm' || ext === '.xls') {
        lines.push('An existing VBA project is copied unchanged, but macros are not editable here.');
      }
    }
    if (lines.length === 0) return;
    const acked = this.context.globalState.get<boolean>(ACK_KEY, false) && !(isCsv && sheetCount > 1);
    if (doc.acknowledged || acked) return;

    const save = 'Save';
    const saveAlways = "Save and don't ask again";
    const choice = await vscode.window.showWarningMessage(
      `Docbench: ${lines.join(' ')}`,
      { modal: true },
      save,
      ...(isCsv ? [] : [saveAlways]),
    );
    if (!choice) throw new vscode.CancellationError();
    doc.acknowledged = true;
    if (choice === saveAlways) {
      await this.context.globalState.update(ACK_KEY, true);
    }
  }

  private take(id: unknown): Pending | undefined {
    const p = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id as number);
    }
    return p;
  }

  /** Asks the webview to serialise its current workbook as `ext`; falls back to the on-disk bytes. */
  private requestBytes(doc: XlsxDocument, ext: string, token: vscode.CancellationToken): Promise<SaveResult> {
    const panel = this.panels.get(doc);
    if (!panel) {
      return Promise.resolve({ data: doc.content, sheetCount: 1 });
    }
    return new Promise<SaveResult>((resolve, reject) => {
      const id = this.nextId++;
      let cancel: vscode.Disposable | undefined;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cancel?.dispose();
        reject(new Error('Timed out waiting for the spreadsheet editor to produce the file.'));
      }, SAVE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => (cancel?.dispose(), resolve(r)),
        reject: (e) => (cancel?.dispose(), reject(e)),
        timer,
      });
      cancel = token.onCancellationRequested(() => {
        const p = this.take(id);
        if (p) p.reject(new vscode.CancellationError());
      });
      void panel.webview.postMessage({ type: 'requestSave', id, ext });
    });
  }
}

export function registerXlsxEditor(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = new XlsxEditorProvider(context);
  const registration = vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  });
  return vscode.Disposable.from(registration, provider);
}
