#!/usr/bin/env node
// Content-policy check (docs/CONTENT-POLICY.md). Rules and allowed exceptions: ./rules.mjs.
//
//   node scripts/content-policy/check.mjs tree           every file Git tracks or would track (not ignored)
//   node scripts/content-policy/check.mjs vsix <file>     every file inside a packaged .vsix
//   node scripts/content-policy/check.mjs dir <folder>    every file below a folder (for example node_modules/x)
//   add --report to print the allowed matches as well, --json <file> to write the full result.
//
// Exit code 1 when a match is not covered by an exception, or when an exception no longer matches its count.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { CJK_CLASS, EXCEPTIONS, TERMS, TEXT_EXTENSIONS } from './rules.mjs';

const CJK_ALL = new RegExp(`[${CJK_CLASS}]`, 'gu');
// A range in a character class, written literally or escaped: X-Y where both ends are CJK.
const RANGE = new RegExp(`[${CJK_CLASS}]-[${CJK_CLASS}]`, 'gu');
const TERM_RES = TERMS.map((t) => ({ ...t, re: new RegExp(t.pattern, 'gi') }));

/** Decodes escapes and encodings; returns the decoded text and the decoded fragments alone. */
export function decode(text) {
  const fragments = [];
  const keep = (s) => (fragments.push(s), s);
  let out = text;
  // \u{1F600} and \uXXXX (also doubled backslashes from JSON or minified regex sources)
  out = out.replace(/\\+u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => keep(String.fromCodePoint(parseInt(h, 16))));
  out = out.replace(/(?:\\+u[0-9a-fA-F]{4})+/g, (m) => {
    const units = m.split(/\\+u/).filter(Boolean).map((h) => parseInt(h, 16));
    return keep(String.fromCharCode(...units));
  });
  // \xE4\xB8\xAD style UTF-8 byte strings (Go/GopherJS output) and %E4%B8%AD (URL encoding)
  const bytes = (m, sep) => {
    const buf = Buffer.from(m.split(sep).filter(Boolean).map((h) => parseInt(h, 16)));
    const s = buf.toString('utf8');
    return s.includes('\ufffd') ? m : keep(s);
  };
  out = out.replace(/(?:\\+x[0-9a-fA-F]{2})+/g, (m) => bytes(m.replace(/\\+x/g, '|'), '|'));
  out = out.replace(/(?:%[0-9a-fA-F]{2}){2,}/g, (m) => bytes(m.replace(/%/g, '|'), '|'));
  // HTML / XML character references
  out = out.replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => keep(String.fromCodePoint(parseInt(h, 16))));
  out = out.replace(/&#([0-9]{1,7});/g, (m, d) => keep(String.fromCodePoint(Number(d))));
  // base64 runs (data: URIs, embedded strings)
  for (const m of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    const s = Buffer.from(m[0], 'base64').toString('utf8');
    const printable = s.replace(/[^\x20-\x7e\n\r\t\u00a0-\uffff]/g, '').length;
    if (s.length && printable / s.length > 0.95 && !s.includes('\ufffd')) fragments.push(s);
  }
  return { decoded: out, fragments };
}

const countCjk = (s) => (s.replace(RANGE, '').match(CJK_ALL) ?? []).length;

/** Counts every rule in one file. */
export function scanText(name, text) {
  const counts = {};
  const add = (id, n) => n && (counts[id] = (counts[id] ?? 0) + n);
  for (const t of TERM_RES) {
    t.re.lastIndex = 0;
    add(`name:${t.id}`, (name.match(t.re) ?? []).length);
  }
  if (text === undefined) return counts;
  add('cjk', countCjk(text));
  const { decoded, fragments } = decode(text);
  // Escaped characters are counted on the decoded text, so that escaped ranges such as \u3041-\u3096
  // are recognised as ranges; base64 fragments are not part of the decoded text and are added separately.
  const b64 = fragments.filter((f) => !decoded.includes(f)).join('\n');
  add('cjk-escaped', Math.max(0, countCjk(decoded) - countCjk(text)) + countCjk(b64));
  // Regex sources write "v\.qq\.com"; strip escaping backslashes before matching terms.
  const plain = decoded.replace(/\\+(?=[./\-_:])/g, '');
  for (const t of TERM_RES) {
    t.re.lastIndex = 0;
    const n = (plain.match(t.re) ?? []).length;
    t.re.lastIndex = 0;
    add(t.id, n + (b64.match(t.re) ?? []).length);
  }
  return counts;
}

