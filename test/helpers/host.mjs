// Test harness that plays the VS Code extension host for Docbench's webviews.
//
// - The real editor providers (src/editors/*.ts) are bundled on the fly with esbuild, with `vscode`
//   replaced by the stub in vscode-stub.mjs, and run unmodified in this Node process.
// - Every webview panel a provider creates is a real headless Chromium page. The HTML the provider
//   assigns to `webview.html` (with its nonce-only CSP) is served from a local HTTP server, and
//   `webview.asWebviewUri()` maps files to that server, which only serves files inside the panel's
//   `localResourceRoots` (like VS Code).
// - `acquireVsCodeApi()` is defined in the page before any script runs (Playwright init script, which
//   the page CSP does not apply to); messages are bridged in both directions.
// - Requests to any other address are blocked and recorded, and CSP violations
//   are recorded, so tests can assert that neither happens.
import { existsSync, mkdtempSync, promises as fsp, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVscode, neverCancelled, TextDocument, Uri } from './vscode-stub.mjs';

const require = createRequire(import.meta.url);
/**
 * The extension folder whose src/ and media/ are tested. DOCBENCH_TEST_ROOT may point to another
 * checkout or build output (with src/, media/ and node_modules/); by default it is this repository.
 */
export const REPO = process.env.DOCBENCH_TEST_ROOT
  ? path.resolve(process.env.DOCBENCH_TEST_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
};

/** VS Code's webview resource host (what asWebviewUri produces) and the CSP source it hands out. */
const RESOURCE_HOST = 'file+.vscode-resource.vscode-cdn.net';
const RESOURCE_AUTHORITY = 'file%2B.vscode-resource.vscode-cdn.net';
const CSP_SOURCE = 'https://*.vscode-cdn.net';
/** Origin of the webview shell document (VS Code uses vscode-webview://<id>; any separate origin will do). */
const SHELL_ORIGIN = 'https://webview.docbench.test';

const MEDIA_FOLDERS = ['markdown', 'pdf', 'docx', 'spreadsheet', 'xlsx-editor', 'html', 'http'];

/** Fails early with a clear message when the extension has not been built. */
export function assertBuilt() {
  const missing = MEDIA_FOLDERS.filter((m) => !existsSync(path.join(REPO, 'media', m, 'index.js')));
  if (missing.length) {
    throw new Error(
      `The webview bundles are missing (media/${missing.join(', media/')}). Run "npm run compile" before the feature tests.`,
    );
  }
}

/** Bundles the real providers with `vscode` mapped to a global the stub fills. */
async function bundleProviders(outDir) {
  const esbuild = require('esbuild');
  const outfile = path.join(outDir, 'providers.cjs');
  await esbuild.build({
    stdin: {
      contents: `
        export { registerMarkdown, setPdfExporter } from './src/editors/markdown';
        export { exportMarkdownPdf } from './src/editors/markdownPdf';
        export { registerPdf } from './src/editors/pdf';
        export { registerDocx } from './src/editors/docx';
        export { registerSpreadsheet } from './src/editors/spreadsheet';
        export { registerXlsxEditor } from './src/editors/xlsxEditor';
        export { registerHtml } from './src/editors/html';
        export { registerHttp } from './src/editors/http';
        export * as httpParser from './src/common/httpParser';
      `,
      resolveDir: REPO,
      loader: 'ts',
      sourcefile: 'test-host-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    logLevel: 'silent',
    plugins: [
      {
        name: 'vscode-stub',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'vscode-stub' }, () => ({
            contents: 'module.exports = globalThis.__docbenchVscode;',
            loader: 'js',
          }));
        },
      },
    ],
  });
  return require(outfile);
}

// --- message encoding (typed arrays travel as base64, like VS Code's own transfer) ---------------

