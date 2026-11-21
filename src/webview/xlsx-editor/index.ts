// Editable spreadsheet webview: x-data-spreadsheet UI on top of SheetJS (community edition).
// Protocol (see src/editors/xlsxEditor.ts):
//   webview -> host: ready | edit | saveData { id, data, sheetCount } | saveError { id, message }
//   host -> webview: load { fileName, ext, data } | requestSave { id, ext }
// The UI bundle is the prebuilt dist script (the package entry imports .less, which esbuild cannot
// bundle); it registers window.x_spreadsheet.
import 'x-data-spreadsheet/dist/xspreadsheet.js';
import 'x-data-spreadsheet/dist/xspreadsheet.css';
import type Spreadsheet from 'x-data-spreadsheet';
import * as XLSX from 'xlsx';
import { LoadMessage, showError, startViewer, vscodeApi } from '../common/vscode';
import { countCharts } from '../common/xlsxCharts';
import {
  CsvInfo,
  XSheet,
  bookTypeForExt,
  csvToSheet,
  parseCsv,
  sheetToCsv,
  sheetsToWorkbook,
  workbookToSheets,
} from './convert';
import './index.css';

interface SaveRequest {
  type: 'requestSave';
  id: number;
  ext: string;
}

const app = document.getElementById('app') as HTMLElement;
let sheet: Spreadsheet | undefined;
/** True while loadData runs, so programmatic changes are not reported as user edits. */
let loading = false;
let sourceExt = '';
let csvInfo: CsvInfo | undefined;
/** Raw VBA project of the loaded workbook (xlsm / xls); written back when the target type matches. */
let vbaraw: unknown;
let lastSignature = '';

function currentSheets(): XSheet[] {
  return (sheet ? sheet.getData() : []) as XSheet[];
}

const signature = () => JSON.stringify(currentSheets().map((s) => s.name));

function notifyEdit(): void {
  if (!loading) vscodeApi.postMessage({ type: 'edit' });
}

function ensureSheet(): Spreadsheet {
  if (sheet) return sheet;
  const create = (window as unknown as {
    x_spreadsheet: (el: HTMLElement, opts: object) => Spreadsheet;
  }).x_spreadsheet;
  sheet = create(app, {
    mode: 'edit',
    showToolbar: true,
    showGrid: true,
    showContextmenu: true,
    showBottomBar: true,
    view: { height: () => app.clientHeight, width: () => app.clientWidth },
  });
  sheet.change(notifyEdit);

  // Undo / redo restore a snapshot without firing `change`; report them so that undoing after a
  // save still marks the document dirty.
  const inner = (sheet as unknown as {
    sheet: { data: { canUndo(): boolean; canRedo(): boolean }; undo(): void; redo(): void };
  }).sheet;
  const undo = inner.undo.bind(inner);
  const redo = inner.redo.bind(inner);
  inner.undo = () => {
    const can = inner.data.canUndo();
    undo();
    if (can) notifyEdit();
  };
  inner.redo = () => {
    const can = inner.data.canRedo();
    redo();
    if (can) notifyEdit();
  };

  // Adding / renaming / deleting sheets does not fire `change`; watch the bottom bar for it.
  const bar = app.querySelector('.x-spreadsheet-bottombar');
  if (bar) {
    new MutationObserver(() => {
      if (loading) return;
      const sig = signature();
      if (sig !== lastSignature) {
        lastSignature = sig;
        notifyEdit();
      }
    }).observe(bar, { childList: true, subtree: true });
  }
  return sheet;
}

function showBanner(message: string): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;top:0;left:0;right:0;z-index:100;padding:8px 16px;background:var(--vscode-inputValidation-errorBackground,#5a1d1d);color:var(--vscode-errorForeground,#f55);font-family:var(--vscode-font-family)';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 10_000);
}

