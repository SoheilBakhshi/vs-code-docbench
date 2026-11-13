import type { Chart } from 'chart.js';
import * as XLSX from 'xlsx';
import { LoadMessage, showError, startViewer } from '../common/vscode';
import { ChartModel, extractCharts, renderCharts } from '../common/xlsxCharts';
import './index.css';

/** Max cells rendered per sheet; beyond this rows are cut and a notice is shown. */
const MAX_CELLS = 100000;

const app = document.getElementById('app') as HTMLElement;
let workbook: XLSX.WorkBook | undefined;
let activeSheet = 0;
let charts: ChartModel[] = [];
let chartInstances: Chart[] = [];
let loadToken = 0;

function readWorkbook(msg: LoadMessage): XLSX.WorkBook {
  const bytes = msg.data;
  if (msg.ext === '.csv' || msg.ext === '.tsv') {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    return XLSX.read(text, { type: 'string', raw: true, FS: msg.ext === '.tsv' ? '\t' : undefined });
  }
  return XLSX.read(bytes, { type: 'array' });
}

function renderSheet(ws: XLSX.WorkSheet): { table: HTMLTableElement; rows: number; cols: number; shown: number } {
  const table = document.createElement('table');
  const ref = ws['!ref'];
  if (!ref) {
    return { table, rows: 0, cols: 0, shown: 0 };
  }
  const range = XLSX.utils.decode_range(ref);
  const cols = range.e.c - range.s.c + 1;
  const totalRows = range.e.r - range.s.r + 1;
  const shown = Math.min(totalRows, Math.max(1, Math.floor(MAX_CELLS / cols)));
  const lastRow = range.s.r + shown - 1;

  // Merges: the anchor cell gets the spans, covered cells are skipped.
  const anchors = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const m of ws['!merges'] ?? []) {
    anchors.set(`${m.s.r},${m.s.c}`, { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 });
    for (let r = m.s.r; r <= Math.min(m.e.r, lastRow); r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) {
          covered.add(`${r},${c}`);
        }
      }
    }
  }

  const head = table.createTHead().insertRow();
  head.appendChild(document.createElement('th')).className = 'corner';
  for (let c = range.s.c; c <= range.e.c; c++) {
    const th = document.createElement('th');
    th.textContent = XLSX.utils.encode_col(c);
    head.appendChild(th);
  }

  const tbody = table.createTBody();
  for (let r = range.s.r; r <= lastRow; r++) {
    const tr = tbody.insertRow();
    const rh = document.createElement('th');
    rh.className = 'rownum';
    rh.textContent = String(r + 1);
    tr.appendChild(rh);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = `${r},${c}`;
      if (covered.has(key)) {
        continue;
      }
      const td = tr.insertCell();
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell) {
        // textContent only: cell content can never be interpreted as markup.
        td.textContent = cell.w ?? (cell.v === undefined || cell.v === null ? '' : String(cell.v));
        if (cell.t === 'n') {
          td.className = 'num';
        }
      }
      const span = anchors.get(key);
      if (span) {
        td.rowSpan = Math.min(span.rs, lastRow - r + 1);
        td.colSpan = span.cs;
      }
    }
  }
  return { table, rows: totalRows, cols, shown };
}

function render(): void {
  // showError() replaces the body; re-attach the app root so a reload after an error can display.
  if (!app.isConnected) {
    document.body.replaceChildren(app);
  }
  if (!workbook || workbook.SheetNames.length === 0) {
    showError('This workbook contains no sheets.');
    return;
  }
  for (const c of chartInstances) {
    c.destroy();
  }
  chartInstances = [];
  const names = workbook.SheetNames;
  const sheetCharts = charts.filter((c) => c.sheetName === names[activeSheet]);
  const { table, rows, cols, shown } = renderSheet(workbook.Sheets[names[activeSheet]]);

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  if (rows === 0 && sheetCharts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'This sheet is empty.';
    scroller.appendChild(empty);
  } else if (rows > 0) {
    scroller.appendChild(table);
  }
  const chartsEl = document.createElement('div');
  chartsEl.className = 'charts';
  if (sheetCharts.length) {
    const heading = document.createElement('div');
    heading.className = 'charts-heading';
    heading.textContent = `Charts (${sheetCharts.length})`;
    scroller.append(heading, chartsEl);
  }

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = i === activeSheet ? `Sheet "${name}" (currently shown)` : `Switch to sheet "${name}"`;
    b.setAttribute('aria-label', b.title);
    b.className = i === activeSheet ? 'tab active' : 'tab';
    b.addEventListener('click', () => {
      activeSheet = i;
      render();
    });
    tabs.appendChild(b);
  });

  const status = document.createElement('div');
  status.className = 'status';
  const info = document.createElement('span');
  info.textContent = `${names[activeSheet]} — ${rows} rows × ${cols} cols${sheetCharts.length ? ` · ${sheetCharts.length} chart${sheetCharts.length === 1 ? '' : 's'}` : ''}`;
  status.appendChild(info);
  if (shown < rows) {
    const t = document.createElement('span');
    t.className = 'truncated';
    t.textContent = `Truncated: showing first ${shown} of ${rows} rows`;
    status.appendChild(t);
  }

  app.replaceChildren(scroller, tabs, status);
  chartInstances = renderCharts(chartsEl, sheetCharts);
}

startViewer((msg) => {
  try {
    workbook = readWorkbook(msg);
    charts = [];
    if (activeSheet >= workbook.SheetNames.length) {
      activeSheet = 0;
    }
    render();
    // Charts are not part of SheetJS's output: read them from the package and re-render.
    const token = ++loadToken;
    const wb = workbook;
    extractCharts(msg.data, wb)
      .then((found) => {
        if (token === loadToken && found.length) {
          charts = found;
          render();
        }
      })
      .catch((err) => console.warn('Docbench: could not read charts', err));
  } catch (e) {
    showError(`Failed to parse spreadsheet: ${e instanceof Error ? e.message : String(e)}`);
  }
});
