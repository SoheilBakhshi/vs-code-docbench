// Conversion between SheetJS workbooks / CSV text and the x-data-spreadsheet data model.
//
// x-spreadsheet only knows cell *text*. To keep number/date/string types stable across a
// load -> edit -> save round trip, cells whose type cannot be re-inferred from their text carry a
// hint `h` ({ o: original text, t, v, z }). On save the hint is honoured only while the text is
// still equal to `h.o`; once the user edits the cell, the type is inferred from the new text.
import * as XLSX from 'xlsx';

export interface CellHint {
  /** Text the cell had when the hint was created. */
  o: string;
  t: 's' | 'n' | 'b' | 'e';
  v: string | number | boolean;
  z?: string;
}

export interface XCell {
  text: string;
  merge?: [number, number];
  h?: CellHint;
  style?: number;
}

export interface XRow {
  cells: Record<string, XCell>;
  height?: number;
  hide?: boolean;
}

export interface XCol {
  width?: number;
  hide?: boolean;
}

export interface XSheet {
  name: string;
  freeze?: string;
  merges: string[];
  rows: { len?: number } & Record<string, XRow | number | undefined>;
  cols: { len?: number } & Record<string, XCol | number | undefined>;
  [extra: string]: unknown;
}

/** Minimal typing for the (untyped) SheetJS SSF module. */
interface DateCode {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
}
const SSF = (XLSX as unknown as {
  SSF: { is_date(fmt: string): boolean; parse_date_code(v: number): DateCode | null; get_table(): Record<number, string> };
}).SSF;

/** Number format of a cell as a format string (SheetJS may hold a built-in format id instead). */
function formatString(z: string | number | undefined): string | undefined {
  const s = typeof z === 'number' || (z !== undefined && /^\d+$/.test(z)) ? SSF.get_table()[Number(z)] : z;
  return s && s !== 'General' ? s : undefined;
}

const EXTRA_ROWS = 100;
const EXTRA_COLS = 10;
const MIN_ROWS = 100;
const MIN_COLS = 26;

// ---------------------------------------------------------------------------
// Type inference from cell text
// ---------------------------------------------------------------------------

const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const PCT_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)%$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

interface Inferred {
  t: 'n' | 'b';
  v: number | boolean;
  z?: string;
}

const EPOCH = Date.UTC(1899, 11, 30);

