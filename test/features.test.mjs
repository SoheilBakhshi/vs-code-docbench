// Feature tests for Docbench's webviews with Chinese, Japanese and Korean documents.
//
// The real built webview bundles (media/) run in headless Chromium, driven by the real editor
// providers (src/editors/*.ts) through a stand-in for the VS Code API; see test/helpers/host.mjs.
// Build first: `npm run compile`. Run: `node --test test/features.test.mjs`.
//
// All CJK sample text comes from test/fixtures/cjk-samples.mjs.
//
// Environment knobs (both optional): DOCBENCH_TEST_ROOT=<dir> tests another checkout or build output
// (a folder with src/, media/ and node_modules/); DOCBENCH_TEST_KEEP=1 keeps the temporary fixture
// folder (its path is printed) so exported files can be inspected.
// The PDF export test starts Playwright's Chromium through a small wrapper that adds --no-sandbox,
// because Chromium refuses to start as root without it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import * as S from './fixtures/cjk-samples.mjs';
import { REPO, startHost } from './helpers/host.mjs';
import { neverCancelled, TextDocument, Uri } from './helpers/vscode-stub.mjs';

const require = createRequire(path.join(REPO, 'package.json'));
const JSZip = require('jszip');
const XLSX = require('xlsx');
const docx = require('docx');

/** Any Han, kana or Hangul character. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const noWs = (s) => s.replace(/[\s​]+/g, '');
const countOf = (s, ch) => s.split(ch).length - 1;
/** A solid-colour RGB PNG of the given size (an odd size, so it can be recognised in exported files). */
function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([0x2a, 0x7a, 0xc0]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const IMG_W = 37;
const IMG_H = 23;
const PNG = makePng(IMG_W, IMG_H);
const TIMEOUT = { timeout: 90_000 };

let host;
before(async () => {
  host = await startHost();
});
after(async () => {
  await host?.close();
});

/** No request left the machine and the page asked for nothing outside its resource roots. */
function assertContained(panel) {
  assert.deepEqual(panel.externalRequests, [], 'the webview made requests to outside addresses');
  assert.deepEqual(panel.deniedResources, [], 'the webview asked for files outside its localResourceRoots');
  assert.deepEqual(panel.pageErrors, [], 'uncaught errors in the webview');
}

async function pdfText(bytes) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  /** Pixel sizes of the drawn images, as "WxH". */
  const images = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).join(''));
    const ops = await page.getOperatorList();
    ops.fnArray.forEach((f, k) => {
      if (f === pdfjs.OPS.paintImageXObject) images.push(`${ops.argsArray[k][1]}x${ops.argsArray[k][2]}`);
    });
  }
  await task.destroy();
  return { pages, images };
}

async function docxParagraphs(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) =>
    [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => unescape(t[1])).join(''),
  );
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir);
  return { xml, paragraphs, media };
}

const browserLog = () => path.join(host.tmp, 'chromium-for-export.log');
const browserLogTail = () => {
  try { return readFileSync(browserLog(), 'utf8').split('\n').slice(-40).join('\n'); } catch { return '(no browser output)'; }
};

/** Writes a wrapper that starts Playwright's Chromium for the PDF exporter (root needs --no-sandbox). */
function browserWrapper() {
  // DOCBENCH_TEST_PDF_BROWSER picks an installed browser instead (CI uses the runner's Google Chrome).
  const exe = process.env.DOCBENCH_TEST_PDF_BROWSER || require('playwright').chromium.executablePath();
  const file = path.join(host.tmp, 'chromium-for-export.sh');
  // The browser's own output goes to a log, which a failing export test prints.
  writeFileSync(file, `#!/bin/sh\nexec "${exe}" --no-sandbox "$@" >>"${browserLog()}" 2>&1\n`, { mode: 0o755 });
  return file;
}

