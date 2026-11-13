// Captures page screenshots with headless Chrome through the DevTools protocol, waiting in real time
// (headless "virtual time" does not advance for web workers, which the PDF viewer uses).
//
//   node scripts/capture.mjs <outDir> <waitMs> <name>...      renders <outDir>/<name>.html -> <name>.png
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [outDir, waitMs, ...names] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'docbench-cap-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

try {
  const ws = new WebSocket(await pageTarget());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  for (const name of names) {
    await send('Page.navigate', { url: pathToFileURL(join(outDir, `${name}.html`)).href });
    await sleep(Number(waitMs));
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('captured', name, `(${(Buffer.from(shot.result.data, 'base64').length / 1024).toFixed(0)} KB)`);
  }
  ws.close();
} finally {
  chrome.kill();
}
