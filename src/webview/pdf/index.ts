import './index.css';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { showError, startViewer, vscodeApi } from '../common/vscode';

type ZoomMode = 'fit' | 'custom';

interface PageView {
  index: number;
  div: HTMLDivElement;
  /** Page size in CSS px at scale 1. */
  baseW: number;
  baseH: number;
  canvas?: HTMLCanvasElement;
  textLayer?: HTMLDivElement;
  renderedScale: number;
  visible: boolean;
  /** Bumped on every (re)render and release; stale async work compares against it. */
  token: number;
  task?: RenderTask;
  textTask?: { cancel(): void };
}

interface SavedState {
  mode?: ZoomMode;
  scale?: number;
  page?: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.2;
const PAGE_GUTTER = 32;
/** Cap on canvas backing store (pixels) and side length, to keep memory and GPU limits sane. */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const MAX_CANVAS_SIDE = 16384;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const saved = (vscodeApi.getState() as SavedState | undefined) ?? {};

let zoomMode: ZoomMode = saved.mode === 'custom' ? 'custom' : 'fit';
let scale = typeof saved.scale === 'number' ? clamp(saved.scale, MIN_SCALE, MAX_SCALE) : 1;
let pendingPage = typeof saved.page === 'number' ? saved.page : 1;

let doc: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let pages: PageView[] = [];
let generation = 0;
let workerPromise: Promise<pdfjs.PDFWorker> | undefined;

let scrollerEl: HTMLElement;
let pagesEl: HTMLElement;
let labelEl: HTMLElement;
let pageInput: HTMLInputElement;
let pageCountEl: HTMLElement;
let fitBtn: HTMLButtonElement;
let observer: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let scrollRaf = 0;
let renderTimer: number | undefined;

function dataAttr(name: string): string {
  return document.body.dataset[name] ?? '';
}

/** (Re)builds the viewer DOM; also recovers from `showError`, which replaces the whole body. */
function ensureShell(): void {
  if (document.getElementById('pdf-root')) return;
  document.body.replaceChildren();
  resizeObserver?.disconnect();

  const button = (text: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  };
  const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });

  const root = Object.assign(document.createElement('div'), { id: 'pdf-root' });
  const toolbar = Object.assign(document.createElement('div'), { className: 'pdf-toolbar' });

  pageInput = Object.assign(document.createElement('input'), { type: 'number', min: '1', value: '1' });
  pageInput.title = 'Current page — type a page number and press Enter to jump to it';
  pageInput.setAttribute('aria-label', 'Page number');
  pageInput.style.cssText =
    'width:52px;height:20px;box-sizing:border-box;padding:0 4px;color:var(--vscode-input-foreground);' +
    'background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);' +
    'border-radius:2px;font:inherit;text-align:center';
  pageInput.addEventListener('change', () => {
    const n = parseInt(pageInput.value, 10);
    if (Number.isFinite(n)) goToPage(n);
  });
  pageCountEl = Object.assign(document.createElement('span'), { className: 'label' });
  labelEl = Object.assign(document.createElement('span'), { className: 'label', title: 'Current zoom level' });
  pageCountEl.title = 'Total number of pages';
  fitBtn = button('Fit width', 'Fit width — scale pages to the width of this editor', () => setZoom('fit'));

  toolbar.append(
    pageInput,
    pageCountEl,
    sep(),
    button('−', 'Zoom out (or Ctrl + mouse wheel)', () => zoomBy(1 / ZOOM_STEP)),
    labelEl,
    button('+', 'Zoom in (or Ctrl + mouse wheel)', () => zoomBy(ZOOM_STEP)),
    sep(),
    fitBtn,
    button('100%', 'Actual size — show pages at 100% zoom', () => setZoom('custom', 1)),
  );

  scrollerEl = Object.assign(document.createElement('div'), { id: 'pdf-scroller' });
  scrollerEl.tabIndex = 0;
  pagesEl = Object.assign(document.createElement('div'), { id: 'pdf-pages' });
  scrollerEl.append(pagesEl);
  root.append(toolbar, scrollerEl);
  document.body.append(root);

  scrollerEl.addEventListener('scroll', onScroll, { passive: true });
  scrollerEl.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01));
    },
    { passive: false },
  );
  resizeObserver = new ResizeObserver(() => {
    if (zoomMode === 'fit' && pages.length) applyScale(computeFitScale());
  });
  resizeObserver.observe(scrollerEl);
  updateToolbar();
}