async function waitFor(cond, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------------------------------
// 1-2. Markdown editor (vditor fork) and its exports
// ---------------------------------------------------------------------------------------------------

describe('markdown editor', () => {
  let md;
  /** Paragraphs of the Word export made by the first export test. */
  let lastDocx;
  /** Opens the sample document once; every test below reuses it (the edit test runs last). */
  const openSample = async () => {
    if (!md) {
      md = (async () => {
        await host.writeFixture('docs/image.png', PNG);
        const file = await host.writeFixture('docs/sample.md', S.MARKDOWN_DOC);
        const opened = await host.open('docbench.markdown', file, { languageId: 'markdown' });
        await opened.panel.waitForMessage('ready', 30_000, "the Markdown editor's 'ready' message");
        // The host answers 'ready' with the document; wait until it is rendered (diagram and maths included).
        await opened.page.waitForFunction(
          () =>
            document.querySelector('.vditor-wysiwyg .language-mermaid svg') &&
            document.querySelectorAll('.vditor-wysiwyg .katex').length >= 2 &&
            document.querySelector('.vditor-wysiwyg code.hljs'),
          null,
          { timeout: 20_000 },
        );
        return opened;
      })();
    }
    return md;
  };

  test('renders a CJK document: text, table, task list, emphasis, image, mermaid, KaTeX, highlighting', TIMEOUT, async () => {
    const { page, panel } = await openSample();
    assert.equal(panel.received[0]?.type, 'ready', "the editor posts 'ready' first");
    const dom = await page.evaluate(() => {
      const root = document.querySelector('.vditor-wysiwyg > .vditor-reset');
      const text = (el) => (el?.textContent ?? '').replace(/​/g, '');
      return {
        headings: ['h1', 'h2', 'h3', 'h4'].map((h) => text(root.querySelector(h)).trim()),
        paragraphs: [...root.querySelectorAll(':scope > p')].map(text),
        strong: text(root.querySelector('strong')),
        em: text(root.querySelector('em')),
        strike: text(root.querySelector('s, del')),
        th: [...root.querySelectorAll('table th')].map((c) => text(c).trim()),
        td: [...root.querySelectorAll('table td')].map((c) => text(c).trim()),
        tasks: [...root.querySelectorAll('li.vditor-task')].map((li) => ({ text: text(li).trim(), checked: li.querySelector('input')?.checked })),
        img: [...root.querySelectorAll('img')].map((i) => ({ alt: i.getAttribute('alt'), size: `${i.naturalWidth}x${i.naturalHeight}` })),
        mermaidText: text(root.querySelector('.language-mermaid svg')),
        katex: [...root.querySelectorAll('.katex')].map((k) => ({
          html: text(k.querySelector('.katex-html')),
          tex: k.closest('[data-math]')?.getAttribute('data-math') ?? '',
        })),
        katexErrors: root.querySelectorAll('.katex-error').length,
        hljsComment: text(root.querySelector('code.hljs .hljs-comment')),
        hljsString: text(root.querySelector('code.hljs .hljs-string')),
        hljsKeyword: root.querySelectorAll('code.hljs .hljs-keyword').length,
      };
    });
    assert.deepEqual(dom.headings, [S.HANS_HEADING, S.HANT_HEADING, S.JA_HEADING, S.KO_HEADING]);
    for (const p of [S.HANS_PARAGRAPH, S.HANT_PARAGRAPH, S.JA_PARAGRAPH, S.KO_PARAGRAPH, S.SPACE_PARAGRAPH, S.INDENTED_PARAGRAPH]) {
      assert.ok(dom.paragraphs.includes(p), `paragraph not rendered unchanged: ${JSON.stringify(p)}\nrendered: ${JSON.stringify(dom.paragraphs)}`);
    }
    assert.equal(dom.strong, S.BOLD_TEXT);
    assert.equal(dom.em, S.ITALIC_TEXT);
    assert.equal(dom.strike, S.STRIKE_TEXT);
    assert.deepEqual(dom.th, S.TABLE_HEADER);
    assert.deepEqual(dom.td, S.TABLE_ROWS.flat());
    assert.deepEqual(dom.tasks, [
      { text: S.TASK_OPEN, checked: false },
      { text: S.TASK_DONE, checked: true },
    ]);
    assert.deepEqual(dom.img, [{ alt: S.IMAGE_ALT, size: `${IMG_W}x${IMG_H}` }], 'the relative image shows, with its CJK alt text');
    for (const label of S.MERMAID_LABELS) {
      assert.ok(dom.mermaidText.includes(label), `mermaid SVG lacks the node label ${JSON.stringify(label)}: ${JSON.stringify(dom.mermaidText)}`);
    }
    assert.equal(dom.katexErrors, 0, 'KaTeX reported an error (is mhchem loaded?)');
    assert.equal(dom.katex.length, 2, 'one inline and one block formula');
    assert.ok(dom.katex.some((k) => k.tex.includes('a^2')), `inline maths rendered by KaTeX: ${JSON.stringify(dom.katex)}`);
    const block = dom.katex.find((k) => k.tex.includes('\\ce{H2O}'));
    assert.ok(block, 'block maths with \\ce{H2O} rendered by KaTeX');
    assert.ok(block.html.includes(S.MATH_TEXT), `\\text{} CJK missing from the KaTeX output: ${JSON.stringify(block.html)}`);
    assert.match(noWs(block.html), /H.*2.*O/, 'mhchem output for H2O');
    assert.equal(dom.hljsComment, `// ${S.CODE_COMMENT}`);
    assert.equal(dom.hljsString, `"${S.CODE_STRING}"`);
    assert.ok(dom.hljsKeyword > 0, 'highlight.js keyword classes');
    assertContained(panel);
    assert.deepEqual(panel.missingResources, [], 'the editor asked for runtime files that are not shipped');
  });

  test('toolbar holds exactly the configured buttons and the interface is English only', TIMEOUT, async () => {
    const { page, panel } = await openSample();
    const ui = await page.evaluate(() => {
      const toolbar = document.querySelector('.vditor-toolbar');
      const buttons = [...toolbar.querySelectorAll('.vditor-toolbar__item > [data-type]')].map((b) => b.dataset.type);
      // Every piece of interface text: text nodes and labelling attributes outside the document content.
      const content = (el) => el.closest('.vditor-reset, .vditor-outline__content, .vditor-sv, .vditor-ir');
      const strings = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walker.currentNode; n; n = walker.nextNode()) {
        const el = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
        if (!el || content(el)) continue;
        if (n.nodeType === Node.TEXT_NODE) strings.push(n.textContent);
        else for (const a of ['title', 'aria-label', 'placeholder', 'data-tip']) if (n.hasAttribute(a)) strings.push(n.getAttribute(a));
      }
      const i18n = window.VditorI18n ?? {};
      return { buttons, strings: strings.map((s) => s.trim()).filter(Boolean), i18nValues: Object.values(i18n).map(String), i18nCount: Object.keys(i18n).length };
    });
    assert.deepEqual(ui.buttons, [
      'headings', 'bold', 'italic', 'strike', 'link', 'insert-image',
      'list', 'ordered-list', 'check', 'outdent', 'indent',
      'quote', 'line', 'code', 'inline-code', 'insert-before', 'insert-after',
      'table', 'undo', 'redo', 'edit-mode', 'outline', 'export-pdf', 'export-docx',
    ]);
    const cjkUi = ui.strings.filter((s) => CJK.test(s));
    assert.deepEqual(cjkUi, [], 'interface strings with CJK characters');
    assert.ok(ui.strings.includes('Export to Word: save this document as a .docx file'), 'English button titles are present');
    assert.ok(ui.i18nCount > 50, 'English interface strings are loaded');
    assert.deepEqual(ui.i18nValues.filter((s) => CJK.test(s)), [], 'the loaded interface strings contain CJK text');
    assert.deepEqual(readdirSync(path.join(REPO, 'media/markdown/vditor/dist/js/i18n')), ['en_US.js'], 'only the English interface language ships');
    assertContained(panel);
  });

  test('an unchanged document is never written back (canonical and re-formatted input)', TIMEOUT, async () => {
    const { page, panel, document } = await openSample();
    const flushAll = async (p) => {
      // Every path that makes the webview send pending text: focus loss, Ctrl+S, tab hidden.
      await p.focus('.vditor-wysiwyg > .vditor-reset');
      await p.evaluate(() => document.querySelector('.vditor-wysiwyg > .vditor-reset').blur());
      await p.keyboard.press('Control+s');
      await p.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
      });
      await p.waitForTimeout(600);
    };
    await flushAll(page);
    assert.deepEqual(panel.received.filter((m) => m.type === 'edit'), [], 'the editor posted an edit for an unchanged document');
    assert.equal(document.getText(), S.MARKDOWN_DOC, 'the host document changed');

    // Same content in a form the engine re-formats (compact table, '-' bullets): still not rewritten.
    const compact = [
      `# ${S.HANS_HEADING}`,
      '',
      S.SPACE_PARAGRAPH,
      '',
      `|${S.TABLE_HEADER[0]}|${S.TABLE_HEADER[1]}|`,
      '|---|---|',
      ...S.TABLE_ROWS.map((r) => `|${r[0]}|${r[1]}|`),
      '',
      `- [ ] ${S.TASK_OPEN}`,
      `- [x] ${S.TASK_DONE}`,
      '',
    ].join('\n');
    const file = await host.writeFixture('docs/compact.md', compact);
    const other = await host.open('docbench.markdown', file, { languageId: 'markdown' });
    try {
      await other.panel.waitForMessage('ready', 30_000, "the second editor's 'ready' message");
      await other.page.waitForSelector('.vditor-wysiwyg table td');
      await flushAll(other.page);
      assert.deepEqual(other.panel.received.filter((m) => m.type === 'edit'), [], 'a re-formatted but unedited document was rewritten');
      assert.equal(other.document.getText(), compact);
    } finally {
      await other.panel.dispose();
    }
  });

  test('Export to Word: the .docx holds the CJK text exactly and the rendered diagram', TIMEOUT, async () => {
    const { panel } = await openSample();
    const target = path.join(host.workspace, 'docs', 'sample.docx');
    host.state.saveDialogTarget = Uri.file(target);
    const before = panel.received.length;
    await host.state.commands.get('docbench.exportMarkdownDocx')();
    const msg = await panel.waitForNextMessage((m) => m.type === 'exportDocx' || m.type === 'exportDocxFailed', 30_000, 'the Word export');
    assert.equal(msg.type, 'exportDocx', `Word export failed: ${msg.message}`);
    await waitFor(() => host.state.messages.some((m) => m.message === 'Docbench: exported sample.docx'), 10_000, 'the host to save the .docx');
    const fromMessage = await docxParagraphs(Buffer.from(msg.data, 'base64'));
    const saved = await docxParagraphs(readFileSync(target));
    assert.deepEqual(saved.paragraphs, fromMessage.paragraphs, 'the saved file is the one the webview produced');
    const paras = saved.paragraphs;
    // (Paragraphs with ideographic spaces are checked in the next test.)
    for (const s of [S.HANS_HEADING, S.HANT_HEADING, S.JA_HEADING, S.KO_HEADING, S.HANS_PARAGRAPH, S.HANT_PARAGRAPH,
      S.JA_PARAGRAPH, S.KO_PARAGRAPH, S.TASK_OPEN, S.TASK_DONE]) {
      assert.ok(paras.some((p) => p === s || p.endsWith(` ${s}`) || p.endsWith(s)), `paragraph missing or changed in document.xml: ${JSON.stringify(s)}\n${JSON.stringify(paras)}`);
    }
    const all = paras.join('\n');
    for (const s of [S.BOLD_TEXT, S.ITALIC_TEXT, S.STRIKE_TEXT, ...S.TABLE_HEADER, ...S.TABLE_ROWS.flat(), S.CODE_COMMENT, S.CODE_STRING, S.MATH_TEXT]) {
      assert.ok(all.includes(s), `document.xml lacks ${JSON.stringify(s)}`);
    }
    assert.ok(saved.media.length >= 1, 'the mermaid diagram is embedded as a picture');
    assert.ok(panel.received.length > before);
    assertContained(panel);
    lastDocx = saved;
  });

  test('Export to Word keeps ideographic spaces (U+3000)', TIMEOUT, async () => {
    assert.ok(lastDocx, 'needs the previous export');
    const bug =
      'PRODUCT BUG: ideographic spaces are turned into ASCII spaces in the Word export. src/webview/markdown/toDocx.ts ' +
      "inline() collapses whitespace with .replace(/\\s+/g, ' '), and JavaScript's \\s also matches U+3000 (and U+00A0).";
    assert.ok(lastDocx.paragraphs.includes(S.SPACE_PARAGRAPH), `${bug} Paragraph: ${JSON.stringify(lastDocx.paragraphs.find((p) => p.startsWith(S.SPACE_PARAGRAPH.slice(0, 2))))}`);
    assert.ok(lastDocx.paragraphs.includes(S.INDENTED_PARAGRAPH), `${bug} (leading indent)`);
    assert.equal(countOf(lastDocx.paragraphs.join('\n'), S.IDEOGRAPHIC_SPACE), countOf(S.MARKDOWN_DOC, S.IDEOGRAPHIC_SPACE), bug);
  });

  test('Export to Word embeds images that are next to the document', TIMEOUT, async () => {
    const { panel } = await openSample();
    host.state.saveDialogTarget = Uri.file(path.join(host.workspace, 'docs', 'sample-images.docx'));
    await host.state.commands.get('docbench.exportMarkdownDocx')();
    const msg = await panel.waitForNextMessage('exportDocx', 30_000, 'the Word export');
    const { paragraphs, media } = await docxParagraphs(Buffer.from(msg.data, 'base64'));
    const placeholder = paragraphs.find((p) => p.includes('[image:'));
    assert.equal(
      placeholder,
      undefined,
      'PRODUCT BUG: the local image (docs/image.png) was replaced by its alt text in the Word export. ' +
        'src/webview/markdown/index.ts passes localBase = new URL(linkBase).origin, which the URL parser normalises to ' +
        '"https://file+.vscode-resource.vscode-cdn.net", but VS Code writes webview URIs as "https://file%2B.vscode-resource..." ' +
        'and toDocx.ts compares the raw src attribute with startsWith(localBase), so the image counts as remote and is skipped.',
    );
    assert.equal(media.length, 2, 'two pictures: the mermaid diagram and docs/image.png');
    const zip = await JSZip.loadAsync(Buffer.from(msg.data, 'base64'));
    const sizes = await Promise.all(media.map(async (m) => {
      const b = await zip.file(m).async('nodebuffer');
      return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
    }));
    assert.ok(sizes.includes(`${IMG_W}x${IMG_H}`), `docs/image.png is embedded (picture sizes: ${sizes})`);
  });

  test('Export to PDF: the HTML carries CJK text, the mermaid SVG and KaTeX; the printed PDF keeps the CJK text', TIMEOUT, async () => {
    const { panel } = await openSample();
    host.state.config['docbench.pdfExport.browserPath'] = browserWrapper();
    const target = path.join(host.workspace, 'docs', 'sample.pdf');
    host.state.saveDialogTarget = Uri.file(target);
    host.state.messages.length = 0;
    await host.state.commands.get('docbench.exportMarkdownPdf')();
    const { html } = await panel.waitForNextMessage('exportPdf', 30_000, 'the PDF export HTML');
    for (const s of S.MARKDOWN_VISIBLE) {
      assert.ok(html.includes(s), `export HTML lacks ${JSON.stringify(s)}`);
    }
    const svg = /<div[^>]*mermaid-diagram[^>]*>([\s\S]*?<\/svg>)/.exec(html)?.[1] ?? '';
    assert.ok(svg.startsWith('<svg'), 'the mermaid diagram is an inline SVG');
    for (const label of S.MERMAID_LABELS) assert.ok(svg.includes(label), `mermaid SVG lacks ${JSON.stringify(label)}`);
    assert.ok((html.match(/class="katex"/g) ?? []).length >= 2, 'KaTeX markup for both formulas');
    assert.ok(/class="katex-html"[\s\S]*?>[^<]*?/.test(html) && html.includes(`${S.MATH_TEXT}</span>`), 'KaTeX output with the CJK \\text{}');
    assert.ok(html.includes('class="hljs-string"'), 'highlighted code');

    const done = await waitFor(
      () => host.state.messages.find((m) => m.kind === 'info' || m.kind === 'error'),
      60_000,
      'the PDF export to finish',
    ).catch((e) => { throw new Error(`${e.message}\nBrowser output:\n${browserLogTail()}`); });
    assert.equal(done.message, 'Docbench: exported sample.pdf', `PDF export did not succeed: ${done.message}`);
    const { pages } = await pdfText(readFileSync(target));
    const text = noWs(pages.join(''));
    for (const s of [...S.MARKDOWN_VISIBLE, ...S.MERMAID_LABELS, S.MATH_TEXT, S.CODE_COMMENT, S.CODE_STRING]) {
      assert.ok(text.includes(noWs(s)), `the PDF text lacks ${JSON.stringify(s)}`);
    }
    assertContained(panel);
  });

  test('Export to PDF includes images that are next to the document', TIMEOUT, async () => {
    const { panel } = await openSample();
    host.state.config['docbench.pdfExport.browserPath'] = browserWrapper();
    const target = path.join(host.workspace, 'docs', 'sample-images.pdf');
    host.state.saveDialogTarget = Uri.file(target);
    host.state.messages.length = 0;
    await host.state.commands.get('docbench.exportMarkdownPdf')();
    const { html } = await panel.waitForNextMessage('exportPdf', 30_000, 'the PDF export HTML');
    await waitFor(() => host.state.messages.find((m) => m.kind === 'info' || m.kind === 'error'), 60_000, 'the PDF export to finish');
    const { images } = await pdfText(readFileSync(target));
    const src = /<img[^>]*src="([^"]*)"/.exec(html)?.[1];
    assert.ok(
      images.includes(`${IMG_W}x${IMG_H}`),
      `PRODUCT BUG: docs/image.png is missing from the exported PDF. The export HTML references it as ${JSON.stringify(src)} ` +
        '(a webview resource address that only exists inside the webview), and src/editors/markdownPdf.ts prints from a ' +
        `file:// page whose CSP allows only "img-src file: data:", so the browser cannot load it. Images in the PDF: ${JSON.stringify(images)}`,
    );
  });

  test('the "images from the internet" notice does not appear for a document with only local images', TIMEOUT, async () => {
    const { page } = await openSample();
    await page.waitForTimeout(600); // the check runs 400 ms after the document arrives
    const notice = await page.evaluate(() => document.getElementById('remote-images-notice')?.textContent ?? null);
    assert.equal(
      notice,
      null,
      'PRODUCT BUG: the notice "This document has images from the internet" is shown although the only image is ' +
        'docs/image.png next to the file. src/webview/markdown/index.ts checkRemoteImages() tests /^https?:/ on the src ' +
        'attribute, but relative images are rewritten to the https webview resource address (linkBase), so every local image matches.',
    );
  });

  test('the webview runs under its nonce-only CSP without violations', TIMEOUT, async () => {
    const { panel } = await openSample();
    assert.deepEqual(
      panel.cspViolations,
      [],
      'PRODUCT BUG: CSP violations in the Markdown editor. The code-block copy button (vendor/vditor/src/ts/markdown/codeRender.ts) ' +
        'uses inline onclick / onmouseover attributes, which the nonce-only script-src blocks, so "Copy" does nothing.',
    );
  });

  test('double-clicking an image opens the preview overlay, which closes without CSP violations', TIMEOUT, async () => {
    const { page, panel } = await openSample();
    const before = panel.cspViolations.length;
    const overlay = () => page.evaluate(() => ({
      open: document.querySelectorAll('.vditor-img').length,
      overflow: document.body.style.overflow,
    }));
    const openOverlay = async () => {
      await page.dblclick('.vditor-wysiwyg img');
      await page.waitForSelector('.vditor-img', { timeout: 5_000 });
      assert.deepEqual(await overlay(), { open: 1, overflow: 'hidden' }, 'the overlay opens and locks page scrolling');
    };
    // The Close button in the overlay's bar.
    await openOverlay();
    await page.click('.vditor-img__btn[data-type="close"]');
    assert.deepEqual(await overlay(), { open: 0, overflow: '' }, 'the Close button closes the overlay');
    // A click on the backdrop (the image area).
    await openOverlay();
    await page.click('.vditor-img__img', { position: { x: 5, y: 5 } });
    assert.deepEqual(await overlay(), { open: 0, overflow: '' }, 'a click on the backdrop closes the overlay');
    // Escape.
    await openOverlay();
    await page.keyboard.press('Escape');
    assert.deepEqual(await overlay(), { open: 0, overflow: '' }, 'Escape closes the overlay');
    assert.deepEqual(
      panel.cspViolations.slice(before),
      [],
      'CSP violations while opening or closing the image overlay (vendor/vditor/src/ts/preview/image.ts must not use inline handlers)',
    );
  });

  test('typing CJK text: the posted edit holds the whole original text unchanged plus the new text', TIMEOUT, async () => {
    const { page, panel, document } = await openSample();
    await page.evaluate(() => {
      const root = document.querySelector('.vditor-wysiwyg > .vditor-reset');
      const p = [...root.querySelectorAll(':scope > p')].find((el) => el.textContent.startsWith('Plain English paragraph.'));
      root.focus();
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    const next = panel.waitForNextMessage('edit', 10_000, "the editor's edit message");
    await page.keyboard.insertText(S.TYPED_TEXT);
    const edit = await next;
    const expected = S.MARKDOWN_DOC.replace('Plain English paragraph.', `Plain English paragraph.${S.TYPED_TEXT}`);
    if (edit.text !== expected) {
      let i = 0;
      while (edit.text[i] === expected[i]) i++;
      assert.fail(`edit text differs at offset ${i}: got ${JSON.stringify(edit.text.slice(i - 20, i + 40))}, expected ${JSON.stringify(expected.slice(i - 20, i + 40))}`);
    }
    assert.equal(countOf(edit.text, S.IDEOGRAPHIC_SPACE), countOf(S.MARKDOWN_DOC, S.IDEOGRAPHIC_SPACE), 'ideographic spaces');
    assert.equal([...edit.text].length, [...S.MARKDOWN_DOC].length + [...S.TYPED_TEXT].length, 'code point count');
    // The provider mirrors the edit into the text document.
    await waitFor(() => document.getText() === expected, 5_000, 'the host document to receive the edit');
    assertContained(panel);
  });
});