function isText(name, buf) {
  if (!TEXT_EXTENSIONS.has(extname(name).toLowerCase())) return false;
  return !buf.subarray(0, 8192).includes(0);
}

/** Compares the counts of one file with its exception entry. */
export function judge(path, counts) {
  const entries = EXCEPTIONS.filter((e) => e.files.includes(path));
  if (entries.length > 1) return { failures: [`${path}: more than one exception entry`], allowed: [] };
  const entry = entries[0];
  const failures = [];
  const allowed = [];
  if (entry?.allow === '*') {
    if (Object.keys(counts).length) allowed.push({ path, counts, reason: entry.reason });
    return { failures, allowed };
  }
  const allow = entry?.allow ?? {};
  for (const [id, n] of Object.entries(counts)) {
    const max = allow[id] ?? 0;
    if (n > max) failures.push(`${path}: ${id} x${n}${max ? ` (exception allows ${max})` : ''}`);
  }
  for (const [id, n] of Object.entries(allow)) {
    if ((counts[id] ?? 0) < n) failures.push(`${path}: exception for ${id} expects ${n}, found ${counts[id] ?? 0}; update rules.mjs`);
  }
  if (entry && !failures.length) allowed.push({ path, counts, reason: entry.reason });
  return { failures, allowed };
}

function run(files) {
  const result = { files: 0, textFiles: 0, failures: [], allowed: [] };
  for (const { path, buf } of files) {
    result.files++;
    const text = isText(path, buf) ? buf.toString('utf8') : undefined;
    if (text !== undefined) result.textFiles++;
    const { failures, allowed } = judge(path, scanText(path, text));
    result.failures.push(...failures);
    result.allowed.push(...allowed);
  }
  return result;
}

function treeFiles() {
  const list = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  return list.filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .map((path) => ({ path, buf: readFileSync(path) }));
}

function dirFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.git') walk(p); }
      else if (e.isFile()) out.push({ path: relative('.', p).split('\\').join('/'), buf: readFileSync(p) });
    }
  };
  walk(root);
  return out;
}

async function vsixFiles(file) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(readFileSync(file));
  const out = [];
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) out.push({ path: entry.name, buf: await entry.async('nodebuffer') });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const [mode, target] = args;
  const report = args.includes('--report');
  const jsonAt = args.indexOf('--json');
  let files;
  if (mode === 'tree') files = treeFiles();
  else if (mode === 'vsix' && target) files = await vsixFiles(target);
  else if (mode === 'dir' && target) files = dirFiles(target);
  else {
    console.error('usage: check.mjs tree | vsix <file.vsix> | dir <folder> [--report] [--json <out.json>]');
    process.exit(2);
  }
  const result = run(files);
  // An exception that names a file which is not there is stale (tree mode only: a VSIX holds fewer files).
  if (mode === 'tree') {
    const present = new Set(files.map((f) => f.path));
    for (const e of EXCEPTIONS) {
      if (!e.files.some((f) => present.has(f) || f.startsWith('extension/'))) result.failures.push(`exception for ${e.files.join(', ')} names no existing file`);
    }
  }
  console.log(`content policy (${mode}${target ? ` ${target}` : ''}): ${result.files} files, ${result.textFiles} scanned as text`);
  if (report || result.failures.length === 0) {
    for (const a of result.allowed) console.log(`  allowed  ${a.path}  ${JSON.stringify(a.counts)}  (${a.reason})`);
  }
  if (jsonAt > -1) writeFileSync(args[jsonAt + 1], JSON.stringify(result, null, 2));
  if (result.failures.length) {
    console.error(`\n${result.failures.length} content-policy failure(s):`);
    for (const f of result.failures) console.error(`  ${f}`);
    console.error('\nSee docs/CONTENT-POLICY.md. Remove the content, or add a reviewed exception in scripts/content-policy/rules.mjs.');
    process.exit(1);
  }
  console.log('content policy: OK');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check.mjs')) {
  await main();
}
