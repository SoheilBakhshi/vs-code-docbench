// Builds the extension host bundles (out/) and one browser bundle per webview (media/<name>/).
// Webview convention: src/webview/<name>/index.ts  ->  media/<name>/index.js (+ index.css if CSS is imported).
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const hostNode = {
  ...common,
  entryPoints: { extension: 'src/extension.ts' },
  outdir: 'out',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

const hostWeb = {
  ...common,
  entryPoints: { 'extension-web': 'src/extension-web.ts' },
  outdir: 'out',
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['vscode'],
};

const webviewRoot = 'src/webview';
const webviewNames = existsSync(webviewRoot)
  ? readdirSync(webviewRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(webviewRoot, d.name, 'index.ts')))
      .map((d) => d.name)
  : [];

// The Vditor fork reads its version from a build-time constant (upstream's webpack defined it).
const vditorVersion = JSON.parse(readFileSync('vendor/vditor/package.json', 'utf8')).version.split('-')[0];

const webviews = webviewNames.map((name) => ({
  ...common,
  define: name === 'markdown' ? { VDITOR_VERSION: JSON.stringify(vditorVersion) } : undefined,
  entryPoints: [join(webviewRoot, name, 'index.ts')],
  outfile: join('media', name, 'index.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
}));

function copyStatic() {
  // pdf.js worker (legacy build) is loaded by the pdf webview via asWebviewUri.
  const worker = 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';
  if (existsSync(worker)) {
    mkdirSync('media/pdf', { recursive: true });
    cpSync(worker, 'media/pdf/pdf.worker.min.mjs');
  }
  // pdf.js cmaps + standard fonts for non-embedded CJK / base-14 fonts.
  // The wasm folder also holds pdf.js's QuickJS sandbox, which only runs JavaScript embedded in PDFs.
  // Docbench never enables PDF scripting, so that interpreter is not shipped.
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
    const src = join('node_modules/pdfjs-dist', dir);
    if (existsSync(src)) {
      cpSync(src, join('media/pdf', dir), { recursive: true, filter: (p) => !/quickjs/i.test(p) });
    }
  }
  // The Markdown editor's runtime files (Lute engine, English UI strings, icons, content themes, and the
  // Mermaid, KaTeX and highlight.js renderers) are served locally from the webview. They come from the
  // cleaned Vditor fork in vendor/vditor (see its PROVENANCE.md); only its runtime folders are copied.
  const vditor = 'node_modules/vditor/dist';
  if (existsSync(vditor)) {
    for (const dir of ['css', 'images', 'js']) {
      cpSync(join(vditor, dir), join('media/markdown/vditor/dist', dir), { recursive: true });
    }
  }
}

const configs = [hostNode, hostWeb, ...webviews];

if (!watch) {
  rmSync('out', { recursive: true, force: true });
  rmSync('media', { recursive: true, force: true });
}
copyStatic();

if (watch) {
  for (const c of configs) {
    const ctx = await esbuild.context(c);
    await ctx.watch();
  }
  console.log('[watch] build started');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
