// Reads charts out of an .xlsx/.xlsm package and draws them with Chart.js.
// SheetJS Community drops charts on read, so the OOXML parts are parsed here directly:
//   workbook.xml -> sheet -> drawingN.xml (anchors) -> chartN.xml (series, cached values).
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

Chart.register(...registerables);

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;
const DEFAULT_COL_PX = 64;
const DEFAULT_ROW_PX = 20;
const PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E'];

type Kind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'bubble' | 'radar';

interface SeriesModel {
  name: string;
  values: (number | null)[];
  xValues?: (number | null)[];
  sizes?: (number | null)[];
  color?: string;
  pointColors: Record<number, string>;
  smooth: boolean;
  noLine: boolean;
}

interface GroupModel {
  kind: Kind;
  horizontal: boolean;
  grouping: 'standard' | 'stacked' | 'percentStacked';
  filled: boolean;
  secondaryAxis: boolean;
  series: SeriesModel[];
}

export interface ChartModel {
  sheetName: string;
  widthPx: number;
  heightPx: number;
  title?: string;
  groups: GroupModel[];
  categories: string[];
  xTitle?: string;
  yTitle?: string;
  y2Title?: string;
  yMin?: number;
  yMax?: number;
  yLog: boolean;
  legend: 'top' | 'bottom' | 'left' | 'right' | false;
  /** Set when the chart type cannot be drawn; a placeholder card is shown instead. */
  unsupported?: string;
}

// ---------- XML helpers (namespace-agnostic) ----------

const parseXml = (xml: string): Element => new DOMParser().parseFromString(xml, 'application/xml').documentElement;
const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
const descendants = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.getElementsByTagNameNS('*', name)) : [];
const val = (el: Element | null | undefined): string | undefined => el?.getAttribute('val') ?? undefined;
const relId = (el: Element | null | undefined): string | undefined =>
  el?.getAttributeNS(REL_NS, 'id') ?? el?.getAttribute('r:id') ?? undefined;

function resolvePath(baseFile: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const parts = baseFile.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') {
      parts.pop();
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

function relsPathOf(file: string): string {
  const i = file.lastIndexOf('/');
  return `${file.slice(0, i)}/_rels/${file.slice(i + 1)}.rels`;
}

async function readText(zip: JSZip, path: string): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

interface Rel {
  type: string;
  path: string;
}

async function readRels(zip: JSZip, file: string): Promise<Map<string, Rel>> {
  const out = new Map<string, Rel>();
  const xml = await readText(zip, relsPathOf(file));
  if (!xml) {
    return out;
  }
  for (const r of descendants(parseXml(xml), 'Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target');
    if (id && target && r.getAttribute('TargetMode') !== 'External') {
      out.set(id, { type: r.getAttribute('Type') ?? '', path: resolvePath(file, target) });
    }
  }
  return out;
}

// ---------- theme / colours ----------

type Theme = Record<string, string>;

async function readTheme(zip: JSZip): Promise<Theme> {
  const theme: Theme = {};
  const xml = await readText(zip, 'xl/theme/theme1.xml');
  if (!xml) {
    return theme;
  }
  const scheme = descendants(parseXml(xml), 'clrScheme')[0];
  for (const c of Array.from(scheme?.children ?? [])) {
    const inner = c.firstElementChild;
    const hex = inner?.getAttribute('val') ?? inner?.getAttribute('lastClr');
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) {
      theme[c.localName] = `#${hex}`;
    }
  }
  return theme;
}

const SCHEME_ALIASES: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

function colorOf(fill: Element | undefined, theme: Theme): string | undefined {
  const c = fill?.firstElementChild;
  if (!c) {
    return undefined;
  }
  const v = c.getAttribute('val');
  if (c.localName === 'srgbClr' && v && /^[0-9a-f]{6}$/i.test(v)) {
    return `#${v}`;
  }
  if (c.localName === 'schemeClr' && v) {
    return theme[SCHEME_ALIASES[v] ?? v];
  }
  return undefined;
}

