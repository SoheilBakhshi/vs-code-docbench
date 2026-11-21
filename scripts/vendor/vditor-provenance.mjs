#!/usr/bin/env node
// Keeps vendor/vditor/PROVENANCE.md traceable to the upstream npm package.
//
//   node scripts/vendor/vditor-provenance.mjs write <upstream-package-dir>
//       Rewrites the file table of PROVENANCE.md from the fork and an unpacked upstream tarball
//       (npm pack vditor@4.0.1 && tar xzf vditor-4.0.1.tgz  ->  ./package).
//   node scripts/vendor/vditor-provenance.mjs check
//       Fails when a fork file is missing from the table or its SHA-256 differs from the recorded one,
//       so every change to the fork must be recorded here.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FORK = 'vendor/vditor';
const DOC = join(FORK, 'PROVENANCE.md');
const START = '<!-- files:start -->';
const END = '<!-- files:end -->';
// Fork-only files (not taken from upstream).
const OWN = new Set(['PROVENANCE.md', 'package.json', 'tsconfig.json']);
// Where a fork file came from in the upstream package, when the path differs.
const UPSTREAM_PATH = (rel) => rel;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(relative(FORK, p).split('\\').join('/'));
  }
  return out;
}

function table(upstream) {
  const rows = [];
  const files = walk(FORK).filter((f) => !OWN.has(f)).sort();
  for (const f of files) {
    const up = join(upstream, UPSTREAM_PATH(f));
    const upHash = existsSync(up) ? sha(up) : '';
    const forkHash = sha(join(FORK, f));
    rows.push(`| ${f} | ${upHash ? (upHash === forkHash ? 'verbatim' : 'modified') : 'new'} | ${upHash.slice(0, 16) || '-'} | ${forkHash.slice(0, 16)} |`);
  }
  return ['| File | Status | Upstream SHA-256 (first 16) | Fork SHA-256 (first 16) |', '|---|---|---|---|', ...rows].join('\n');
}

const [mode, upstream] = process.argv.slice(2);
const doc = readFileSync(DOC, 'utf8');
const [head, rest] = doc.split(START);
const [, tail] = rest.split(END);
if (mode === 'write' && upstream) {
  writeFileSync(DOC, `${head}${START}\n${table(upstream)}\n${END}${tail}`);
  console.log(`updated ${DOC}`);
} else if (mode === 'check') {
  const recorded = new Map();
  for (const line of rest.split(END)[0].split('\n')) {
    const m = /^\| (\S+) \| (verbatim|modified|new) \| \S+ \| ([0-9a-f]{16}) \|$/.exec(line);
    if (m) recorded.set(m[1], m[3]);
  }
  const problems = [];
  const files = walk(FORK).filter((f) => !OWN.has(f));
  for (const f of files) {
    if (!recorded.has(f)) problems.push(`${f}: not recorded in PROVENANCE.md`);
    else if (sha(join(FORK, f)).slice(0, 16) !== recorded.get(f)) problems.push(`${f}: changed without updating PROVENANCE.md`);
  }
  for (const f of recorded.keys()) if (!files.includes(f)) problems.push(`${f}: recorded but missing`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`vendor/vditor provenance: ${files.length} files match PROVENANCE.md`);
} else {
  console.error('usage: vditor-provenance.mjs write <upstream-package-dir> | check');
  process.exit(2);
}