function encode(v) {
  if (v instanceof Uint8Array) return { __u8: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  if (v instanceof ArrayBuffer) return { __u8: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object' && !(v instanceof Uri)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v instanceof Uri ? v.toString() : v;
}

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.__u8 === 'string') return new Uint8Array(Buffer.from(v.__u8, 'base64'));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** Runs in the page before its own scripts. */
function pageInit() {
  const enc = (v) => {
    if (v instanceof ArrayBuffer) v = new Uint8Array(v);
    if (ArrayBuffer.isView(v)) {
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return { __u8: btoa(s) };
    }
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = enc(v[k]);
      return o;
    }
    return v;
  };
  const dec = (v) => {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      if (typeof v.__u8 === 'string') {
        const s = atob(v.__u8);
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        return b;
      }
      const o = {};
      for (const k of Object.keys(v)) o[k] = dec(v[k]);
      return o;
    }
    return v;
  };
  let acquired = false;
  let state;
  window.acquireVsCodeApi = () => {
    if (acquired) throw new Error('An instance of the VS Code API has already been acquired');
    acquired = true;
    return Object.freeze({
      postMessage: (m) => void window.__docbenchPost(enc(m)),
      getState: () => state,
      setState: (s) => {
        state = s;
        return s;
      },
    });
  };
  window.__docbenchDeliver = (m) => window.dispatchEvent(new MessageEvent('message', { data: dec(m) }));
  document.addEventListener('securitypolicyviolation', (e) =>
    void window.__docbenchCsp({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample, source: e.sourceFile }),
  );
  // VS Code puts a theme class on <body>.
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-light'));
}

let panelSeq = 0;

class Panel {
  constructor(host, viewType, title, options) {
    this.host = host;
    this.id = ++panelSeq;
    this.viewType = viewType;
    this.title = title;
    this.active = true;
    this.visible = true;
    /** Messages the webview posted, in order (decoded). */
    this.received = [];
    /** Messages the host posted to the webview. */
    this.sent = [];
    this.cspViolations = [];
    this.deniedResources = [];
    this.missingResources = [];
    this.externalRequests = [];
    this.pageErrors = [];
    this.consoleErrors = [];
    this.listeners = new Set();
    this.disposeListeners = new Set();
    this.waiters = [];
    this.html = '';
    this.navigation = undefined;
    const panel = this;
    this.webview = {
      options: options ?? {},
      cspSource: CSP_SOURCE,
      asWebviewUri: (uri) => new Uri('https', RESOURCE_AUTHORITY, uri.path),
      get html() {
        return panel.html;
      },
      set html(v) {
        panel.html = v;
        panel.navigation = panel.navigate();
      },
      onDidReceiveMessage: (fn) => {
        panel.listeners.add(fn);
        return { dispose: () => panel.listeners.delete(fn) };
      },
      postMessage: async (msg) => {
        panel.sent.push(msg);
        await panel.navigation;
        await panel.page.evaluate((m) => window.__docbenchDeliver(m), encode(msg));
        return true;
      },
    };
    host.panels.set(this.id, this);
  }

  onDidDispose(fn) {
    this.disposeListeners.add(fn);
    return { dispose: () => this.disposeListeners.delete(fn) };
  }
  onDidChangeViewState() {
    return { dispose() {} };
  }
  reveal() {}

  async navigate() {
    if (!this.page) {
      this.browserContext = await this.host.browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
      const page = await this.browserContext.newPage();
      this.page = page;
      await this.browserContext.route('**/*', (route) => this.serve(route));
      page.on('pageerror', (e) => this.pageErrors.push(String(e?.stack ?? e)));
      page.on('console', (m) => {
        if (m.type() === 'error') this.consoleErrors.push(m.text());
      });
      await page.exposeBinding('__docbenchPost', (_src, m) => this.receive(decode(m)));
      await page.exposeBinding('__docbenchCsp', (_src, v) => void this.cspViolations.push(v));
      await page.addInitScript(pageInit);
    }
    await this.page.goto(`${SHELL_ORIGIN}/index.html?id=${this.id}&v=${Date.now()}`, { waitUntil: 'load' });
  }