/** A Worker script must be same-origin, so fetch it and start it from a Blob URL (pdf.js `workerPort`). */
function getWorker(): Promise<pdfjs.PDFWorker> {
  const p = (workerPromise ??= (async () => {
    const res = await fetch(dataAttr('workerSrc'));
    if (!res.ok) throw new Error(`Could not load the PDF worker (${res.status}).`);
    const blob = new Blob([await res.arrayBuffer()], { type: 'text/javascript' });
    const port = new Worker(URL.createObjectURL(blob), { type: 'module' });
    return pdfjs.PDFWorker.create({ port });
  })());
  p.catch(() => {
    if (workerPromise === p) workerPromise = undefined;
  });
  return p;
}

function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'PasswordException') {
    return 'This PDF is password-protected. Password-protected PDFs are not supported by this viewer.';
  }
  if (name === 'InvalidPDFException') return 'This file is not a valid PDF, or it is corrupt.';
  if (name === 'MissingPDFException') return 'The PDF file could not be found.';
  return `Failed to open the PDF: ${msg}`;
}

function destroyDocument(): void {
  generation++;
  observer?.disconnect();
  observer = undefined;
  clearTimeout(renderTimer);
  for (const pv of pages) release(pv);
  pages = [];
  pagesEl?.replaceChildren();
  const task = loadingTask;
  loadingTask = undefined;
  doc = undefined;
  // Destroys the document transport; the shared worker stays alive (we supplied it).
  void task?.destroy().catch(() => {});
}

async function onLoad(msg: { data: Uint8Array }): Promise<void> {
  const shellWasShown = !!document.getElementById('pdf-root');
  ensureShell();
  // Remember the position so a reload (file changed on disk) does not jump back to the top.
  // If an error replaced the shell, the old page views are detached; use the persisted position instead.
  if (pages.length) {
    const savedPage = (vscodeApi.getState() as SavedState | undefined)?.page;
    pendingPage = shellWasShown ? currentPage() : (savedPage ?? pendingPage);
  }
  destroyDocument();
  const gen = generation;
  let passwordRequired = false;

  try {
    const worker = await getWorker();
    if (gen !== generation) return;
    const task = pdfjs.getDocument({
      data: msg.data,
      worker,
      cMapUrl: dataAttr('cmapUrl'),
      cMapPacked: true,
      standardFontDataUrl: dataAttr('fontUrl'),
      wasmUrl: dataAttr('wasmUrl'),
      iccUrl: dataAttr('iccUrl'),
      // Fetch data files from the main thread (allowed by connect-src), not from inside the Blob worker.
      useWorkerFetch: false,
      enableXfa: false,
    });
    loadingTask = task;
    task.onPassword = () => {
      passwordRequired = true;
      if (gen === generation) {
        showError(describeError(Object.assign(new Error('password'), { name: 'PasswordException' })));
      }
      void task.destroy().catch(() => {});
    };
    const pdf = await task.promise;
    if (gen !== generation) {
      void task.destroy().catch(() => {});
      return;
    }
    doc = pdf;
    await buildPages(pdf, gen);
  } catch (e) {
    // Destroying the task after onPassword makes pdf.js reject; keep the password message.
    if (gen !== generation || passwordRequired) return;
    showError(describeError(e));
  }
}