function seriesColor(spPr: Element | undefined, theme: Theme, preferLine: boolean): string | undefined {
  const fill = colorOf(kid(spPr, 'solidFill'), theme);
  const line = colorOf(kid(kid(spPr, 'ln'), 'solidFill'), theme);
  return preferLine ? (line ?? fill) : (fill ?? line);
}

// ---------- series data ----------

function textOf(el: Element | undefined): string | undefined {
  if (!el) {
    return undefined;
  }
  const t = descendants(el, 't')
    .map((n) => n.textContent ?? '')
    .join('');
  if (t) {
    return t;
  }
  const v = descendants(el, 'v')[0]?.textContent;
  return v ?? undefined;
}

function resolveFormula(f: string, wb: XLSX.WorkBook): (string | number | null)[] | undefined {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(f.trim());
  if (!m) {
    return undefined;
  }
  const ws = wb.Sheets[(m[1] ?? m[2]).replace(/''/g, "'")];
  if (!ws) {
    return undefined;
  }
  const range = XLSX.utils.decode_range(`${m[3]}${m[4]}:${m[5] ?? m[3]}${m[6] ?? m[4]}`);
  const out: (string | number | null)[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      out.push(cell && cell.v !== undefined ? (cell.v as string | number) : null);
    }
  }
  return out;
}

interface Values {
  vals: (string | number | null)[];
  formatCode?: string;
}

/** Reads a c:cat / c:val / c:xVal / c:yVal / c:tx / c:bubbleSize holder (cache first, then the cell range). */
function readValues(holder: Element | undefined, wb: XLSX.WorkBook): Values | undefined {
  const ref = holder?.firstElementChild;
  if (!ref) {
    return undefined;
  }
  // A literal series name is written as <c:tx><c:v>text</c:v></c:tx>.
  if (ref.localName === 'v') {
    return { vals: [ref.textContent] };
  }
  let cache: Element | undefined;
  if (ref.localName === 'numLit' || ref.localName === 'strLit') {
    cache = ref;
  } else if (ref.localName === 'multiLvlStrRef') {
    const lvl = kid(kid(ref, 'multiLvlStrCache'), 'lvl');
    cache = lvl;
  } else {
    cache = kid(ref, 'numCache') ?? kid(ref, 'strCache');
  }
  if (cache) {
    const count = parseInt(val(kid(cache, 'ptCount')) ?? '0', 10);
    const vals: (string | number | null)[] = Array.from({ length: Math.max(count, 0) }, () => null);
    const numeric = cache.localName === 'numCache' || cache.localName === 'numLit';
    for (const pt of kids(cache, 'pt')) {
      const idx = parseInt(pt.getAttribute('idx') ?? '-1', 10);
      const text = kid(pt, 'v')?.textContent ?? null;
      if (idx >= 0 && text !== null) {
        if (idx >= vals.length) {
          vals.length = idx + 1;
        }
        vals[idx] = numeric ? Number(text) : text;
      }
    }
    return { vals, formatCode: kid(cache, 'formatCode')?.textContent ?? undefined };
  }
  const f = kid(ref, 'f')?.textContent;
  const resolved = f ? resolveFormula(f, wb) : undefined;
  return resolved ? { vals: resolved } : undefined;
}

const toNum = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function formatCategory(v: string | number | null, formatCode?: string): string {
  if (v === null) {
    return '';
  }
  if (typeof v === 'number' && formatCode && formatCode !== 'General') {
    try {
      return XLSX.SSF.format(formatCode, v);
    } catch {
      // fall through
    }
  }
  return String(v);
}

// ---------- chart part -> model ----------

const KIND_BY_ELEMENT: Record<string, { kind: Kind; defaults?: Partial<GroupModel> }> = {
  barChart: { kind: 'bar' },
  bar3DChart: { kind: 'bar' },
  lineChart: { kind: 'line' },
  line3DChart: { kind: 'line' },
  areaChart: { kind: 'area' },
  area3DChart: { kind: 'area' },
  pieChart: { kind: 'pie' },
  pie3DChart: { kind: 'pie' },
  ofPieChart: { kind: 'pie' },
  doughnutChart: { kind: 'doughnut' },
  scatterChart: { kind: 'scatter' },
  bubbleChart: { kind: 'bubble' },
  radarChart: { kind: 'radar' },
};