// ---------------------------------------------------------------------------------------------------
// 3. PDF viewer
// ---------------------------------------------------------------------------------------------------

test('PDF viewer: renders a CJK + Latin PDF to canvases with a text layer holding the CJK text', TIMEOUT, async () => {
  // A two-page PDF printed by Chromium; a generic font family lets it pick the installed CJK fonts.
  const gen = await host.browser.newPage();
  const paras = S.PDF_PAGE1.map((t, i) => `<p lang="${S.PDF_LANGS[i]}">${t}</p>`).join('');
  await gen.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:20px}</style></head>` +
      `<body>${paras}<p lang="${S.PDF_LANGS[1]}" style="break-before:page">${S.PDF_PAGE2[0]}</p></body></html>`,
  );
  const pdf = await gen.pdf({ format: 'A4' });
  await gen.close();
  const generated = await pdfText(pdf);
  assert.equal(noWs(generated.pages[0]), noWs(S.PDF_PAGE1.join('')), 'fixture sanity: the generated PDF holds the text');

  const file = await host.writeFixture('cjk.pdf', pdf);
  const { page, panel } = await host.open('docbench.pdf', file);
  await panel.waitForMessage('ready');
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page .textLayer').length === 2, null, { timeout: 30_000 }).catch(() => undefined);
  // The second page renders once it scrolls into view.
  await page.evaluate(() => document.querySelectorAll('.pdf-page')[1]?.scrollIntoView());
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page .textLayer').length === 2, null, { timeout: 30_000 });
  const info = await page.evaluate(() => ({
    pages: document.querySelectorAll('.pdf-page').length,
    count: document.querySelector('.pdf-toolbar .label')?.textContent,
    layers: [...document.querySelectorAll('.pdf-page')].map((p) => p.querySelector('.textLayer')?.textContent ?? ''),
    inked: [...document.querySelectorAll('.pdf-page canvas')].map((c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) dark++;
      return dark;
    }),
  }));
  assert.equal(info.pages, 2);
  assert.equal(info.count, '/ 2');
  assert.equal(info.inked.length, 2, 'one canvas per page');
  assert.ok(info.inked.every((n) => n > 200), `pages have drawn text (dark pixels per page: ${info.inked})`);
  assert.equal(noWs(info.layers[0]), noWs(S.PDF_PAGE1.join('')));
  assert.equal(noWs(info.layers[1]), noWs(S.PDF_PAGE2.join('')));
  assertContained(panel);
  assert.deepEqual(panel.cspViolations, [], 'CSP violations');
  await panel.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 4. Word viewer
// ---------------------------------------------------------------------------------------------------

test('Word viewer: renders CJK paragraphs, a table and an East Asian font run', TIMEOUT, async () => {
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun(S.DOCX_TITLE)] }),
          ...S.DOCX_PARAGRAPHS.map((t) => new docx.Paragraph({ children: [new docx.TextRun(t)] })),
          new docx.Paragraph({ children: [new docx.TextRun({ text: S.DOCX_EAST_ASIA_RUN, font: { eastAsia: S.DOCX_EAST_ASIA_FONT } })] }),
          new docx.Table({
            rows: S.DOCX_TABLE.map((r) => new docx.TableRow({ children: r.map((c) => new docx.TableCell({ children: [new docx.Paragraph(c)] })) })),
          }),
        ],
      },
    ],
  });
  const file = await host.writeFixture('cjk.docx', await docx.Packer.toBuffer(doc));
  const { page, panel } = await host.open('docbench.docx', file);
  await page.waitForSelector('#docx-body section table', { timeout: 30_000 });
  const dom = await page.evaluate((run) => ({
    paragraphs: [...document.querySelectorAll('#docx-body section p')].map((p) => p.textContent),
    cells: [...document.querySelectorAll('#docx-body table td')].map((td) => td.textContent),
    runFont: [...document.querySelectorAll('#docx-body span')].find((s) => s.textContent === run)?.style.fontFamily ?? null,
  }), S.DOCX_EAST_ASIA_RUN);
  for (const p of [S.DOCX_TITLE, ...S.DOCX_PARAGRAPHS, S.DOCX_EAST_ASIA_RUN]) {
    assert.ok(dom.paragraphs.includes(p), `paragraph missing: ${JSON.stringify(p)}`);
  }
  assert.deepEqual(dom.cells, S.DOCX_TABLE.flat());
  assert.ok(dom.runFont?.includes(S.DOCX_EAST_ASIA_FONT), `East Asian font applied to the run (font-family: ${dom.runFont})`);
  assertContained(panel);
  assert.deepEqual(panel.cspViolations, [], 'CSP violations');
  await panel.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 5. Spreadsheet viewer
// ---------------------------------------------------------------------------------------------------

function cjkWorkbook() {
  const wb = XLSX.utils.book_new();
  for (const name of S.XLSX_SHEETS) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(S.XLSX_DATA[name]), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('spreadsheet viewer: xlsx with CJK sheet names and cells, and UTF-8 CSV (with and without BOM)', TIMEOUT, async () => {
  const file = await host.writeFixture('cjk.xlsx', cjkWorkbook());
  const { page, panel } = await host.open('docbench.spreadsheet', file);
  await page.waitForSelector('table td', { timeout: 30_000 });
  const tabs = await page.$$eval('.tabs .tab', (b) => b.map((x) => x.textContent));
  assert.deepEqual(tabs, S.XLSX_SHEETS);
  for (let i = 0; i < S.XLSX_SHEETS.length; i++) {
    await page.click(`.tabs .tab >> nth=${i}`);
    const cells = await page.$$eval('table td', (tds) => tds.map((td) => td.textContent));
    assert.deepEqual(cells, S.XLSX_DATA[S.XLSX_SHEETS[i]].flat().map(String), `cells of sheet ${i + 1}`);
    const status = await page.textContent('.status');
    assert.ok(status.startsWith(S.XLSX_SHEETS[i]), `status bar names the sheet: ${status}`);
  }
  assertContained(panel);
  assert.deepEqual(panel.cspViolations, [], 'CSP violations');
  await panel.dispose();

  for (const [name, text] of [['cities.csv', S.CSV_TEXT], ['cities-bom.csv', `﻿${S.CSV_TEXT}`]]) {
    const csv = await host.open('docbench.spreadsheet', await host.writeFixture(name, text));
    await csv.page.waitForSelector('table td', { timeout: 30_000 });
    const cells = await csv.page.$$eval('table td', (tds) => tds.map((td) => td.textContent));
    const expected = S.CSV_TEXT.trim().split('\n').flatMap((l) => l.split(','));
    assert.deepEqual(cells, expected, `cells of ${name}`);
    for (const c of S.CSV_CELLS) assert.ok(cells.includes(c));
    assertContained(csv.panel);
    await csv.panel.dispose();
  }
});

// ---------------------------------------------------------------------------------------------------
// 6. Spreadsheet editor
// ---------------------------------------------------------------------------------------------------

test('spreadsheet editor: edit a cell to CJK text, save, and the workbook keeps old and new CJK values', TIMEOUT, async () => {
  const file = await host.writeFixture('edit.xlsx', cjkWorkbook());
  const { page, panel, document, provider } = await host.open('docbench.xlsxEditor', file);
  await panel.waitForMessage('ready');
  await page.waitForSelector('.x-spreadsheet-bottombar');
  await page.waitForTimeout(500);
  const tabs = await page.$$eval('.x-spreadsheet-bottombar .x-spreadsheet-menu > li', (li) =>
    li.filter((x) => x.children.length === 0).map((x) => x.textContent.trim()),
  );
  assert.deepEqual(tabs, S.XLSX_SHEETS, 'sheet tabs');

  // The grid is a canvas: cell A2 is at x 60..160, y 91..116 (toolbar 41 px, header row 25 px, row 25 px).
  const grid = await page.$eval('.x-spreadsheet-overlayer', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const cell = (col, row) => ({ x: grid.x + 60 + col * 100 + 50, y: grid.y + 25 + row * 25 + 12 });
  const a2 = cell(0, 1);
  await page.mouse.dblclick(a2.x, a2.y);
  await page.waitForTimeout(300);
  const shown = await page.$eval('.x-spreadsheet-editor textarea', (t) => t.value);
  assert.equal(shown, S.XLSX_DATA[S.XLSX_SHEETS[0]][1][0], 'the cell editor shows the CJK value of A2');
  await page.keyboard.press('Escape');
  assert.deepEqual(panel.received.filter((m) => m.type === 'edit'), [], 'opening the cell editor is not an edit');

  const c3 = cell(2, 2);
  await page.waitForTimeout(300);
  await page.mouse.dblclick(c3.x, c3.y);
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('.x-spreadsheet-editor textarea', (t) => t.value), S.XLSX_DATA[S.XLSX_SHEETS[0]][2][2], 'editing C3');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(S.XLSX_NEW_CELL);
  await page.keyboard.press('Enter');
  await panel.waitForMessage('edit', 5_000, "the editor's edit message");
  assert.equal(document.dirty, true, 'the document is marked dirty');

  host.state.messages.length = 0;
  host.state.respond = (kind, _msg, items) => (kind === 'warning' && items.includes('Save') ? 'Save' : undefined);
  try {
    await provider.saveCustomDocument(document, neverCancelled);
  } finally {
    host.state.respond = () => undefined;
  }
  assert.ok(host.state.messages.some((m) => m.kind === 'warning' && /community spreadsheet library/.test(m.message)), 'lossy-save notice shown');
  const saved = XLSX.read(readFileSync(file), { type: 'buffer' });
  assert.deepEqual(saved.SheetNames, S.XLSX_SHEETS);
  const expected = structuredClone(S.XLSX_DATA);
  expected[S.XLSX_SHEETS[0]][2][2] = S.XLSX_NEW_CELL;
  for (const name of S.XLSX_SHEETS) {
    assert.deepEqual(XLSX.utils.sheet_to_json(saved.Sheets[name], { header: 1 }), expected[name], `values of sheet ${name}`);
  }
  assert.equal(document.dirty, false);
  assertContained(panel);
  assert.deepEqual(panel.cspViolations, [], 'CSP violations');
  await panel.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 7. HTML preview
// ---------------------------------------------------------------------------------------------------

test('HTML preview: shows a CJK page, including text its own script writes', TIMEOUT, async () => {
  const file = await host.writeFixture('cjk.html', S.HTML_PAGE);
  const { page, panel } = await host.open('docbench.html', file, { languageId: 'html' });
  await panel.waitForMessage('ready');
  const frame = await waitFor(
    async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const ok = await f.evaluate(() => !!document.getElementById('scripted')?.textContent).catch(() => false);
        if (ok) return f;
      }
      return undefined;
    },
    15_000,
    'the preview frame to show the page',
  );
  const dom = await frame.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent,
    paragraphs: [...document.querySelectorAll('p')].map((p) => p.textContent),
    title: document.title,
  }));
  assert.equal(dom.h1, S.HTML_HEADING);
  assert.deepEqual(dom.paragraphs, [...S.HTML_PARAGRAPHS, S.HTML_SCRIPT_TEXT]);
  assert.equal(dom.title, S.HTML_HEADING);
  assert.equal(await page.getAttribute('#preview', 'sandbox'), 'allow-scripts', 'trusted workspace: scripts allowed, nothing else');
  assertContained(panel);
  await panel.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 8. HTTP client
// ---------------------------------------------------------------------------------------------------

describe('http client', () => {
  const lineOf = (text, prefix) => text.split('\n').findIndex((l) => l.startsWith(prefix));

  test('parser: CJK in comments, names, variables, headers and body', () => {
    const { findRequestAt, resolveRequest, prettyJson } = host.mod.httpParser;
    const text = S.HTTP_FILE;
    const found = findRequestAt(text, lineOf(text, 'POST'));
    assert.equal(found.error, undefined);
    assert.deepEqual(found.vars, { label: S.HTTP_VAR_VALUE });
    const req = found.request;
    assert.equal(req.name, S.HTTP_REQUEST_NAME);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '{{base}}/echo?q={{label}}');
    assert.deepEqual(req.headers, [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['X-Note', S.HTTP_HEADER_VALUE],
      ['X-Label', '{{label}}'],
    ]);
    assert.equal(req.body, `{"text": "${S.HTTP_BODY_TEXT}", "label": "{{label}}"}`);
    assert.equal(req.line, lineOf(text, 'POST'));

    const resolved = resolveRequest(req, { ...found.vars, base: 'http://127.0.0.1:1' });
    assert.equal(resolved.url, `http://127.0.0.1:1/echo?q=${S.HTTP_VAR_VALUE}`);
    assert.deepEqual(resolved.headers[2], ['X-Label', S.HTTP_VAR_VALUE]);
    assert.equal(resolved.body, `{"text": "${S.HTTP_BODY_TEXT}", "label": "${S.HTTP_VAR_VALUE}"}`);
    assert.deepEqual(resolved.unresolved, []);

    const second = findRequestAt(text, lineOf(text, 'GET'));
    assert.equal(second.request.method, 'GET');
    assert.equal(second.request.name, undefined);

    const auth = resolveRequest({ method: 'GET', url: 'x', headers: [['Authorization', `Basic user:${S.HTTP_PASSWORD}`]], body: '', line: 0 }, {});
    assert.equal(auth.headers[0][1], `Basic ${Buffer.from(`user:${S.HTTP_PASSWORD}`, 'utf8').toString('base64')}`, 'Basic auth is UTF-8 encoded');

    const json = JSON.stringify({ text: S.HTTP_BODY_TEXT, list: [S.HTTP_VAR_VALUE] });
    const pretty = prettyJson(json);
    assert.deepEqual(JSON.parse(pretty), JSON.parse(json));
    assert.ok(pretty.includes(S.HTTP_BODY_TEXT), 'pretty-printing keeps the CJK text verbatim');
  });

  /** Echo server: answers with what it received, plus a CJK message. */
  async function withEchoServer(fn) {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        const reply = JSON.stringify({ message: S.HTTP_RESPONSE_TEXT, received: body ? JSON.parse(body) : null });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(reply);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      return await fn(`http://127.0.0.1:${server.address().port}`, seen);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  /** Runs "Docbench: Send HTTP Request" with the cursor on `line` of `text` and returns the response panel. */
  async function send(text, line) {
    const file = await host.writeFixture('requests.http', text);
    const document = new TextDocument(Uri.file(file), text, 'http');
    host.state.activeTextEditor = { document, selection: { active: { line, character: 0 } } };
    const known = new Set(host.panels.values());
    await host.state.commands.get('docbench.sendHttpRequest')();
    const panel = [...host.panels.values()].find((p) => !known.has(p)) ?? [...host.panels.values()].find((p) => p.viewType === 'docbench.httpResponse');
    assert.ok(panel, 'a response panel was opened');
    await panel.navigation;
    await panel.page.waitForSelector('.status-line, .error', { timeout: 15_000 });
    return panel;
  }

  test('sender: a CJK request reaches a local server intact and the CJK response is shown', TIMEOUT, async () => {
    await withEchoServer(async (base, seen) => {
      const text = S.HTTP_FILE.replaceAll('{{base}}', base);
      const panel = await send(text, lineOf(text, 'POST'));
      assert.equal(seen.length, 1, 'one request sent');
      const req = seen[0];
      assert.equal(req.method, 'POST');
      assert.equal(new URL(req.url, base).searchParams.get('q'), S.HTTP_VAR_VALUE, 'CJK query value (percent-encoded UTF-8)');
      assert.equal(req.headers['content-type'], 'application/json; charset=utf-8');
      assert.deepEqual(JSON.parse(req.body), { text: S.HTTP_BODY_TEXT, label: S.HTTP_VAR_VALUE }, 'UTF-8 body intact');
      const shown = await panel.page.evaluate(() => ({
        status: document.querySelector('.status')?.textContent,
        body: document.querySelector('.body-text')?.textContent ?? '',
      }));
      assert.equal(shown.status, '200 OK');
      assert.deepEqual(JSON.parse(shown.body), { message: S.HTTP_RESPONSE_TEXT, received: { text: S.HTTP_BODY_TEXT, label: S.HTTP_VAR_VALUE } });
      assert.ok(shown.body.includes(S.HTTP_RESPONSE_TEXT), 'the response body is shown with its CJK text');
      assertContained(panel);
      assert.deepEqual(panel.cspViolations, [], 'CSP violations');
    });
  });

  test('sender: header values with CJK text are sent or reported, never silently dropped', TIMEOUT, async () => {
    await withEchoServer(async (base, seen) => {
      host.state.messages.length = 0;
      const text = S.HTTP_FILE.replaceAll('{{base}}', base);
      const panel = await send(text, lineOf(text, 'POST'));
      const headers = seen[0]?.headers ?? {};
      // "Reported" means a notification or the response panel names the dropped header.
      const panelText = await panel.page.evaluate(() => document.body.innerText);
      const reported = ['X-Note', 'X-Label'].every(
        (h) => host.state.messages.some((m) => m.message.includes(h)) || new RegExp(`${h}[^\\n]*(not sent|skipped|dropped|invalid)`, 'i').test(panelText),
      );
      const decode = (v) => (v === undefined ? undefined : Buffer.from(v, 'latin1').toString('utf8'));
      assert.ok(
        (decode(headers['x-note']) === S.HTTP_HEADER_VALUE && decode(headers['x-label']) === S.HTTP_VAR_VALUE) || reported,
        'PRODUCT BUG: the X-Note and X-Label headers (CJK values) were silently left out of the request. ' +
          'src/editors/http.ts sendRequest() wraps headers.append() in try/catch and skips any header the platform refuses; ' +
          "Node's fetch refuses values with characters above U+00FF, and the user is not told. " +
          `Headers received: ${JSON.stringify(Object.keys(headers))}`,
      );
    });
  });
});