/** Returns the typed value text would be saved as, or undefined if it stays a string. */
export function infer(text: string): Inferred | undefined {
  if (NUM_RE.test(text)) {
    const v = Number(text);
    return Number.isFinite(v) ? { t: 'n', v } : undefined;
  }
  if (PCT_RE.test(text)) {
    const v = Number(text.slice(0, -1)) / 100;
    const decimals = /\.(\d+)%$/.exec(text)?.[1].length ?? 0;
    return Number.isFinite(v) ? { t: 'n', v, z: decimals ? '0.' + '0'.repeat(decimals) + '%' : '0%' } : undefined;
  }
  const u = text.toUpperCase();
  if (u === 'TRUE' || u === 'FALSE') {
    return { t: 'b', v: u === 'TRUE' };
  }
  const dm = DATE_RE.exec(text);
  if (dm) {
    const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
    const hh = dm[4] === undefined ? 0 : Number(dm[4]);
    const mi = dm[5] === undefined ? 0 : Number(dm[5]);
    const ss = dm[6] === undefined ? 0 : Number(dm[6]);
    const ms = Date.UTC(y, mo - 1, d, hh, mi, ss);
    const back = new Date(ms);
    // Round-trip check rejects 2024-02-31 etc. Years before 1901 sidestep Excel's 1900 leap-year bug.
    if (y < 1901 || hh > 23 || mi > 59 || ss > 59 || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
      return undefined;
    }
    return { t: 'n', v: (ms - EPOCH) / 86400000, z: dm[4] === undefined ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm:ss' };
  }
  const tm = TIME_RE.exec(text);
  if (tm) {
    const hh = Number(tm[1]);
    const mi = Number(tm[2]);
    const ss = tm[3] === undefined ? 0 : Number(tm[3]);
    if (hh > 23 || mi > 59 || ss > 59) return undefined;
    return { t: 'n', v: (hh * 3600 + mi * 60 + ss) / 86400, z: 'hh:mm:ss' };
  }
  return undefined;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function serialToText(v: number): string | undefined {
  const p = SSF.parse_date_code(v);
  if (!p) return undefined;
  const time = `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`;
  if (v >= 0 && v < 1) return time;
  const date = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
  return Number.isInteger(v) ? date : `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// Workbook -> x-spreadsheet
// ---------------------------------------------------------------------------

function cellToX(cell: XLSX.CellObject): XCell | undefined {
  const z = formatString(cell.z);

  if (typeof cell.f === 'string' && cell.f) {
    const text = '=' + cell.f;
    const out: XCell = { text };
    if (cell.v !== undefined && cell.v !== null && (cell.t === 's' || cell.t === 'n' || cell.t === 'b' || cell.t === 'e')) {
      out.h = { o: text, t: cell.t, v: cell.v as string | number | boolean, z };
    }
    return out;
  }

  switch (cell.t) {
    case 's': {
      const text = String(cell.v ?? '');
      if (text === '') return undefined;
      const out: XCell = { text };
      if (text.startsWith('=') || infer(text)) {
        out.h = { o: text, t: 's', v: text };
      }
      return out;
    }
    case 'n': {
      const v = Number(cell.v);
      if (!Number.isFinite(v)) return undefined;
      if (z && SSF.is_date(z)) {
        const text = serialToText(v);
        if (text !== undefined) return { text, h: { o: text, t: 'n', v, z } };
      }
      const text = String(v);
      const inf = infer(text);
      const out: XCell = { text };
      if (z || !inf || inf.v !== v) {
        out.h = { o: text, t: 'n', v, z };
      }
      return out;
    }
    case 'b': {
      const text = cell.v ? 'TRUE' : 'FALSE';
      return { text };
    }
    case 'e': {
      const text = cell.w ?? '#VALUE!';
      return { text, h: { o: text, t: 'e', v: cell.v as number } };
    }
    case 'd': {
      // Only produced when reading with cellDates, which we do not enable; keep it safe anyway.
      const text = cell.v instanceof Date ? cell.v.toISOString().slice(0, 19).replace('T', ' ') : String(cell.v);
      return { text };
    }
    default:
      return undefined;
  }
}

export function workbookToSheets(wb: XLSX.WorkBook): XSheet[] {
  return wb.SheetNames.map((name) => worksheetToSheet(name, wb.Sheets[name]));
}

function worksheetToSheet(name: string, ws: XLSX.WorkSheet | undefined): XSheet {
  const rows: XSheet['rows'] = {};
  const cols: XSheet['cols'] = {};
  const merges: string[] = [];
  let maxR = -1;
  let maxC = -1;

  if (ws) {
    for (const key of Object.keys(ws)) {
      if (key.charCodeAt(0) === 33 /* ! */) continue;
      const cell = ws[key] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const x = cellToX(cell);
      if (!x) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      const row = (rows[r] as XRow | undefined) ?? (rows[r] = { cells: {} });
      row.cells[c] = x;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }

    for (const m of ws['!merges'] ?? []) {
      if (m.s.r === m.e.r && m.s.c === m.e.c) continue;
      merges.push(XLSX.utils.encode_range(m));
      const row = (rows[m.s.r] as XRow | undefined) ?? (rows[m.s.r] = { cells: {} });
      const anchor = row.cells[m.s.c] ?? (row.cells[m.s.c] = { text: '' });
      anchor.merge = [m.e.r - m.s.r, m.e.c - m.s.c];
      if (m.e.r > maxR) maxR = m.e.r;
      if (m.e.c > maxC) maxC = m.e.c;
    }

    (ws['!cols'] ?? []).forEach((ci, c) => {
      if (!ci) return;
      const width = ci.wpx ?? (ci.wch !== undefined ? Math.round(ci.wch * 7 + 5) : ci.width !== undefined ? Math.round(ci.width * 7) : undefined);
      if (width === undefined && !ci.hidden) return;
      cols[c] = { ...(width !== undefined ? { width } : {}), ...(ci.hidden ? { hide: true } : {}) };
      if (c > maxC) maxC = c;
    });

    (ws['!rows'] ?? []).forEach((ri, r) => {
      if (!ri) return;
      // SheetJS reads <row ht> as points (hpt); x-spreadsheet works in pixels.
      const height = ri.hpt !== undefined ? Math.round((ri.hpt * 4) / 3) : ri.hpx;
      if (height === undefined && !ri.hidden) return;
      const row = (rows[r] as XRow | undefined) ?? (rows[r] = { cells: {} });
      if (height !== undefined) row.height = height;
      if (ri.hidden) row.hide = true;
      if (r > maxR) maxR = r;
    });
  }

  rows.len = Math.max(MIN_ROWS, maxR + 1 + EXTRA_ROWS);
  cols.len = Math.max(MIN_COLS, maxC + 1 + EXTRA_COLS);
  return { name, merges, rows, cols };
}

// ---------------------------------------------------------------------------
// x-spreadsheet -> workbook
// ---------------------------------------------------------------------------

function xToCell(x: XCell): XLSX.CellObject | undefined {
  const text = x.text === undefined || x.text === null ? '' : String(x.text);
  if (text === '') return undefined;
  const h = x.h && x.h.o === text ? x.h : undefined;

  if (text.length > 1 && text.charCodeAt(0) === 61 /* = */) {
    const f = text.slice(1);
    if (h && h.v !== undefined) {
      return { t: h.t, v: h.v, f, ...(h.z ? { z: h.z } : {}) } as XLSX.CellObject;
    }
    // No cached value: Excel computes it on open.
    return { t: 's', f } as XLSX.CellObject;
  }
  if (h) {
    return { t: h.t, v: h.v, ...(h.z ? { z: h.z } : {}) } as XLSX.CellObject;
  }
  const inf = infer(text);
  if (inf) {
    return { t: inf.t, v: inf.v, ...(inf.z ? { z: inf.z } : {}) } as XLSX.CellObject;
  }
  return { t: 's', v: text };
}

/** Makes names unique, <= 31 chars and free of characters Excel rejects. */
function sheetNames(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((n, i) => {
    let base = String(n ?? '').replace(/[\\/?*[\]:]/g, '_').replace(/^'+|'+$/g, '').trim().slice(0, 31);
    if (!base) base = `Sheet${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) {
      const suffix = `_${k}`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function numericKeys(o: object): number[] {
  return Object.keys(o)
    .filter((k) => /^\d+$/.test(k))
    .map(Number);
}

function sheetToWorksheet(sheet: XSheet): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = -1;
  let maxC = -1;
  const rowInfo: XLSX.RowInfo[] = [];
  const colInfo: XLSX.ColInfo[] = [];

  for (const r of numericKeys(sheet.rows ?? {})) {
    const row = sheet.rows[r] as XRow | undefined;
    if (!row || typeof row !== 'object') continue;
    for (const c of numericKeys(row.cells ?? {})) {
      const cell = xToCell(row.cells[c]);
      if (!cell) continue;
      ws[XLSX.utils.encode_cell({ r, c })] = cell;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    if (row.height !== undefined || row.hide) {
      const info: XLSX.RowInfo = {};
      if (row.height !== undefined) info.hpt = Math.round((row.height * 3) / 4);
      if (row.hide) info.hidden = true;
      rowInfo[r] = info;
    }
  }

  for (const c of numericKeys(sheet.cols ?? {})) {
    const col = sheet.cols[c] as XCol | undefined;
    if (!col || typeof col !== 'object') continue;
    if (col.width === undefined && !col.hide) continue;
    const info: XLSX.ColInfo = {};
    if (col.width !== undefined) info.wpx = col.width;
    if (col.hide) info.hidden = true;
    colInfo[c] = info;
  }

  const merges: XLSX.Range[] = [];
  for (const m of sheet.merges ?? []) {
    const range = XLSX.utils.decode_range(m);
    if (range.s.r !== range.e.r || range.s.c !== range.e.c) {
      merges.push(range);
      if (range.e.r > maxR) maxR = range.e.r;
      if (range.e.c > maxC) maxC = range.e.c;
    }
  }
  if (merges.length) ws['!merges'] = merges;
  if (colInfo.some(Boolean)) ws['!cols'] = fillHoles(colInfo);
  if (rowInfo.some(Boolean)) ws['!rows'] = fillHoles(rowInfo);

  ws['!ref'] = maxR < 0 ? 'A1' : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

function fillHoles<T extends object>(a: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < a.length; i++) out.push(a[i] ?? ({} as T));
  return out;
}

export type ExcelBookType = 'xlsx' | 'xlsm' | 'biff8' | 'ods';

export function bookTypeForExt(ext: string): ExcelBookType {
  switch (ext.toLowerCase()) {
    case '.xlsm':
      return 'xlsm';
    case '.xls':
      return 'biff8';
    case '.ods':
      return 'ods';
    default:
      return 'xlsx';
  }
}

export function sheetsToWorkbook(sheets: XSheet[], vbaraw?: unknown): XLSX.WorkBook {
  const names = sheetNames(sheets.map((s) => s.name));
  const wb: XLSX.WorkBook = { SheetNames: names, Sheets: {} };
  sheets.forEach((s, i) => {
    wb.Sheets[names[i]] = sheetToWorksheet(s);
  });
  if (vbaraw) (wb as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw = vbaraw;
  return wb;
}

// ---------------------------------------------------------------------------
// CSV (parsed by hand so every cell stays literal text and nothing is re-typed)
// ---------------------------------------------------------------------------

export interface CsvInfo {
  delimiter: string;
  eol: string;
  bom: boolean;
  trailingEol: boolean;
  /** Widest row seen on load, so trailing empty fields survive a save. */
  width: number;
}

function sniffDelimiter(text: string): string {
  const head = text.slice(0, 8192);
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

export function parseCsv(input: string, forcedDelimiter?: string): { rows: string[][]; info: CsvInfo } {
  const bom = input.charCodeAt(0) === 0xfeff;
  const text = bom ? input.slice(1) : input;
  const delimiter = forcedDelimiter ?? sniffDelimiter(text);
  const eol = text.includes('\r\n') ? '\r\n' : text.includes('\r') && !text.includes('\n') ? '\r' : '\n';
  const trailingEol = /[\r\n]$/.test(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let width = 0;
  const endRow = () => {
    row.push(field);
    field = '';
    width = Math.max(width, row.length);
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  return { rows, info: { delimiter, eol, bom, trailingEol, width } };
}

export function csvToSheet(name: string, rows: string[][]): XSheet {
  const sheet = worksheetToSheet(name, undefined);
  let maxR = -1;
  let maxC = -1;
  rows.forEach((line, r) => {
    line.forEach((text, c) => {
      if (text === '') return;
      const row = (sheet.rows[r] as XRow | undefined) ?? (sheet.rows[r] = { cells: {} });
      row.cells[c] = { text };
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    });
  });
  sheet.rows.len = Math.max(MIN_ROWS, Math.max(maxR + 1, rows.length) + EXTRA_ROWS);
  sheet.cols.len = Math.max(MIN_COLS, maxC + 1 + EXTRA_COLS);
  return sheet;
}

export function sheetToCsv(sheet: XSheet, info: CsvInfo): string {
  let maxR = -1;
  let maxC = Math.max(0, info.width) - 1;
  const cells = new Map<number, Map<number, string>>();
  for (const r of numericKeys(sheet.rows ?? {})) {
    const row = sheet.rows[r] as XRow | undefined;
    if (!row || typeof row !== 'object') continue;
    for (const c of numericKeys(row.cells ?? {})) {
      const t = row.cells[c]?.text;
      if (t === undefined || t === null || String(t) === '') continue;
      let m = cells.get(r);
      if (!m) cells.set(r, (m = new Map()));
      m.set(c, String(t));
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }
  const quote = (s: string) =>
    s.includes(info.delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r') ? '"' + s.replace(/"/g, '""') + '"' : s;
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const m = cells.get(r);
    const fields: string[] = [];
    for (let c = 0; c <= maxC; c++) fields.push(m?.has(c) ? quote(m.get(c) as string) : '');
    lines.push(fields.join(info.delimiter));
  }
  const body = lines.join(info.eol) + (lines.length && info.trailingEol ? info.eol : '');
  return (info.bom ? '﻿' : '') + body;
}