function parseChart(
  xml: string,
  sheetName: string,
  size: { w: number; h: number },
  wb: XLSX.WorkBook,
  theme: Theme,
): ChartModel {
  const space = parseXml(xml);
  const chart = kid(space, 'chart');
  const plot = kid(chart, 'plotArea');
  const model: ChartModel = {
    sheetName,
    widthPx: size.w,
    heightPx: size.h,
    groups: [],
    categories: [],
    yLog: false,
    legend: false,
  };

  // Axes: remember which value axis ids exist so a second group can use the right-hand axis.
  const valAxes = kids(plot, 'valAx');
  const catAxes = [...kids(plot, 'catAx'), ...kids(plot, 'dateAx')];
  const primaryValId = val(kid(valAxes[0], 'axId'));
  const axisTitle = (ax: Element | undefined): string | undefined => textOf(kid(ax, 'title'));
  const scaling = kid(valAxes[0], 'scaling');
  model.yMin = toNum(val(kid(scaling, 'min'))) ?? undefined;
  model.yMax = toNum(val(kid(scaling, 'max'))) ?? undefined;
  model.yLog = kid(scaling, 'logBase') !== undefined;
  model.xTitle = axisTitle(catAxes[0]);
  model.yTitle = axisTitle(valAxes[0]);
  if (valAxes[1]) {
    model.y2Title = axisTitle(valAxes[1]);
  }

  const autoTitleDeleted = val(kid(chart, 'autoTitleDeleted')) === '1';
  const titleEl = kid(chart, 'title');
  if (titleEl) {
    model.title = textOf(kid(titleEl, 'tx')) ?? undefined;
  }

  for (const el of Array.from(plot?.children ?? [])) {
    const spec = KIND_BY_ELEMENT[el.localName];
    if (!spec) {
      if (el.localName.endsWith('Chart') || el.localName.endsWith('3DChart')) {
        model.unsupported = el.localName.replace(/(3D)?Chart$/, '') + ' charts';
      }
      continue;
    }
    const barDir = val(kid(el, 'barDir'));
    const groupAxIds = kids(el, 'axId').map((a) => a.getAttribute('val'));
    const group: GroupModel = {
      kind: spec.kind,
      horizontal: barDir === 'bar',
      grouping: (val(kid(el, 'grouping')) as GroupModel['grouping'] | undefined) ?? 'standard',
      filled: spec.kind === 'area' || (spec.kind === 'radar' && val(kid(el, 'radarStyle')) === 'filled'),
      secondaryAxis: Boolean(valAxes[1]) && !groupAxIds.includes(primaryValId ?? ''),
      series: [],
    };
    if (group.grouping !== 'stacked' && group.grouping !== 'percentStacked') {
      group.grouping = 'standard';
    }
    const varyColors = val(kid(el, 'varyColors')) === '1' || spec.kind === 'pie' || spec.kind === 'doughnut';

    for (const ser of kids(el, 'ser')) {
      const idx = parseInt(val(kid(ser, 'idx')) ?? String(model.groups.length), 10);
      const spPr = kid(ser, 'spPr');
      const name = readValues(kid(ser, 'tx'), wb)?.vals[0];
      const isXY = spec.kind === 'scatter' || spec.kind === 'bubble';
      const catHolder = kid(ser, isXY ? 'xVal' : 'cat');
      const valHolder = kid(ser, isXY ? 'yVal' : 'val');
      const cats = readValues(catHolder, wb);
      const values = readValues(valHolder, wb);
      if (!model.categories.length && cats && !isXY) {
        model.categories = cats.vals.map((v) => formatCategory(v, cats.formatCode));
      }
      const pointColors: Record<number, string> = {};
      for (const dPt of kids(ser, 'dPt')) {
        const c = seriesColor(kid(dPt, 'spPr'), theme, false);
        const i = parseInt(val(kid(dPt, 'idx')) ?? '-1', 10);
        if (c && i >= 0) {
          pointColors[i] = c;
        }
      }
      const lineFill = kid(kid(spPr, 'ln'), 'noFill');
      group.series.push({
        name: name !== undefined && name !== null ? String(name) : `Series ${idx + 1}`,
        values: (values?.vals ?? []).map(toNum),
        xValues: isXY ? (cats?.vals ?? []).map(toNum) : undefined,
        sizes: spec.kind === 'bubble' ? (readValues(kid(ser, 'bubbleSize'), wb)?.vals ?? []).map(toNum) : undefined,
        color:
          seriesColor(spPr, theme, spec.kind === 'line' || spec.kind === 'scatter' || spec.kind === 'radar') ??
          (varyColors ? undefined : PALETTE[(Number.isFinite(idx) ? idx : model.groups.length) % PALETTE.length]),
        pointColors,
        smooth: val(kid(ser, 'smooth')) === '1',
        noLine: lineFill !== undefined,
      });
    }
    if (group.series.length) {
      model.groups.push(group);
    }
  }

  if (!model.groups.length && !model.unsupported) {
    model.unsupported = 'an unrecognised chart type';
  }
  if (!model.title && !autoTitleDeleted && model.groups.length === 1 && model.groups[0].series.length === 1) {
    model.title = model.groups[0].series[0].name;
  }
  const legendEl = kid(chart, 'legend');
  if (legendEl) {
    const pos = val(kid(legendEl, 'legendPos'));
    model.legend = pos === 't' || pos === 'b' || pos === 'l' ? ({ t: 'top', b: 'bottom', l: 'left' } as const)[pos] : 'right';
  }
  return model;
}