/** Persistent (dismissible) notice: charts are neither shown in the grid nor kept by a SheetJS save. */
function showChartNotice(count: number): void {
  document.getElementById('chart-notice')?.remove();
  const el = document.createElement('div');
  el.id = 'chart-notice';
  el.style.cssText =
    'position:absolute;bottom:0;left:0;right:0;z-index:200;display:flex;gap:12px;align-items:center;padding:8px 16px;' +
    'background:var(--vscode-inputValidation-warningBackground,#352a05);color:var(--vscode-foreground);' +
    'border-top:1px solid var(--vscode-inputValidation-warningBorder,#b89500);font-family:var(--vscode-font-family)';
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent =
    `This workbook contains ${count} chart${count === 1 ? '' : 's'}. They are not shown in the editor and will be removed if you save. ` +
    'To see them, right-click the file and choose "Open in Docbench".';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Dismiss';
  close.title = 'Hide this notice';
  close.addEventListener('click', () => el.remove());
  el.append(text, close);
  document.body.appendChild(el);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return (i > 0 ? fileName.slice(0, i) : fileName).slice(0, 31) || 'Sheet1';
}

function load(msg: LoadMessage): void {
  sourceExt = msg.ext.toLowerCase();
  csvInfo = undefined;
  vbaraw = undefined;

  let sheets: XSheet[];
  if (sourceExt === '.csv' || sourceExt === '.tsv') {
    const parsed = parseCsv(decode(msg.data), sourceExt === '.tsv' ? '\t' : undefined);
    csvInfo = parsed.info;
    sheets = [csvToSheet(baseName(msg.fileName), parsed.rows)];
  } else {
    // cellNF keeps number formats, cellStyles keeps column widths / row heights.
    const wb = XLSX.read(msg.data, { type: 'array', bookVBA: true, cellNF: true, cellStyles: true });
    vbaraw = (wb as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw;
    countCharts(msg.data)
      .then((n) => (n > 0 ? showChartNotice(n) : document.getElementById('chart-notice')?.remove()))
      .catch(() => undefined);
    sheets = workbookToSheets(wb);
    if (sheets.length === 0) sheets = [csvToSheet(baseName(msg.fileName), [])];
  }

  const ss = ensureSheet();
  loading = true;
  try {
    ss.loadData(sheets);
    lastSignature = signature();
  } finally {
    // Late change events from the load itself (if any) fire synchronously; release after a tick.
    setTimeout(() => {
      loading = false;
    }, 0);
  }
}

function serialize(ext: string): { data: Uint8Array; sheetCount: number } {
  const sheets = currentSheets();
  const e = ext.toLowerCase();
  if (e === '.csv' || e === '.tsv') {
    const info: CsvInfo = csvInfo
      ? { ...csvInfo, delimiter: e === '.tsv' ? '\t' : csvInfo.delimiter === '\t' ? ',' : csvInfo.delimiter }
      : { delimiter: e === '.tsv' ? '\t' : ',', eol: '\n', bom: false, trailingEol: true, width: 0 };
    return { data: new TextEncoder().encode(sheetToCsv(sheets[0], info)), sheetCount: sheets.length };
  }
  const bookType = bookTypeForExt(e);
  // Only reattach the VBA project when writing the same container type it came from.
  const keepVba = vbaraw && bookTypeForExt(sourceExt) === bookType ? vbaraw : undefined;
  const wb = sheetsToWorkbook(sheets, keepVba);
  const out = XLSX.write(wb, { type: 'array', bookType, bookVBA: !!keepVba }) as ArrayBuffer;
  return { data: new Uint8Array(out), sheetCount: sheets.length };
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as SaveRequest | undefined;
  if (msg?.type !== 'requestSave') return;
  try {
    const { data, sheetCount } = serialize(msg.ext);
    vscodeApi.postMessage({ type: 'saveData', id: msg.id, data, sheetCount });
  } catch (err) {
    vscodeApi.postMessage({ type: 'saveError', id: msg.id, message: String(err instanceof Error ? err.message : err) });
  }
});

startViewer(
  (msg) => {
    try {
      load(msg);
    } catch (err) {
      const message = `Could not open spreadsheet: ${err instanceof Error ? err.message : String(err)}`;
      // Once the grid exists (e.g. an external tool left a half-written file), keep it usable.
      if (sheet) showBanner(message);
      else showError(message);
    }
  },
  showError,
);
