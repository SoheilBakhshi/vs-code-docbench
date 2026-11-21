// Regression tests for the cleaned Vditor fork in vendor/vditor (see its PROVENANCE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { FORK_SAMPLES } from './fixtures/cjk-samples.mjs';

const FORK = 'vendor/vditor';
const node = (...args) => execFileSync(process.execPath, args, { encoding: 'utf8' });

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p.split('\\').join('/'));
  }
  return out;
}

test('every fork file matches the hashes recorded in PROVENANCE.md', () => {
  assert.match(node('scripts/vendor/vditor-provenance.mjs', 'check'), /files match PROVENANCE\.md/);
});

test('no developer comment with CJK text is left in the fork', () => {
  assert.match(node('scripts/vendor/strip-cjk-comments.mjs', '--check', `${FORK}/src`, `${FORK}/dist`), /found 0 comment/);
});

test('the fork ships only the runtime files Docbench loads', () => {
  const runtime = walk(`${FORK}/dist`).filter((f) => !/\.d\.ts$/.test(f) && !f.endsWith('dist/index.css'));
  const unexpected = runtime.filter((f) => !/\/dist\/(css\/content-theme\/(light|dark)\.css|images\/img-loading\.svg|js\/(i18n\/en_US\.js|icons\/ant\.js|lute\/lute\.min\.js|mermaid\/mermaid\.min\.js|katex\/(katex\.min\.(js|css)|mhchem\.min\.js|fonts\/KaTeX_[\w-]+\.woff2)|highlight\.js\/(highlight\.min\.js|third-languages\.js|LICENSE|styles\/github(-dark)?\.min\.css)))$/.test(f));
  assert.deepEqual(unexpected, []);
  assert.deepEqual(readdirSync(`${FORK}/dist/js/i18n`), ['en_US.js'], 'English interface strings only');
});

test('removed features stay removed and kept features stay', () => {
  const src = (p) => readFileSync(join(FORK, 'src', p), 'utf8');
  assert.deepEqual(readdirSync(`${FORK}/src/ts/toolbar`).filter((f) => /^(Help|Info)\.ts$/.test(f)), []);
  assert.doesNotMatch(src('ts/markdown/mediaRender.ts'), /iframe/, 'no video-site embeds');
  assert.match(src('ts/markdown/mediaRender.ts'), /"video"/, 'direct media links still become <video>');
  assert.match(src('ts/constants.ts'), /CDN = "";/, 'no default outside CDN');
  assert.doesNotMatch(src('ts/markdown/plantumlRender.ts'), /https?:/, 'no remote diagram server');
  assert.match(src('index.ts'), /\["en_US"\]\.includes\(mergedOptions\.lang\)/);
  for (const f of ['ts/ir/index.ts', 'ts/wysiwyg/index.ts']) {
    assert.ok(src(f).includes(`event.data === "${FORK_SAMPLES.imeGuard}"`), `${f}: input-method guard is kept`);
  }
  assert.match(src('ts/undo/index.ts'), /new DiffMatchPatch\.diff_match_patch\(\)/);
});

test('the fork builds from source without warnings', async () => {
  const result = await esbuild.build({
    entryPoints: [`${FORK}/src/index.ts`], bundle: true, write: false, format: 'iife', logLevel: 'silent',
    define: { VDITOR_VERSION: '"4.0.1"' },
  });
  assert.deepEqual(result.warnings.map((w) => w.text), []);
  assert.deepEqual(result.errors, []);
});

test('the Markdown webview bundle defines the Vditor version constant', () => {
  const bundle = readFileSync('media/markdown/index.js', 'utf8');
  assert.doesNotMatch(bundle, /\bVDITOR_VERSION\b/, 'a free VDITOR_VERSION would throw when the editor loads');
});

test('the undo history works with the bundled diff-match-patch', async () => {
  const result = await esbuild.build({
    stdin: {
      contents: 'import * as D from "diff-match-patch"; const d = new D.diff_match_patch(); ' +
        'const p = d.patch_make(A, B); module.exports = d.patch_apply(p, A)[0];',
      resolveDir: join(process.cwd(), FORK, 'src'),
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const run = new Function('module', 'A', 'B', result.outputFiles[0].text);
  const m = { exports: undefined };
  run(m, FORK_SAMPLES.before, FORK_SAMPLES.after);
  assert.equal(m.exports, FORK_SAMPLES.after);
});

test('Lute keeps CJK text, punctuation and spacing intact and drops only the product emoji', () => {
  globalThis.window = globalThis;
  createRequire(import.meta.url)(join(process.cwd(), FORK, 'dist/js/lute/lute.min.js'));
  const lute = globalThis.Lute.New();
  const html = lute.Md2HTML(FORK_SAMPLES.markdown);
  for (const s of FORK_SAMPLES.mustRender) assert.ok(html.includes(s), `rendered HTML keeps ${JSON.stringify(s)}`);
  assert.ok(html.includes('\u{1F604}'), ':smile: still becomes an emoji');
  assert.ok(html.includes(FORK_SAMPLES.removedEmoji) && !/<img/.test(html), 'a removed product emoji stays plain text');
  // Markdown -> editor DOM -> Markdown keeps the text exactly (what the WYSIWYG editor does on every edit).
  lute.SetVditorWYSIWYG(true);
  const back = lute.VditorDOM2Md(lute.Md2VditorDOM(FORK_SAMPLES.roundTrip));
  assert.equal(back.trim(), FORK_SAMPLES.roundTrip.trim());
});