// ---------- discovery ----------

function anchorSize(anchor: Element, ws: XLSX.WorkSheet | undefined): { w: number; h: number } {
  const num = (el: Element | undefined, name: string): number => parseInt(kid(el, name)?.textContent ?? '0', 10) || 0;
  let w = 480;
  let h = 288;
  if (anchor.localName === 'twoCellAnchor') {
    const from = kid(anchor, 'from');
    const to = kid(anchor, 'to');
    const cols = (ws?.['!cols'] ?? []) as XLSX.ColInfo[];
    const rows = (ws?.['!rows'] ?? []) as XLSX.RowInfo[];
    w = 0;
    for (let c = num(from, 'col'); c < num(to, 'col'); c++) {
      w += cols[c]?.wpx ?? DEFAULT_COL_PX;
    }
    h = 0;
    for (let r = num(from, 'row'); r < num(to, 'row'); r++) {
      h += rows[r]?.hpx ?? DEFAULT_ROW_PX;
    }
    w += (num(to, 'colOff') - num(from, 'colOff')) / EMU_PER_PX;
    h += (num(to, 'rowOff') - num(from, 'rowOff')) / EMU_PER_PX;
  } else {
    const ext = kid(anchor, 'ext');
    const cx = parseInt(ext?.getAttribute('cx') ?? '0', 10);
    const cy = parseInt(ext?.getAttribute('cy') ?? '0', 10);
    if (cx > 0 && cy > 0) {
      w = cx / EMU_PER_PX;
      h = cy / EMU_PER_PX;
    }
  }
  return { w: Math.min(Math.max(Math.round(w), 280), 1000), h: Math.min(Math.max(Math.round(h), 200), 700) };
}

/** Number of chart parts in the package, without parsing them (cheap check for editors). */
export async function countCharts(bytes: Uint8Array): Promise<number> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return 0;
  }
  try {
    const zip = await JSZip.loadAsync(bytes);
    return Object.keys(zip.files).filter((f) => /^xl\/(charts|chartsheets)\/[^/]+\.xml$/.test(f) && !f.includes('/_rels/')).length;
  } catch {
    return 0;
  }
}

