import Vditor from 'vditor';
import 'vditor/dist/index.css';
import './index.css';
import { showError, vscodeApi } from '../common/vscode';
import { htmlToDocxBase64 } from './toDocx';
import { buildExportHtml } from './exportHtml';
import { inlineLocalImages, isRemoteImage } from './localImages';

const DEBOUNCE_MS = 250;

interface UpdateMessage {
  type: 'update';
  text: string;
}

const norm = (s: string): string => s.replace(/\r\n?/g, '\n');

/**
 * Vditor lazy-loads lute/i18n/icons by appending <script> tags at runtime; the nonce-only CSP
 * would block those. The host shell loads them up front (with the nonce), so register the ids
 * vditor checks to make it treat them as already loaded.
 */
function markScriptsLoaded(): void {
  for (const id of [
    'vditorLuteScript',
    'vditorIconScript',
    'vditorMermaidScript',
    'vditorKatexScript',
    'vditorKatexChemScript',
    'vditorHljsScript',
    'vditorHljsThirdScript',
  ]) {
    if (!document.getElementById(id)) {
      const marker = document.createElement('meta');
      marker.id = id;
      document.head.appendChild(marker);
    }
  }
}

const isDark = (): boolean =>
  document.body.classList.contains('vscode-dark') ||
  (document.body.classList.contains('vscode-high-contrast') &&
    !document.body.classList.contains('vscode-high-contrast-light'));

/** The element that scrolls for the current edit mode. */
function scroller(editor: Vditor): HTMLElement | null {
  const v = editor.vditor;
  switch (editor.getCurrentMode()) {
    case 'wysiwyg':
      return v.wysiwyg?.element.parentElement ?? null;
    case 'ir':
      return v.ir?.element.parentElement ?? null;
    default:
      return v.sv?.element ?? null;
  }
}

/** Curly double quotes (“ shape) for the Quote button; filled with the toolbar icon colour. */
const QUOTE_MARK =
  'M9.5 6.2C6.2 6.7 4 9.4 4 12.8c0 2.6 1.7 4.6 4 4.6 2 0 3.5-1.5 3.5-3.4 0-1.8-1.3-3.1-2.9-3.3.3-1.5 1.3-2.5 2.4-3.1z';
const QUOTE_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${QUOTE_MARK}"/><path d="${QUOTE_MARK}" transform="translate(9 0)"/></svg>`;

/** A page labelled "PDF": "export to PDF" (same style as the Word icon). */
const EXPORT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M5 2h9l5 5v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM6 4v16h12V8.5h-4.5V4H6z"/><text x="12" y="17" font-family="Segoe UI, Arial, sans-serif" font-size="5.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">PDF</text></svg>';

/** A page with a "W" mark: "export to Word". */
const DOCX_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M5 2h9l5 5v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM6 4v16h12V8.5h-4.5V4H6z"/><text x="12" y="17" font-family="Segoe UI, Arial, sans-serif" font-size="5.6" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">DOC</text></svg>';

/** A picture frame with a mountain and sun: "insert image". */
const IMAGE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v10.6l4.3-4.3a1 1 0 0 1 1.4 0l3.3 3.3 2.3-2.3a1 1 0 0 1 1.4 0L20 16.6V6H4z"/><circle cx="15.5" cy="9.5" r="1.8"/></svg>';

