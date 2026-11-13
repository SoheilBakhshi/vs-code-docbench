// Converts the editor's rendered HTML into a Word (.docx) file, entirely inside the webview, so it
// works in desktop and web VS Code. Supports headings, paragraphs, inline formatting, links, lists
// (nested, ordered, task), quotes, code blocks, rules, tables and images (png / jpg / gif / bmp).
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

type Block = Paragraph | Table;
type Inline = TextRun | ExternalHyperlink | ImageRun;

interface Style {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  underline?: boolean;
}

export interface DocxOptions {
  /** Fetch images that live on the internet (otherwise they become their alt text). */
  allowRemoteImages: boolean;
  /** Origin prefix of locally served images (the webview's resource URL); those are always fetched. */
  localBase: string;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const MAX_IMAGE_WIDTH = 600; // px, fits an A4 page with normal margins
const MAX_LIST_LEVEL = 8;

function imageKind(b: Uint8Array): 'png' | 'jpg' | 'gif' | 'bmp' | undefined {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return undefined;
}

/** Pixel size read from the image header (no decoding, so it works anywhere). */
function imageSize(b: Uint8Array, kind: 'png' | 'jpg' | 'gif' | 'bmp'): { w: number; h: number } | undefined {
  const be16 = (i: number): number => (b[i] << 8) | b[i + 1];
  const be32 = (i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number): number => b[i] | (b[i + 1] << 8);
  const le32 = (i: number): number => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let size: { w: number; h: number } | undefined;
  if (kind === 'png' && b.length > 24) {
    size = { w: be32(16), h: be32(20) };
  } else if (kind === 'gif' && b.length > 10) {
    size = { w: le16(6), h: le16(8) };
  } else if (kind === 'bmp' && b.length > 26) {
    size = { w: le32(18), h: Math.abs(le32(22) | 0) };
  } else if (kind === 'jpg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        size = { w: be16(i + 7), h: be16(i + 5) };
        break;
      }
      i += 2 + be16(i + 2);
    }
  }
  return size && size.w > 0 && size.h > 0 ? size : undefined;
}

async function loadImage(src: string, opts: DocxOptions): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; w: number; h: number } | undefined> {
  const isData = src.startsWith('data:');
  const isLocal = opts.localBase !== '' && src.startsWith(opts.localBase);
  const isRemote = /^https?:/i.test(src) && !isLocal;
  if (isRemote && !opts.allowRemoteImages) return undefined;
  if (!isData && !isLocal && !isRemote) return undefined;
  try {
    let data: Uint8Array;
    if (isData) {
      // decoded directly: the webview CSP does not allow fetch() of data: URLs
      const comma = src.indexOf(',');
      const head = src.slice(0, comma);
      const body = src.slice(comma + 1);
      if (/;base64/i.test(head)) {
        const bin = atob(body);
        data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      } else {
        data = new TextEncoder().encode(decodeURIComponent(body));
      }
    } else {
      const res = await fetch(src);
      if (!res.ok) return undefined;
      data = new Uint8Array(await res.arrayBuffer());
    }
    const type = imageKind(data);
    if (!type) return undefined; // svg / webp are not supported by Word's image format list
    const size = imageSize(data, type);
    return size ? { data, type, ...size } : undefined;
  } catch {
    return undefined;
  }
}

class Converter {
  private olInstance = 0;

  constructor(private readonly opts: DocxOptions) {}