  /** Answers every request of this panel's page: shell, local resources, or blocked. */
  async serve(route) {
    const raw = route.request().url();
    const url = new URL(raw);
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (url.origin === SHELL_ORIGIN && url.pathname === '/index.html') {
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': MIME['.html'] }, body: this.html });
    }
    if (url.protocol === 'https:' && url.hostname === RESOURCE_HOST) {
      const file = decodeURIComponent(url.pathname);
      const roots = (this.webview.options.localResourceRoots ?? []).map((r) => r.fsPath.replace(/\/?$/, '/'));
      if (!roots.some((r) => file.startsWith(r))) {
        this.deniedResources.push(file);
        return route.fulfill({ status: 401, headers: cors, body: '' });
      }
      let body;
      try {
        body = await fsp.readFile(file);
      } catch {
        this.missingResources.push(file);
        return route.fulfill({ status: 404, headers: cors, body: '' });
      }
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
        body,
      });
    }
    this.externalRequests.push(raw);
    return route.abort('blockedbyclient');
  }

  receive(msg) {
    this.received.push(msg);
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
    for (const fn of [...this.listeners]) fn(msg);
  }

  /** Resolves with the first posted message (already received or future) matching `pred`. */
  waitForMessage(pred, timeoutMs = 20000, what = 'message') {
    const p = typeof pred === 'string' ? (m) => m?.type === pred : pred;
    const found = this.received.find(p);
    if (found) return Promise.resolve(found);
    return this.waitForNextMessage(p, timeoutMs, what);
  }

  /** Resolves with the next message posted from now on that matches `pred`. */
  waitForNextMessage(pred, timeoutMs = 20000, what = 'message') {
    const p = typeof pred === 'string' ? (m) => m?.type === pred : pred;
    return new Promise((resolve, reject) => {
      const w = {
        pred: p,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          reject(
            new Error(
              `Timed out after ${timeoutMs} ms waiting for ${what}. Received: ${JSON.stringify(this.received.map((m) => m?.type))}; ` +
                `page errors: ${JSON.stringify(this.pageErrors)}; console errors: ${JSON.stringify(this.consoleErrors.slice(0, 5))}`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(w);
    });
  }

  async dispose() {
    for (const fn of [...this.disposeListeners]) fn();
    this.host.panels.delete(this.id);
    await this.browserContext?.close().catch(() => undefined);
  }
}

export async function startHost() {
  assertBuilt();
  const { chromium } = require('playwright');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'docbench-features-'));
  const workspace = path.join(tmp, 'workspace');
  await fsp.mkdir(workspace, { recursive: true });
  const host = { panels: new Map(), tmp, workspace };

  host.browser = await chromium.launch();

  const { vscode, state, context } = createVscode({
    workspaceRoot: workspace,
    createPanel: (viewType, title, options) => new Panel(host, viewType, title, options),
  });
  context.extensionUri = Uri.file(REPO);
  globalThis.__docbenchVscode = vscode;
  const mod = await bundleProviders(tmp);
  mod.setPdfExporter(mod.exportMarkdownPdf);
  for (const reg of ['registerMarkdown', 'registerPdf', 'registerDocx', 'registerSpreadsheet', 'registerXlsxEditor', 'registerHtml', 'registerHttp']) {
    context.subscriptions.push(mod[reg](context));
  }

  Object.assign(host, { vscode, state, context, mod });

  /** Writes a fixture file into the temp workspace and returns its path. */
  host.writeFixture = async (name, content) => {
    const p = path.join(workspace, name);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, content);
    return p;
  };

  /** Opens `file` with the custom editor `viewType`, exactly as VS Code would call the provider. */
  host.open = async (viewType, file, { languageId } = {}) => {
    const entry = state.providers.get(viewType);
    if (!entry) throw new Error(`No provider registered for ${viewType}`);
    const { provider } = entry;
    const uri = Uri.file(file);
    const panel = new Panel(host, viewType, path.basename(file), {});
    let document;
    if (typeof provider.resolveCustomTextEditor === 'function') {
      document = new TextDocument(uri, await fsp.readFile(file, 'utf8'), languageId);
      state.documents.set(uri.toString(), document);
      await provider.resolveCustomTextEditor(document, panel, neverCancelled);
    } else {
      document = await provider.openCustomDocument(uri, { backupId: undefined, untitledDocumentData: undefined }, neverCancelled);
      await provider.resolveCustomEditor(document, panel, neverCancelled);
    }
    await panel.navigation;
    return { panel, document, provider, page: panel.page };
  };

  host.close = async () => {
    for (const p of [...host.panels.values()]) await p.dispose();
    await host.browser.close().catch(() => undefined);
    for (const d of context.subscriptions) d?.dispose?.();
    if (!process.env.DOCBENCH_TEST_KEEP) rmSync(tmp, { recursive: true, force: true });
    else console.log(`Kept test files in ${tmp}`);
  };
  return host;
}