async function buildPages(pdf: PDFDocumentProxy, gen: number): Promise<void> {
  ensureShell();
  const first = await pdf.getPage(1);
  if (gen !== generation) return;
  const vp = first.getViewport({ scale: 1 });

  observer = new IntersectionObserver(onIntersect, { root: scrollerEl, rootMargin: '150% 0px' });
  pages = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < pdf.numPages; i++) {
    const div = document.createElement('div');
    div.className = 'pdf-page';
    div.dataset.page = String(i + 1);
    div.setAttribute('role', 'img');
    div.setAttribute('aria-label', `Page ${i + 1}`);
    pages.push({ index: i, div, baseW: vp.width, baseH: vp.height, renderedScale: 0, visible: false, token: 0 });
    frag.append(div);
  }
  pagesEl.replaceChildren(frag);

  pageInput.max = String(pdf.numPages);
  pageCountEl.textContent = `/ ${pdf.numPages}`;
  if (zoomMode === 'fit') scale = computeFitScale();
  layout();
  updateToolbar();
  goToPage(clamp(pendingPage, 1, pdf.numPages));
  for (const pv of pages) observer.observe(pv.div);

  void resolvePageSizes(pdf, gen);
}

/** Fills in the real size of every page in the background so the scroll height becomes accurate. */
async function resolvePageSizes(pdf: PDFDocumentProxy, gen: number): Promise<void> {
  const CHUNK = 25;
  for (let start = 1; start < pdf.numPages; start += CHUNK) {
    const end = Math.min(pdf.numPages, start + CHUNK);
    let sizes: { w: number; h: number }[];
    try {
      sizes = await Promise.all(
        Array.from({ length: end - start }, async (_, k) => {
          const v = (await pdf.getPage(start + k + 1)).getViewport({ scale: 1 });
          return { w: v.width, h: v.height };
        }),
      );
    } catch {
      return;
    }
    if (gen !== generation) return;
    let changed = false;
    sizes.forEach((s, k) => {
      const pv = pages[start + k];
      if (pv && (pv.baseW !== s.w || pv.baseH !== s.h)) {
        pv.baseW = s.w;
        pv.baseH = s.h;
        changed = true;
      }
    });
    if (changed) {
      const keep = currentPage();
      if (zoomMode === 'fit') applyScale(computeFitScale());
      layout();
      if (keep > 1 && currentPage() !== keep && scrollerEl.scrollTop > 0) goToPage(keep);
    }
  }
}

function computeFitScale(): number {
  if (!pages.length) return scale;
  const maxW = pages.reduce((m, p) => Math.max(m, p.baseW), 1);
  return clamp((scrollerEl.clientWidth - PAGE_GUTTER) / maxW, MIN_SCALE, MAX_SCALE);
}

function layout(): void {
  pagesEl.style.setProperty('--total-scale-factor', String(scale));
  for (const pv of pages) {
    pv.div.style.width = `${Math.floor(pv.baseW * scale)}px`;
    pv.div.style.height = `${Math.floor(pv.baseH * scale)}px`;
  }
}

function applyScale(next: number): void {
  next = clamp(next, MIN_SCALE, MAX_SCALE);
  if (Math.abs(next - scale) < 0.0005) return;
  // Keep the viewport centre anchored while the document grows or shrinks.
  const cx = (scrollerEl.scrollLeft + scrollerEl.clientWidth / 2) / Math.max(1, scrollerEl.scrollWidth);
  const cy = (scrollerEl.scrollTop + scrollerEl.clientHeight / 2) / Math.max(1, scrollerEl.scrollHeight);
  scale = next;
  layout();
  scrollerEl.scrollLeft = cx * scrollerEl.scrollWidth - scrollerEl.clientWidth / 2;
  scrollerEl.scrollTop = cy * scrollerEl.scrollHeight - scrollerEl.clientHeight / 2;
  updateToolbar();
  persist();
  // Stretched old canvases stay visible until the sharp re-render lands.
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    for (const pv of pages) {
      if (!pv.visible) release(pv);
      else if (pv.renderedScale !== scale) void renderPage(pv);
    }
  }, 120);
}

function setZoom(mode: ZoomMode, value?: number): void {
  zoomMode = mode;
  if (mode === 'fit') applyScale(computeFitScale());
  else if (value !== undefined) applyScale(value);
  updateToolbar();
  persist();
}