/** Extracts every chart of an OOXML workbook. Returns [] for non-zip files (xls, csv, ods). */
export async function extractCharts(bytes: Uint8Array, wb: XLSX.WorkBook): Promise<ChartModel[]> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return [];
  }
  const zip = await JSZip.loadAsync(bytes);
  const wbXml = await readText(zip, 'xl/workbook.xml');
  if (!wbXml) {
    return [];
  }
  const theme = await readTheme(zip);
  const wbRels = await readRels(zip, 'xl/workbook.xml');
  const models: ChartModel[] = [];

  for (const sheet of descendants(parseXml(wbXml), 'sheet')) {
    const sheetName = sheet.getAttribute('name') ?? '';
    const rel = wbRels.get(relId(sheet) ?? '');
    if (!rel) {
      continue;
    }
    const sheetRels = await readRels(zip, rel.path);
    const drawingRel = Array.from(sheetRels.values()).find((r) => r.type.endsWith('/drawing'));
    const drawingXml = drawingRel ? await readText(zip, drawingRel.path) : undefined;
    if (!drawingRel || !drawingXml) {
      continue;
    }
    const drawingRels = await readRels(zip, drawingRel.path);
    for (const anchor of Array.from(parseXml(drawingXml).children)) {
      const frame = descendants(anchor, 'chart')[0];
      const chartRel = drawingRels.get(relId(frame) ?? '');
      if (!frame || !chartRel) {
        continue;
      }
      const size = rel.path.includes('chartsheets/') ? { w: 900, h: 560 } : anchorSize(anchor, wb.Sheets[sheetName]);
      const chartXml = await readText(zip, chartRel.path);
      if (!chartXml) {
        continue;
      }
      try {
        models.push(parseChart(chartXml, sheetName, size, wb, theme));
      } catch (e) {
        models.push({
          sheetName,
          widthPx: size.w,
          heightPx: size.h,
          groups: [],
          categories: [],
          yLog: false,
          legend: false,
          unsupported: `an error while reading it (${e instanceof Error ? e.message : String(e)})`,
        });
      }
    }
  }
  return models;
}