/** What each ribbon button does, keyed by vditor's `data-type`. */
const TOOLBAR_HELP: Record<string, string> = {
  headings: 'Headings: turn the current line into a heading (H1–H6)',
  bold: 'Bold: make the selected text bold',
  italic: 'Italic: make the selected text italic',
  strike: 'Strikethrough: cross out the selected text',
  link: 'Link: turn the selected text into a link',
  'insert-image': 'Insert image: pick an image file and add it here (or hold Shift and drag files into the editor)',
  list: 'Bulleted list: start or toggle a bullet list',
  'ordered-list': 'Numbered list: start or toggle a numbered list',
  check: 'Task list: start or toggle a checklist with tick boxes',
  outdent: 'Decrease indent: move the current list item out one level',
  indent: 'Increase indent: move the current list item in one level',
  quote: 'Quote: turn the current paragraph into a block quote',
  line: 'Horizontal rule: insert a dividing line',
  code: 'Code block: insert a fenced block for multi-line code',
  'inline-code': 'Inline code: format the selected text as code',
  'insert-before': 'Insert paragraph above: add an empty line before the current block',
  'insert-after': 'Insert paragraph below: add an empty line after the current block',
  table: 'Table: insert a table',
  undo: 'Undo the last change',
  redo: 'Redo the change you just undid',
  'edit-mode': 'Edit mode: switch between WYSIWYG, instant rendering and split view',
  outline: 'Outline: show or hide the document outline',
  'export-pdf': 'Export to PDF: save this document as a PDF file',
  'export-docx': 'Export to Word: save this document as a .docx file',
};

/**
 * Vditor's own tooltips are CSS-only and do not show up inside the VS Code webview, so give every
 * ribbon button a native `title` (with its keyboard shortcut). index.css hides vditor's own bubble.
 */
function addToolbarTooltips(app: HTMLElement): void {
  const toolbar = app.querySelector<HTMLElement>('.vditor-toolbar');
  if (!toolbar) {
    return;
  }
  const apply = (): void => {
    toolbar.querySelectorAll<HTMLElement>('.vditor-toolbar__item > [data-type]').forEach((btn) => {
      const type = btn.dataset.type ?? '';
      const aria = btn.getAttribute('aria-label') ?? '';
      // vditor appends the shortcut to its label as "<⌘-B>"
      const hotkey = /<([^<>]+)>\s*$/.exec(aria)?.[1];
      const base = TOOLBAR_HELP[type] ?? aria.replace(/\s*<[^<>]+>\s*$/, '');
      const title = hotkey ? `${base} (${hotkey})` : base;
      if (title && btn.title !== title) {
        btn.title = title;
      }
    });
  };
  apply();
  // The toolbar is re-rendered when the edit mode changes.
  new MutationObserver(apply).observe(toolbar, { childList: true, subtree: true });
}

/**
 * The split-view preview bar: say what each width preset does.
 */
function labelPreviewActions(app: HTMLElement): void {
  const help: Record<string, [string, string]> = {
    desktop: ['Desktop', 'Preview at the full width of the pane'],
    tablet: ['Tablet', 'Preview at tablet width (780 px), if the pane is wide enough'],
    mobile: ['Mobile', 'Preview at phone width (360 px)'],
  };
  app.querySelectorAll<HTMLButtonElement>('.vditor-preview__action button[data-type]').forEach((btn) => {
    const entry = help[btn.dataset.type ?? ''];
    if (entry) {
      btn.textContent = entry[0];
      btn.title = entry[1];
    }
  });
}

const OUTLINE_DEFAULT_WIDTH = 250;
const OUTLINE_MIN_WIDTH = 140;
/** A panel docked on one side, with an arrow pointing to the other: "move the outline over there". */
const sideIcon = (to: 'left' | 'right'): string =>
  to === 'left'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h4V6H4zm6 0v12h10V6H10z"/><path d="M17.5 11.2h-3l1.2-1.2-1.1-1.1L11.5 12l3.1 3.1 1.1-1.1-1.2-1.2h3z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h10V6H4zm12 0v12h4V6h-4z"/><path d="M6.5 11.2h3L8.3 10l1.1-1.1 3.1 3.1-3.1 3.1-1.1-1.1 1.2-1.2h-3z"/></svg>';

/**
 * Makes the outline pane resizable (drag its inner edge, double-click to reset) and movable between
 * the right and left side (button in its title). The choice is reported to the host, which remembers it.
 */
