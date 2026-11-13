// Builds the extension host bundles (out/) and one browser bundle per webview (media/<name>/).
// Webview convention: src/webview/<name>/index.ts  ->  media/<name>/index.js (+ index.css if CSS is imported).
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

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

// Vditor's prebuilt bundle carries addresses of outside services for features Docbench does not use
// (its default script CDN, a help dialog, remote PlantUML rendering, video embeds). The webview's CSP
// already blocks every one of them; this replaces the addresses so the shipped code cannot reach them
// at all. Fails the build if Vditor changes and an address is no longer found, so it is never silent.
const VDITOR_OUTSIDE = [
  'https://unpkg.com/vditor/dist/images/logo.png',
  'https://unpkg.com/vditor@',
  'https://ld246.com',
  'https://b3log.org',
  'https://www.plantuml.com/plantuml/svg/~1',
  'https://player.bilibili.com/player.html?',
  'https://v.qq.com/txp/iframe/player.html?vid=',
  'https://www.facebook.com/plugins/video.php?href=',
  'https://www.dailymotion.com/embed/video/',
  '//www.youtube.com/embed/',
  '//player.youku.com/embed/',
  '//coub.com/embed/',
  '//embed.ted.com/talks/',
  '//www.zhihu.com/equation?tex=',
];
const stripVditorOutside = {
  name: 'strip-vditor-outside-addresses',
  setup(build) {
    build.onLoad({ filter: /[\\/]vditor[\\/]dist[\\/]index\.js$/ }, (args) => {
      let code = readFileSync(args.path, 'utf8');
      const missing = [];
      for (const address of VDITOR_OUTSIDE) {
        if (!code.includes(address)) {
          missing.push(address);
          continue;
        }
        code = code.split(address).join('about:blank#');
      }
      if (missing.length) {
        return { errors: [{ text: `Vditor no longer contains: ${missing.join(', ')}. Update VDITOR_OUTSIDE in esbuild.mjs.` }] };
      }
      return { contents: code, loader: 'js' };
    });
  },
};

const webviews = webviewNames.map((name) => ({
  ...common,
  plugins: name === 'markdown' ? [stripVditorOutside] : [],
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
  // Vditor ships many runtime assets that must be served locally (no CDN). Only what the WYSIWYG editor
  // really loads is copied: content themes, emoji images, the lute / i18n / icon scripts, and the
  // renderers for Mermaid diagrams, KaTeX maths and code highlighting (github + github-dark styles).
  // Other diagram engines (graphviz, echarts, plantuml, ...) are not shipped.
  const vditor = 'node_modules/vditor/dist';
  const keep = new Set([
    '', 'css', 'images', 'js', 'js/i18n', 'js/i18n/en_US.js', 'js/icons', 'js/icons/ant.js', 'js/lute', 'js/lute/lute.min.js',
    'js/mermaid', 'js/mermaid/mermaid.min.js',
    'js/katex', 'js/katex/katex.min.js', 'js/katex/katex.min.css', 'js/katex/mhchem.min.js', 'js/katex/fonts',
    'js/highlight.js', 'js/highlight.js/highlight.min.js', 'js/highlight.js/third-languages.js', 'js/highlight.js/styles',
    'js/highlight.js/styles/github.min.css', 'js/highlight.js/styles/github-dark.min.css',
  ]);
  if (existsSync(vditor)) {
    mkdirSync('media/markdown', { recursive: true });
    cpSync(vditor, 'media/markdown/vditor/dist', {
      recursive: true,
      filter: (p) => {
        const rel = relative(vditor, p).split('\\').join('/');
        return keep.has(rel) || rel.startsWith('css/') || (rel.startsWith('images/') && rel !== 'images/logo.png') || (rel.startsWith('js/katex/fonts/') && rel.endsWith('.woff2'));
      },
    });
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