// ---------- rendering ----------

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildConfig(m: ChartModel): ChartConfiguration {
  const first = m.groups[0];
  const cartesian = !['pie', 'doughnut', 'radar'].includes(first.kind);
  const horizontal = first.kind === 'bar' && first.horizontal;
  const labels = m.categories.length
    ? m.categories
    : Array.from({ length: Math.max(...first.series.map((s) => s.values.length)) }, (_, i) => String(i + 1));

  // percentStacked: normalise every category to 100 %.
  const percentTotals = labels.map((_, i) =>
    first.series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0),
  );

  const datasets: Record<string, unknown>[] = [];
  m.groups.forEach((g) => {
    g.series.forEach((s, si) => {
      const color = s.color ?? PALETTE[(datasets.length + si) % PALETTE.length];
      const axisId = g.secondaryAxis ? 'y2' : 'y';
      const base: Record<string, unknown> = { label: s.name };
      const values =
        g.grouping === 'percentStacked'
          ? s.values.map((v, i) => (v !== null && percentTotals[i] ? (v / percentTotals[i]) * 100 : v))
          : s.values;
      if (g.kind === 'bar') {
        Object.assign(base, { type: 'bar', data: values, backgroundColor: color, borderColor: color, yAxisID: axisId });
      } else if (g.kind === 'line' || g.kind === 'area') {
        Object.assign(base, {
          type: 'line',
          data: values,
          borderColor: color,
          backgroundColor: g.kind === 'area' ? withAlpha(color, 0.45) : color,
          fill: g.kind === 'area',
          tension: s.smooth ? 0.35 : 0,
          pointRadius: g.kind === 'area' ? 0 : 3,
          showLine: !s.noLine,
          yAxisID: axisId,
        });
      } else if (g.kind === 'pie' || g.kind === 'doughnut') {
        const colors = s.values.map((_, i) => s.pointColors[i] ?? PALETTE[i % PALETTE.length]);
        Object.assign(base, { data: s.values, backgroundColor: colors, borderColor: 'rgba(0,0,0,0.15)' });
      } else if (g.kind === 'scatter') {
        Object.assign(base, {
          type: 'scatter',
          data: s.values.map((y, i) => ({ x: s.xValues?.[i] ?? i + 1, y })),
          borderColor: color,
          backgroundColor: color,
          showLine: !s.noLine,
          yAxisID: axisId,
        });
      } else if (g.kind === 'bubble') {
        const sizes = (s.sizes ?? []).map((v) => Math.abs(v ?? 0));
        const maxSize = Math.max(1, ...sizes);
        Object.assign(base, {
          type: 'bubble',
          data: s.values.map((y, i) => ({ x: s.xValues?.[i] ?? i + 1, y, r: 4 + (sizes[i] / maxSize) * 16 })),
          borderColor: color,
          backgroundColor: withAlpha(color, 0.5),
          yAxisID: axisId,
        });
      } else {
        Object.assign(base, {
          type: 'radar',
          data: s.values,
          borderColor: color,
          backgroundColor: withAlpha(color, g.filled ? 0.35 : 0.1),
          fill: g.filled,
        });
      }
      datasets.push(base);
    });
  });

  const stacked = m.groups.some((g) => g.grouping !== 'standard');
  const title = (text?: string) => ({ display: Boolean(text), text: text ?? '' });
  const scales: Record<string, unknown> = {};
  if (cartesian) {
    const xy = first.kind === 'scatter' || first.kind === 'bubble';
    const catAxis = horizontal ? 'y' : 'x';
    const valAxis = horizontal ? 'x' : 'y';
    scales[catAxis] = { stacked, title: title(m.xTitle), type: xy ? 'linear' : 'category', ...(xy ? {} : { grid: { display: false } }) };
    scales[valAxis] = {
      stacked,
      title: title(m.yTitle),
      type: m.yLog ? 'logarithmic' : 'linear',
      min: first.grouping === 'percentStacked' ? 0 : m.yMin,
      max: first.grouping === 'percentStacked' ? 100 : m.yMax,
      beginAtZero: first.kind === 'bar' || first.kind === 'area',
    };
    if (m.groups.some((g) => g.secondaryAxis)) {
      scales.y2 = { position: 'right', title: title(m.y2Title), grid: { drawOnChartArea: false } };
    }
  }

  if (first.kind === 'radar') {
    scales.r = { beginAtZero: true, ticks: { backdropColor: 'transparent' } };
  }
  const rootType = first.kind === 'area' ? 'line' : first.kind;
  return {
    type: rootType,
    data: { labels: first.kind === 'scatter' || first.kind === 'bubble' ? undefined : labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: horizontal ? 'y' : 'x',
      scales,
      plugins: {
        title: { ...title(m.title), font: { size: 15 } },
        legend: {
          display: m.legend !== false || first.kind === 'pie' || first.kind === 'doughnut',
          position: m.legend === false ? 'right' : m.legend,
        },
      },
    },
  } as unknown as ChartConfiguration;
}

/** Draws the charts into `container` (one card each) and returns the instances so they can be destroyed. */
export function renderCharts(container: HTMLElement, models: ChartModel[]): Chart[] {
  const styles = getComputedStyle(document.body);
  Chart.defaults.color = styles.getPropertyValue('--vscode-editor-foreground').trim() || styles.color;
  Chart.defaults.borderColor = 'rgba(128, 128, 128, 0.25)';
  Chart.defaults.font.family = styles.getPropertyValue('--vscode-font-family').trim() || 'sans-serif';

  const instances: Chart[] = [];
  for (const m of models) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.style.width = `${m.widthPx}px`;
    card.style.height = `${m.heightPx}px`;
    if (m.unsupported) {
      card.classList.add('chart-unsupported');
      card.textContent = `This chart can't be drawn yet: ${m.unsupported}.`;
      container.appendChild(card);
      continue;
    }
    const canvas = document.createElement('canvas');
    card.appendChild(canvas);
    container.appendChild(card);
    try {
      instances.push(new Chart(canvas, buildConfig(m)));
    } catch (e) {
      card.replaceChildren();
      card.classList.add('chart-unsupported');
      card.textContent = `This chart can't be drawn: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return instances;
}