function setupOutline(editor: Vditor, width: number): void {
  const v = editor.vditor;
  const outline = v.outline?.element;
  const content = outline?.parentElement;
  const title = outline?.querySelector<HTMLElement>('.vditor-outline__title');
  const opts = v.options.outline;
  if (!outline || !content || !title || !opts) {
    return;
  }
  const relayout = (): void => {
    // vditor re-centres the text and the ribbon on window resize.
    window.dispatchEvent(new Event('resize'));
  };
  const save = (): void => {
    vscodeApi.postMessage({ type: 'outlineLayout', position: opts.position, width: outline.offsetWidth || width });
  };
  const clamp = (w: number): number => Math.round(Math.min(Math.max(w, OUTLINE_MIN_WIDTH), Math.max(OUTLINE_MIN_WIDTH, content.clientWidth * 0.6)));
  outline.style.width = `${width}px`;

  const sash = document.createElement('div');
  sash.className = 'docbench-outline-sash';
  sash.title = 'Drag to resize the outline. Double-click to reset its width.';

  const label = document.createElement('span');
  label.textContent = title.textContent;
  const side = document.createElement('button');
  side.type = 'button';
  side.className = 'docbench-outline-side';
  title.replaceChildren(label, side);

  const place = (): void => {
    const left = opts.position === 'left';
    outline.classList.toggle('vditor-outline--right', !left);
    if (left) {
      content.prepend(outline, sash);
    } else {
      content.append(sash, outline);
    }
    side.innerHTML = sideIcon(left ? 'right' : 'left');
    side.title = left ? 'Move the outline to the right' : 'Move the outline to the left';
  };
  place();

  side.addEventListener('click', () => {
    opts.position = opts.position === 'left' ? 'right' : 'left';
    place();
    relayout();
    save();
  });

  // The handle is only there while the outline is shown.
  const syncSash = (): void => {
    sash.style.display = outline.style.display === 'block' ? '' : 'none';
  };
  syncSash();
  new MutationObserver(syncSash).observe(outline, { attributes: true, attributeFilter: ['style'] });

  sash.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) {
      return;
    }
    down.preventDefault();
    sash.setPointerCapture(down.pointerId);
    sash.classList.add('docbench-dragging');
    document.body.classList.add('docbench-resizing');
    const move = (e: PointerEvent): void => {
      const box = content.getBoundingClientRect();
      const w = opts.position === 'left' ? e.clientX - box.left : box.right - e.clientX;
      outline.style.width = `${clamp(w)}px`;
      relayout();
    };
    const up = (): void => {
      sash.removeEventListener('pointermove', move);
      sash.removeEventListener('pointerup', up);
      sash.removeEventListener('pointercancel', up);
      sash.classList.remove('docbench-dragging');
      document.body.classList.remove('docbench-resizing');
      save();
    };
    sash.addEventListener('pointermove', move);
    sash.addEventListener('pointerup', up);
    sash.addEventListener('pointercancel', up);
  });
  sash.addEventListener('dblclick', () => {
    outline.style.width = `${OUTLINE_DEFAULT_WIDTH}px`;
    relayout();
    save();
  });
}

