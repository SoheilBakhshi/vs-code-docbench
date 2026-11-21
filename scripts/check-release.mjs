#!/usr/bin/env node
// Release checks (docs/CONTENT-POLICY.md section 6): builds the .vsix from a production build, then scans
// every file inside it with the content policy and checks its contents. Exit code 1 on any failure.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// The package must be built from exactly the committed lockfile: every installed package must carry the
// version package-lock.json records (catches an `npm install` that re-resolved dependencies after `npm ci`).
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const drift = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || entry.link) continue;
  let installed;
  try { installed = JSON.parse(readFileSync(`${path}/package.json`, 'utf8')).version; } catch { installed = undefined; }
  if (installed !== entry.version && !(entry.optional && installed === undefined)) drift.push(`${path}: lockfile ${entry.version}, installed ${installed ?? 'missing'}`);
}
if (drift.length) {
  console.error(`node_modules does not match package-lock.json (run npm ci):\n  ${drift.join('\n  ')}`);
  process.exit(1);
}
console.log(`dependencies match package-lock.json (${Object.keys(lock.packages).length - 1} entries)`);
const vsix = `docbench-${version}.vsix`;
// Windows needs a shell to run npm (npm.cmd), but not node itself, whose path may contain spaces.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
run('npm', ['run', 'package']);
run(process.execPath, ['scripts/content-policy/check.mjs', 'vsix', vsix, '--report']);
run(process.execPath, ['scripts/check-package.mjs', vsix]);
const buf = readFileSync(vsix);
console.log(`release checks passed: ${vsix}, ${buf.length} bytes, sha256 ${createHash('sha256').update(buf).digest('hex')}`);
