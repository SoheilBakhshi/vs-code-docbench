#!/usr/bin/env node
// Removes developer comments that contain Chinese, Japanese or Korean text from TypeScript files of a
// vendored fork (used for vendor/vditor, see vendor/vditor/PROVENANCE.md). Code, strings and regular
// expressions are never changed: comment positions come from the TypeScript parser.
//
//   node scripts/vendor/strip-cjk-comments.mjs <folder>...      rewrites *.ts / *.d.ts in place
//   node scripts/vendor/strip-cjk-comments.mjs --check <folder>  exit 1 if such a comment is left
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CJK } from '../content-policy/rules.mjs';

const ts = createRequire(import.meta.url)('typescript');

/** Every comment range of a file, found through the leading and trailing trivia of every node. */
function commentRanges(text) {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const seen = new Map();
  const add = (ranges) => ranges?.forEach((r) => seen.set(r.pos, r));
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

export function stripCjkComments(text) {
  let out = '';
  let last = 0;
  let removed = 0;
  for (const r of commentRanges(text)) {
    if (r.pos < last || !CJK.test(text.slice(r.pos, r.end))) continue;
    let start = r.pos;
    let end = r.end;
    // Take the spaces before the comment; drop the whole line when nothing else is on it.
    while (start > last && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
    const lineStart = start === 0 || text[start - 1] === '\n';
    if (lineStart && text[end] === '\r') end++;
    if (lineStart && text[end] === '\n') end++;
    out += text.slice(last, start);
    last = end;
    removed++;
  }
  return { text: out + text.slice(last), removed };
}

function walk(dir, files = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (/\.ts$/.test(e.name)) files.push(p);
  }
  return files;
}

const args = process.argv.slice(2);
const check = args[0] === '--check';
let total = 0;
for (const dir of args.filter((a) => a !== '--check')) {
  for (const file of walk(dir)) {
    const before = readFileSync(file, 'utf8');
    const { text, removed } = stripCjkComments(before);
    if (!removed) continue;
    total += removed;
    if (check) console.error(`${file}: ${removed} comment(s) with CJK text`);
    else writeFileSync(file, text);
  }
}
console.log(`${check ? 'found' : 'removed'} ${total} comment(s)`);
if (check && total) process.exit(1);
