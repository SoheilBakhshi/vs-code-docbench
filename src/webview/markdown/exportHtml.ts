// `editor.getHTML()` gives the document's raw source for Mermaid diagrams, maths and fenced code, which
// is not what a PDF or Word file should show. This builds export HTML that carries what the editor
// renders: diagrams (re-rendered in the light theme so they stay readable on a white page), KaTeX
// maths, highlighted code, and GitHub alerts as labelled boxes.
import type Vditor from 'vditor';

declare const mermaid: {
  initialize(options: object): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

export type ExportTarget = 'pdf' | 'docx';

const ALERTS: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};
const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/** Renders Mermaid source to an SVG string in the light theme with plain-SVG labels (no foreignObject). */
async function lightDiagram(source: string, index: number): Promise<string | undefined> {
  if (typeof mermaid === 'undefined') {
    return undefined;
  }
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'default',
      fontFamily: 'sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    const { svg } = await mermaid.render(`docbench-export-${index}`, source);
    return svg;
  } catch {
    return undefined;
  } finally {
    // mermaid leaves its scratch element behind when rendering fails
    document.getElementById(`ddocbench-export-${index}`)?.remove();
    document.getElementById(`docbench-export-${index}`)?.remove();
  }
}

function labelAlerts(doc: Document): void {
  doc.querySelectorAll('blockquote').forEach((quote) => {
    const first = quote.querySelector(':scope > p');
    const m = first ? ALERT_RE.exec(first.textContent ?? '') : null;
    if (!first || !m) {
      return;
    }
    const kind = m[1].toUpperCase();
    quote.setAttribute('data-gh-alert', kind.toLowerCase());
    // drop the "[!NOTE]" marker (and the line break after it) and put a bold label in front
    const marker = first.firstChild;
    if (marker?.nodeType === Node.TEXT_NODE) {
      marker.textContent = (marker.textContent ?? '').replace(ALERT_RE, '');
      if (!marker.textContent) {
        marker.remove();
      }
    }
    if (first.firstElementChild?.tagName === 'BR') {
      first.firstElementChild.remove();
    }
    const label = doc.createElement('strong');
    label.className = 'alert-title';
    label.textContent = ALERTS[kind];
    first.prepend(label, doc.createElement('br'));
  });
}

/** Rasterises an SVG string to a PNG data URL (Word cannot embed SVG reliably). */
async function svgToPng(svg: string): Promise<{ url: string; w: number; h: number } | undefined> {
  const vb = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  if (!vb) {
    return undefined;
  }
  const w = Math.ceil(parseFloat(vb[1]));
  const h = Math.ceil(parseFloat(vb[2]));
  const sized = svg.replace(/<svg([^>]*?)>/, (_m, attrs: string) =>
    `<svg${attrs.replace(/\s(width|height|style)="[^"]*"/g, '')} width="${w}" height="${h}">`);
  const img = new Image();
  const loaded = new Promise<boolean>((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  if (!(await loaded)) {
    return undefined;
  }
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return undefined;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return { url: canvas.toDataURL('image/png'), w, h };
  } catch {
    return undefined;
  }
}

export async function buildExportHtml(editor: Vditor, target: ExportTarget): Promise<string> {
  const root: HTMLElement = editor.vditor.wysiwyg?.element ?? document.body;
  const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html');

  // Mermaid diagrams
  const diagrams = Array.from(doc.querySelectorAll('div.language-mermaid'));
  for (let i = 0; i < diagrams.length; i++) {
    const svg = await lightDiagram(diagrams[i].textContent ?? '', i);
    if (!svg) {
      continue;
    }
    if (target === 'docx') {
      const png = await svgToPng(svg);
      if (png) {
        const p = doc.createElement('p');
        const img = doc.createElement('img');
        img.src = png.url;
        img.setAttribute('width', String(Math.min(png.w, 600)));
        img.alt = 'Mermaid diagram';
        p.append(img);
        diagrams[i].replaceWith(p);
      }
    } else {
      diagrams[i].classList.add('mermaid-diagram');
      diagrams[i].innerHTML = svg;
    }
  }

  if (target === 'pdf') {
    // KaTeX maths: take the markup the editor already rendered, in document order.
    const liveMath = Array.from(root.querySelectorAll('.vditor-wysiwyg__preview .language-math[data-math]'));
    const mathNodes = Array.from(doc.querySelectorAll('.language-math'));
    if (liveMath.length === mathNodes.length) {
      mathNodes.forEach((node, i) => {
        node.innerHTML = liveMath[i].innerHTML;
      });
    }
    // Highlighted code
    const liveCode = Array.from(root.querySelectorAll('pre.vditor-wysiwyg__preview > code.hljs'));
    const codeNodes = Array.from(doc.querySelectorAll('pre > code')).filter((c) => !c.closest('.mermaid-diagram'));
    if (liveCode.length === codeNodes.length) {
      codeNodes.forEach((node, i) => {
        node.innerHTML = liveCode[i].innerHTML;
        node.classList.add('hljs');
      });
    }
  } else {
    // Word has no maths engine here: keep the LaTeX source, in code style, between $ delimiters.
    doc.querySelectorAll('.language-math').forEach((node) => {
      const code = doc.createElement('code');
      const block = node.tagName === 'DIV';
      code.textContent = block ? `$$ ${node.textContent ?? ''} $$` : `$${(node.textContent ?? '').replace(/​/g, '')}$`;
      node.replaceWith(code);
    });
  }

  // in-page anchors (footnotes) were rewritten against the file's folder for display; make them plain again
  doc.querySelectorAll('a[href*="#"]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    const hash = href.slice(href.indexOf('#'));
    if (/^#?footnotes-/.test(hash.slice(1)) || hash.startsWith('#footnotes-')) {
      a.setAttribute('href', hash);
    }
  });
  labelAlerts(doc);
  return doc.body.innerHTML;
}