function boot(): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  const cdn = document.body.dataset.vditorCdn ?? '';
  const root = document.body.dataset.vditorRoot ?? '';
  if (!cdn || !root || !('Lute' in window) || !window.VditorI18n) {
    showError('Markdown editor assets failed to load.');
    return;
  }
  markScriptsLoaded();

  let editor: Vditor;
  let timer: number | undefined;
  /** Document text the webview believes the host currently has (EOL-normalised). */
  let synced: string | undefined;
  let darkTheme = isDark();

  const flush = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (!editor?.vditor) {
      return;
    }
    const text = norm(editor.getValue());
    if (text !== synced) {
      synced = text;
      vscodeApi.postMessage({ type: 'edit', text });
    }
  };

  const schedule = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(flush, DEBOUNCE_MS);
  };

  // Images from the internet are off by default (see docbench.markdown.loadRemoteImages). When the
  // document has some, say so and offer a one-click way to show them instead of failing silently.
  const remoteEnabled = document.body.dataset.remoteImages === 'true';
  let noticeDismissed = false;
  const checkRemoteImages = (): void => {
    const existing = document.getElementById('remote-images-notice');
    if (remoteEnabled || noticeDismissed) {
      return;
    }
    // Relative images are rewritten to the https webview resource address (linkBase); those are local.
    const base = document.body.dataset.linkBase ?? '';
    const hasRemote = Array.from(app.querySelectorAll('img')).some((i) => isRemoteImage(i.getAttribute('src') ?? '', base));
    if (!hasRemote) {
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }
    const bar = document.createElement('div');
    bar.id = 'remote-images-notice';
    bar.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:200;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 16px;' +
      'background:var(--vscode-editorWidget-background,#252526);color:var(--vscode-foreground);' +
      'border-top:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,.4));font-family:var(--vscode-font-family);font-size:12px';
    const text = document.createElement('span');
    text.style.flex = '1 1 260px';
    text.textContent =
      'This document has images from the internet (such as badges). They are hidden so the editor makes no network requests on its own.';
    const button = (label: string, title: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.style.cssText =
        'padding:3px 10px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;cursor:pointer;font:inherit;' +
        (primary
          ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground)'
          : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)');
      b.addEventListener('click', onClick);
      return b;
    };
    bar.append(
      text,
      button('Show images', 'Load the images from the internet (turns on the docbench.markdown.loadRemoteImages setting)', true, () =>
        vscodeApi.postMessage({ type: 'enableRemoteImages' }),
      ),
      button('Not now', 'Keep them hidden for this editor session', false, () => {
        noticeDismissed = true;
        bar.remove();
      }),
    );
    document.body.appendChild(bar);
  };

  const applyUpdate = (text: string): void => {
    // The host's version wins over any not-yet-sent local edit.
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    synced = text;
    window.setTimeout(checkRemoteImages, 400);
    if (norm(editor.getValue()) === text) {
      return;
    }
    const box = scroller(editor);
    const top = box?.scrollTop ?? 0;
    editor.setValue(text, true);
    // Lute may re-format the markdown (tables, bullets, ...). Use the re-serialised text as the
    // baseline so flush() on blur / tab hide / Ctrl+S does not rewrite an unedited file.
    synced = norm(editor.getValue());
    if (box) {
      box.scrollTop = top;
      requestAnimationFrame(() => {
        box.scrollTop = top;
      });
    }
  };

  const exportDocx = (): void => {
    if (!editor?.vditor) {
      return;
    }
    const base = document.body.dataset.linkBase ?? '';
    buildExportHtml(editor, 'docx')
      .then((html) => htmlToDocxBase64(html, { allowRemoteImages: remoteEnabled, localBase: base }, document.title))
      .then((data) => vscodeApi.postMessage({ type: 'exportDocx', data }))
      .catch((err) => vscodeApi.postMessage({ type: 'exportDocxFailed', message: String(err instanceof Error ? err.message : err) }));
  };

  const exportPdf = (): void => {
    if (editor?.vditor) {
      // The print page cannot reach the webview resource host, so local images go in as data: URLs.
      const base = document.body.dataset.linkBase ?? '';
      void buildExportHtml(editor, 'pdf')
        .then((html) => inlineLocalImages(html, base))
        .then((html) => vscodeApi.postMessage({ type: 'exportPdf', html }));
    }
  };

  // Images and file links. The host does the file work (open dialog, relative paths, copying dropped
  // files next to the document) and answers with an `insertMarkdown` message; the caret position at the
  // time of the request is kept so the answer lands where the user clicked or dropped.
  let pendingRange: Range | null = null;
  const editorElement = (): HTMLElement | null => {
    const v = editor?.vditor;
    if (!v) {
      return null;
    }
    const mode = editor.getCurrentMode();
    return (mode === 'wysiwyg' ? v.wysiwyg?.element : mode === 'ir' ? v.ir?.element : v.sv?.element) ?? null;
  };
  const rememberCaret = (range?: Range | null): void => {
    const el = editorElement();
    const sel = window.getSelection();
    const r = range ?? (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null);
    pendingRange = r && el && el.contains(r.startContainer) ? r.cloneRange() : null;
  };
  const insertMarkdown = (md: string): void => {
    if (!editor?.vditor || !md) {
      return;
    }
    const el = editorElement();
    if (el && editor.getCurrentMode() !== 'sv') {
      el.focus();
      if (pendingRange && el.contains(pendingRange.startContainer)) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(pendingRange);
      }
    }
    pendingRange = null;
    editor.insertMD(md);
  };
  const pickImage = (): void => {
    rememberCaret();
    vscodeApi.postMessage({ type: 'pickImage' });
  };

  const URI_LIST_TYPES = ['application/vnd.code.uri-list', 'text/uri-list'];
  const isFileDrag = (dt: DataTransfer | null): boolean =>
    !!dt && (dt.types.includes('Files') || URI_LIST_TYPES.some((t) => dt.types.includes(t)));
  const MAX_DROP_BYTES = 25 * 1024 * 1024;
  const readBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  // VS Code only hands a drag to a webview while Shift is held. Files from the Explorer arrive as a
  // URI list (linked with a relative path); files from the operating system arrive as bytes and are
  // copied next to the document. Capture phase, so vditor's own drop (which needs an upload server) never runs.
  app.addEventListener(
    'dragover',
    (e) => {
      if (isFileDrag(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      }
    },
    true,
  );
  app.addEventListener(
    'drop',
    (e) => {
      const dt = e.dataTransfer;
      if (!isFileDrag(dt) || !dt) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const caret = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(
        e.clientX,
        e.clientY,
      );
      rememberCaret(caret);
      let uris: string[] = [];
      for (const t of URI_LIST_TYPES) {
        const raw = dt.getData(t);
        if (raw) {
          uris = raw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('#'));
          if (uris.length) {
            break;
          }
        }
      }
      if (uris.length) {
        vscodeApi.postMessage({ type: 'dropFiles', uris });
        return;
      }
      const files = Array.from(dt.files);
      const tooBig = files.filter((f) => f.size > MAX_DROP_BYTES).map((f) => f.name);
      Promise.all(files.filter((f) => f.size <= MAX_DROP_BYTES).map(async (f) => ({ name: f.name, data: await readBase64(f) })))
        .then((payload) => vscodeApi.postMessage({ type: 'dropFiles', files: payload, tooBig }))
        .catch((err) => showError(`Could not read the dropped file: ${String(err)}`));
    },
    true,
  );

  editor = new Vditor(app, {
    mode: 'wysiwyg',
    lang: 'en_US',
    i18n: window.VditorI18n,
    // Always the local webview URI of the bundled vditor assets, never a remote CDN.
    cdn,
    theme: darkTheme ? 'dark' : 'classic',
    icon: 'ant',
    height: '100%',
    cache: { enable: false },
    toolbarConfig: { pin: true },
    // No upload / record / export / emoji-picker / fullscreen / theme pickers / help:
    // they either need network, runtime script injection, or make no sense in a webview.
    toolbar: [
      'headings',
      'bold',
      'italic',
      'strike',
      'link',
      { name: 'insert-image', icon: IMAGE_ICON, tip: 'Insert image', tipPosition: 'n', click: () => pickImage() },
      '|',
      'list',
      'ordered-list',
      'check',
      'outdent',
      'indent',
      '|',
      // Same button as vditor's 'quote' (shortcut, behaviour) with a curly-quote icon.
      { name: 'quote', icon: QUOTE_ICON },
      'line',
      'code',
      'inline-code',
      'insert-before',
      'insert-after',
      '|',
      'table',
      '|',
      'undo',
      'redo',
      '|',
      'edit-mode',
      'outline',
      '|',
      { name: 'export-pdf', icon: EXPORT_ICON, tip: 'Export to PDF', tipPosition: 'n', click: exportPdf },
      { name: 'export-docx', icon: DOCX_ICON, tip: 'Export to Word', tipPosition: 'n', click: exportDocx },
    ],
    outline: { enable: false, position: document.body.dataset.outlinePosition === 'left' ? 'left' : 'right' },
    preview: {
      // Split-view preview bar: page-width presets only.
      actions: ['desktop', 'tablet', 'mobile'],
      // Code blocks are highlighted (github / github-dark style, matching the VS Code theme).
      hljs: { enable: true, lineNumber: false, style: darkTheme ? 'github-dark' : 'github' },
      // KaTeX renders $inline$ and $block$ maths, as on GitHub.
      math: { engine: 'KaTeX', inlineDigit: false },
      theme: {
        current: darkTheme ? 'dark' : 'light',
        path: `${root}/css/content-theme`,
        list: { light: 'Light', dark: 'Dark' },
      },
      // GitHub-flavoured Markdown: tables, task lists, strikethrough and footnotes (engine defaults), maths,
      // and fenced code previews (mermaid diagrams, highlighting). Two engine rewrites are switched off
      // because they would change the text of the file: vditor's callout format (it turns the GitHub
      // alert `> [!NOTE]` into `> [!NOTE] ✏️ Note`) and auto-link rewriting (bare URLs would become [url](url)).
      // Other diagram engines (graphviz, echarts, plantuml, ...) are not shipped.
      markdown: {
        inlineMath: true,
        mathBlockPreview: true,
        codeBlockPreview: true,
        callout: false,
        gfmAutoLink: false,
        footnotes: true,
        // Relative image paths are resolved against the document's folder for display only.
        linkBase: document.body.dataset.linkBase ?? '',
      },
      render: { media: { enable: false } },
    },
    after: () => {
      addToolbarTooltips(app);
      labelPreviewActions(app);
      setupOutline(editor, Math.max(OUTLINE_MIN_WIDTH, Number(document.body.dataset.outlineWidth) || OUTLINE_DEFAULT_WIDTH));
      vscodeApi.postMessage({ type: 'ready' });
    },
    input: schedule,
  });

  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type?: string; message?: unknown } | undefined;
    if (msg?.type === 'update') {
      if (editor?.vditor) {
        applyUpdate((msg as unknown as UpdateMessage).text);
      }
    } else if (msg?.type === 'insertMarkdown') {
      insertMarkdown(String((msg as { markdown?: unknown }).markdown ?? ''));
    } else if (msg?.type === 'requestExport') {
      exportPdf();
    } else if (msg?.type === 'requestExportDocx') {
      exportDocx();
    } else if (msg?.type === 'error') {
      showError(String(msg.message));
    }
  });

  // Do not lose the last keystrokes when focus leaves, the tab is hidden or the user saves.
  app.addEventListener('focusout', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        flush();
      }
    },
    true,
  );

  // GitHub alerts (`> [!NOTE]`): tag the quote so CSS can colour it. Display only; the markdown is untouched.
  const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
  let alertFrame = 0;
  const decorateAlerts = (): void => {
    alertFrame = 0;
    app.querySelectorAll('.vditor-reset blockquote').forEach((q) => {
      const m = ALERT_RE.exec(q.querySelector(':scope > p')?.textContent ?? '');
      const kind = m ? m[1].toLowerCase() : null;
      if (kind !== q.getAttribute('data-gh-alert')) {
        if (kind) {
          q.setAttribute('data-gh-alert', kind);
        } else {
          q.removeAttribute('data-gh-alert');
        }
      }
    });
  };
  new MutationObserver(() => {
    if (!alertFrame) {
      alertFrame = requestAnimationFrame(decorateAlerts);
    }
  }).observe(app, { childList: true, subtree: true, characterData: true });

  // Follow VS Code light/dark theme changes.
  new MutationObserver(() => {
    const dark = isDark();
    if (dark !== darkTheme && editor?.vditor) {
      darkTheme = dark;
      editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'github-dark' : 'github');
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

boot();