  async blocks(parent: Node, listLevel = -1, listRef?: { ref: string; instance: number }): Promise<Block[]> {
    const out: Block[] = [];
    let pending: Inline[] = [];
    const flush = (): void => {
      if (pending.length) {
        out.push(new Paragraph({ children: pending, spacing: { after: 120 } }));
        pending = [];
      }
    };
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.textContent ?? '').trim()) pending.push(...(await this.inline(node, {})));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (!isBlockTag(tag)) {
        pending.push(...(await this.inline(el, {})));
        continue;
      }
      flush();
      out.push(...(await this.block(el, tag, listLevel, listRef)));
    }
    flush();
    return out;
  }

  private async block(el: HTMLElement, tag: string, listLevel: number, listRef?: { ref: string; instance: number }): Promise<Block[]> {
    if (/^h[1-6]$/.test(tag)) {
      return [new Paragraph({ heading: HEADINGS[Number(tag[1]) - 1], children: await this.inline(el, {}), spacing: { before: 240, after: 120 } })];
    }
    switch (tag) {
      case 'p':
        return [new Paragraph({ children: await this.inline(el, {}), spacing: { after: 120 } })];
      case 'ul':
      case 'ol':
        return this.list(el, tag, Math.min(listLevel + 1, MAX_LIST_LEVEL));
      case 'li':
        return this.listItem(el, listLevel < 0 ? 0 : listLevel, listRef ?? { ref: 'ul', instance: 0 });
      case 'blockquote':
        return this.quote(el);
      case 'pre':
        return this.code(el);
      case 'hr':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B0B7C3', space: 1 } }, spacing: { before: 120, after: 120 } })];
      case 'table':
        return [await this.table(el)];
      default:
        return this.blocks(el, listLevel, listRef);
    }
  }

  /** Blockquote: its paragraphs get an indent and a left rule. */
  private async quote(el: HTMLElement): Promise<Block[]> {
    const out: Block[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node as HTMLElement;
        const tag = child.tagName.toLowerCase();
        if (tag === 'p' || /^h[1-6]$/.test(tag)) {
          out.push(
            new Paragraph({
              children: await this.inline(child, { color: '59636E' }),
              indent: { left: 540 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'B0B7C3', space: 8 } },
              spacing: { after: 100 },
            }),
          );
        } else {
          out.push(...(await this.block(child, tag, -1)));
        }
      }
    }
    return out;
  }

  private code(el: HTMLElement): Paragraph[] {
    const text = (el.textContent ?? '').replace(/\n$/, '');
    return text.split('\n').map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line === '' ? ' ' : line, font: 'Consolas', size: 19 })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F4F6' },
          spacing: { after: 0, line: 260 },
          indent: { left: 120, right: 120 },
        }),
    );
  }

  private async list(el: HTMLElement, tag: 'ul' | 'ol', level: number): Promise<Block[]> {
    const ref = tag === 'ol' ? { ref: 'ol', instance: ++this.olInstance } : { ref: 'ul', instance: 0 };
    const out: Block[] = [];
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() === 'li') out.push(...(await this.listItem(li as HTMLElement, level, ref)));
    }
    return out;
  }

  private async listItem(li: HTMLElement, level: number, ref: { ref: string; instance: number }): Promise<Block[]> {
    const out: Block[] = [];
    let inline: Inline[] = [];
    const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
    if (checkbox) {
      inline.push(new TextRun({ text: checkbox.checked ? '☑ ' : '☐ ' }));
    }
    const flush = (): void => {
      if (inline.length) {
        out.push(new Paragraph({ children: inline, numbering: { reference: ref.ref, level, instance: ref.instance }, spacing: { after: 60 } }));
        inline = [];
      }
    };
    for (const node of Array.from(li.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) {
        continue; // whitespace between the item's text and a nested list
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') {
          flush();
          out.push(...(await this.list(el, tag, Math.min(level + 1, MAX_LIST_LEVEL))));
          continue;
        }
        if (tag === 'input') continue;
        if (tag === 'p') {
          inline.push(...(await this.inline(el, {})));
          continue;
        }
      }
      inline.push(...(await this.inline(node, {})));
    }
    flush();
    if (!out.length) out.push(new Paragraph({ children: [], numbering: { reference: ref.ref, level, instance: ref.instance } }));
    return out;
  }

  private async table(el: HTMLElement): Promise<Table> {
    const rows: TableRow[] = [];
    for (const tr of Array.from(el.querySelectorAll('tr'))) {
      const cells: TableCell[] = [];
      for (const td of Array.from(tr.children)) {
        const header = td.tagName.toLowerCase() === 'th';
        cells.push(
          new TableCell({
            children: [new Paragraph({ children: await this.inline(td, header ? { bold: true } : {}), spacing: { after: 40 } })],
            shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          }),
        );
      }
      if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: tr.parentElement?.tagName.toLowerCase() === 'thead' }));
    }
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  async inline(node: Node, style: Style): Promise<Inline[]> {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      return text ? [this.run(text, style)] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const next: Style = { ...style };
    switch (tag) {
      case 'strong':
      case 'b':
        next.bold = true;
        break;
      case 'em':
      case 'i':
        next.italics = true;
        break;
      case 'del':
      case 's':
      case 'strike':
        next.strike = true;
        break;
      case 'code':
        next.code = true;
        break;
      case 'br':
        return [new TextRun({ break: 1 })];
      case 'img':
        return this.image(el);
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        const kids = await this.children(el, { ...next, color: '0969DA', underline: true });
        return /^(https?:|mailto:)/i.test(href) ? [new ExternalHyperlink({ link: href, children: kids as TextRun[] })] : kids;
      }
      case 'input':
        return [];
    }
    return this.children(el, next);
  }

  private async children(el: HTMLElement, style: Style): Promise<Inline[]> {
    const out: Inline[] = [];
    for (const child of Array.from(el.childNodes)) out.push(...(await this.inline(child, style)));
    return out;
  }

  private run(text: string, s: Style): TextRun {
    return new TextRun({
      text,
      bold: s.bold,
      italics: s.italics,
      strike: s.strike,
      color: s.color,
      underline: s.underline ? {} : undefined,
      font: s.code ? 'Consolas' : undefined,
      shading: s.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EFF1F3' } : undefined,
    });
  }

  private async image(el: HTMLElement): Promise<Inline[]> {
    const alt = el.getAttribute('alt') ?? '';
    const loaded = await loadImage(el.getAttribute('src') ?? '', this.opts);
    if (!loaded) return alt ? [this.run(`[image: ${alt}]`, { italics: true, color: '666666' })] : [];
    const scale = Math.min(1, MAX_IMAGE_WIDTH / loaded.w);
    return [
      new ImageRun({
        type: loaded.type,
        data: loaded.data,
        transformation: { width: Math.round(loaded.w * scale), height: Math.round(loaded.h * scale) },
        altText: { name: alt || 'image', title: alt || 'image', description: alt || 'image' },
      }),
    ];
  }
}

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'details', 'figure', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const isBlockTag = (tag: string): boolean => BLOCK_TAGS.has(tag);

/** Builds the .docx and returns it as a base64 string (the safest shape to post to the extension host). */
export async function htmlToDocxBase64(html: string, opts: DocxOptions, title: string): Promise<string> {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const children = await new Converter(opts).blocks(dom.body);
  const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (l: number) => string) =>
    Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
      level,
      format,
      text: text(level),
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 540 + level * 360, hanging: 270 } } },
    }));
  const doc = new Document({
    title,
    creator: 'Docbench',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'ul', levels: levels(LevelFormat.BULLET, () => '•') },
        { reference: 'ol', levels: levels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: children.length ? children : [new Paragraph({})],
      },
    ],
  });
  return Packer.toBase64String(doc);
}