function zoomBy(factor: number): void {
  zoomMode = 'custom';
  applyScale(scale * factor);
  updateToolbar();
  persist();
}

function updateToolbar(): void {
  labelEl.textContent = `${Math.round(scale * 100)}%`;
  fitBtn.classList.toggle('active', zoomMode === 'fit');
}

function persist(): void {
  vscodeApi.setState({ mode: zoomMode, scale, page: pages.length ? currentPage() : pendingPage } satisfies SavedState);
}

/** 1-based number of the page at the top of the viewport. */
function currentPage(): number {
  if (!pages.length) return 1;
  const y = scrollerEl.scrollTop + 8;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const d = pages[mid].div;
    if (d.offsetTop + d.offsetHeight > y) hi = mid;
    else lo = mid + 1;
  }
  return lo + 1;
}

function goToPage(n: number): void {
  const pv = pages[clamp(n, 1, Math.max(1, pages.length)) - 1];
  if (!pv) return;
  scrollerEl.scrollTop = pv.div.offsetTop - 8;
  pageInput.value = String(pv.index + 1);
}

function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!pages.length) return;
    if (document.activeElement !== pageInput) pageInput.value = String(currentPage());
    persist();
  });
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const pv = pages[Number((entry.target as HTMLElement).dataset.page) - 1];
    if (!pv) continue;
    pv.visible = entry.isIntersecting;
    if (entry.isIntersecting) {
      if (pv.renderedScale !== scale) void renderPage(pv);
    } else {
      release(pv);
    }
  }
}

function cancelWork(pv: PageView): void {
  pv.token++;
  pv.task?.cancel();
  pv.textTask?.cancel();
  pv.task = undefined;
  pv.textTask = undefined;
}

/** Frees the canvas and text layer of an off-screen page. */
function release(pv: PageView): void {
  cancelWork(pv);
  if (pv.canvas) {
    pv.canvas.width = 0;
    pv.canvas.height = 0;
    pv.canvas.remove();
    pv.canvas = undefined;
  }
  pv.textLayer?.remove();
  pv.textLayer = undefined;
  pv.renderedScale = 0;
}

async function renderPage(pv: PageView): Promise<void> {
  const pdf = doc;
  if (!pdf) return;
  cancelWork(pv);
  const token = pv.token;
  const renderScale = scale;
  const stale = () => token !== pv.token || pdf !== doc;

  try {
    const page = await pdf.getPage(pv.index + 1);
    if (stale()) return;
    const viewport = page.getViewport({ scale: renderScale });

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
      MAX_CANVAS_SIDE / Math.max(viewport.width, viewport.height),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio));

    const task = page.render({
      canvas,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    });
    pv.task = task;
    await task.promise;
    if (stale()) return;
    pv.task = undefined;

    // Swap in the new canvas only once it is complete, so zooming never flashes blank pages.
    pv.canvas?.remove();
    pv.div.prepend(canvas);
    pv.canvas = canvas;
    pv.renderedScale = renderScale;

    const layer = document.createElement('div');
    layer.className = 'textLayer';
    const textLayer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: layer,
      viewport,
    });
    // The layer fills the page box (pdf.js sizes it for unrotated pages only).
    layer.style.width = '100%';
    layer.style.height = '100%';
    pv.textTask = textLayer;
    await textLayer.render();
    if (stale()) return;
    pv.textTask = undefined;
    pv.textLayer?.remove();
    pv.div.append(layer);
    pv.textLayer = layer;
    page.cleanup();
  } catch (e) {
    if (e instanceof Error && e.name === 'RenderingCancelledException') return;
    if (stale()) return;
    pv.task = undefined;
    pv.textTask = undefined;
    pv.renderedScale = scale;
    pv.div.textContent = `Failed to render page ${pv.index + 1}: ${e instanceof Error ? e.message : String(e)}`;
    pv.div.style.cssText += ';color:#c00;padding:8px;box-sizing:border-box';
  }
}

ensureShell();
startViewer((msg) => onLoad(msg));
