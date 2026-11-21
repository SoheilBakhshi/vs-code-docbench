#!/usr/bin/env node
// Checks the contents of a packaged .vsix (docs/CONTENT-POLICY.md, "Release checks").
//
//   node scripts/check-package.mjs docbench-<version>.vsix [--list]
//
// 1. Every file must match one entry of PURPOSES below (so every shipped file has a stated purpose).
// 2. No file may match FORBIDDEN (private files, credentials, sources, maps, backups, development debris).
// 3. Built files must be byte-identical to this checkout's out/ and media/ folders, and the Markdown editor's
//    runtime files to the cleaned fork in vendor/vditor/dist (so the package matches the cleaned source).
// 4. package.json inside the package must carry the same version as this checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const PURPOSES = [
  [/^\[Content_Types\]\.xml$|^extension\.vsixmanifest$/, 'VSIX container metadata written by vsce'],
  [/^extension\/package\.json$/, 'extension manifest'],
  [/^extension\/(readme|changelog)\.md$/, 'Marketplace listing text and release notes'],
  [/^extension\/LICENSE\.txt$/, 'Docbench MIT licence'],
  [/^extension\/THIRD-PARTY-NOTICES\.md$/, 'licences and notices of bundled software'],
  [/^extension\/assets\/icon\.png$/, 'extension icon'],
  [/^extension\/assets\/icons\/(pdf|docx)-(light|dark)\.svg$/, 'editor title-bar icons for the export commands'],
  [/^extension\/out\/extension(-web)?\.js$/, 'extension host code (desktop and web)'],
  [/^extension\/media\/(docx|html|http|markdown|pdf|spreadsheet|xlsx-editor)\/index\.(js|css)$/, 'webview bundle of one viewer or editor'],
  [/^extension\/media\/pdf\/pdf\.worker\.min\.mjs$/, 'pdf.js worker that parses PDF files'],
  [/^extension\/media\/pdf\/cmaps\/([A-Za-z0-9-]+\.bcmap|LICENSE)$/, 'pdf.js character maps: decode text of PDFs that use CJK and other non-Latin encodings'],
  [/^extension\/media\/pdf\/standard_fonts\/((Foxit|Liberation)[A-Za-z-]+\.(pfb|ttf)|LICENSE_(FOXIT|LIBERATION))$/, 'pdf.js fallback fonts for PDFs that do not embed the 14 standard fonts'],
  [/^extension\/media\/pdf\/wasm\/((jbig2|openjpeg)(\.wasm|_nowasm_fallback\.js)|qcms_bg\.wasm|LICENSE_[A-Z0-9_]+)$/, 'pdf.js image decoders (JBIG2, JPEG 2000) and colour management'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/lute\/lute\.min\.js$/, 'Lute Markdown engine (parses and renders Markdown)'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/i18n\/en_US\.js$/, 'English interface strings of the Markdown editor'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/icons\/ant\.js$/, 'toolbar icon set of the Markdown editor'],
  [/^extension\/media\/markdown\/vditor\/dist\/css\/content-theme\/(light|dark)\.css$/, 'light and dark content themes of the Markdown editor'],
  [/^extension\/media\/markdown\/vditor\/dist\/images\/img-loading\.svg$/, 'placeholder shown while an image loads'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/mermaid\/mermaid\.min\.js$/, 'Mermaid diagram renderer'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/katex\/(katex\.min\.(js|css)|mhchem\.min\.js|fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/, 'KaTeX maths renderer, chemistry extension and maths fonts'],
  [/^extension\/media\/markdown\/vditor\/dist\/js\/highlight\.js\/(highlight\.min\.js|third-languages\.js|styles\/github(-dark)?\.min\.css|LICENSE)$/, 'code highlighting (github light and dark styles) and its licence'],
];

const FORBIDDEN = [
  /(^|\/)\.[^/]+/, // dotfiles and dot-folders (.env, .git, .vscode, .github, ...)
  /\.(map|ts|tsx|mts|cts|less|bundle|tgz|zip|vsix|log|bak|orig|rej|swp|pem|key|p12|pfx|env)$/i,
  /^extension\/(vendor|src|scripts|test|docs|tmp|dist)\//i,
  /(^|\/)(node_modules|backups?)\//i,
  /(^|\/)(AGENTS|CLAUDE|PUBLISHING|METADATA)\.md$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)/i,
  /secret|credential|password|deploy[_-]?key/i,
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: check-package.mjs <file.vsix> [--list]');
  process.exit(2);
}
const { default: JSZip } = await import('jszip');
const zip = await JSZip.loadAsync(readFileSync(file));
const entries = Object.values(zip.files).filter((e) => !e.dir);
const failures = [];
const groups = new Map();
for (const entry of entries) {
  const p = entry.name;
  if (FORBIDDEN.some((re) => re.test(p))) failures.push(`${p}: forbidden in the package`);
  const purpose = PURPOSES.find(([re]) => re.test(p));
  if (!purpose) failures.push(`${p}: no stated purpose (add it to PURPOSES in scripts/check-package.mjs or exclude it)`);
  else groups.set(purpose[1], (groups.get(purpose[1]) ?? 0) + 1);
  // Built output must be what this checkout built; Markdown runtime files must be the cleaned fork's.
  const buf = await entry.async('nodebuffer');
  const local = p.replace(/^extension\//, '');
  if (/^(out|media)\//.test(local)) {
    if (!existsSync(local)) failures.push(`${p}: not in this checkout's build output`);
    else if (sha(readFileSync(local)) !== sha(buf)) failures.push(`${p}: differs from ${local}`);
  }
  const fork = local.replace(/^media\/markdown\/vditor\//, 'vendor/vditor/');
  if (fork !== local) {
    if (!existsSync(fork)) failures.push(`${p}: not in vendor/vditor`);
    else if (sha(readFileSync(fork)) !== sha(buf)) failures.push(`${p}: differs from ${fork}`);
  }
}
const manifest = JSON.parse(await zip.file('extension/package.json').async('string'));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (manifest.version !== version) failures.push(`package version ${manifest.version} is not this checkout's ${version}`);

console.log(`package contents (${file}): ${entries.length} files, version ${manifest.version}`);
if (rest.includes('--list') || !failures.length) {
  for (const [purpose, n] of groups) console.log(`  ${String(n).padStart(4)}  ${purpose}`);
}
if (failures.length) {
  console.error(`\n${failures.length} package-content failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('package contents: OK');
