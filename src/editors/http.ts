import * as vscode from 'vscode';
import { buildWebviewHtml, viewerWebviewOptions } from '../common/webview';
import {
  findRequestAt,
  prettyJson,
  resolveRequest,
  type HttpResponseView,
  type ResolvedRequest,
  type SubstitutionContext,
} from '../common/httpParser';

// NETWORK POLICY: `sendRequest` below is the ONLY place in the whole extension that makes network calls.
// It runs solely when the user invokes "Docbench: Send HTTP Request" (or Ctrl+Enter) on a request
// in a .http/.rest file. The response webview itself never touches the network (CSP connect-src is local only).

const VIEW_TYPE = 'docbench.httpResponse';
const MEDIA_NAME = 'http';
const TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

let panel: vscode.WebviewPanel | undefined;
let panelReady = false;
let pendingView: HttpResponseView | undefined;
let lastBodyText = '';

export function registerHttp(context: vscode.ExtensionContext): vscode.Disposable {
  const command = vscode.commands.registerCommand('docbench.sendHttpRequest', () =>
    sendHttpRequest(context),
  );
  return vscode.Disposable.from(command, {
    dispose() {
      const p = panel;
      panel = undefined;
      p?.dispose();
    },
  });
}

function isHttpDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'http' || /\.(http|rest)$/i.test(doc.fileName);
}

function substitutionContext(): SubstitutionContext {
  const ctx: SubstitutionContext = {};
  // Desktop only (the web extension host has no `process`) and only in a trusted workspace:
  // otherwise $processEnv stays unresolved.
  if (vscode.workspace.isTrusted && typeof process !== 'undefined' && process.env) {
    const env = process.env;
    ctx.processEnv = (name) => env[name];
  }
  return ctx;
}

async function sendHttpRequest(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isHttpDocument(editor.document)) {
    void vscode.window.showInformationMessage(
      'Docbench: open a .http or .rest file and place the cursor inside a request.',
    );
    return;
  }

  const found = findRequestAt(editor.document.getText(), editor.selection.active.line);
  if (!found.request) {
    void vscode.window.showWarningMessage(`Docbench: ${found.error ?? 'No request found.'}`);
    return;
  }
  const resolved = resolveRequest(found.request, found.vars, substitutionContext());

  const view = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `${resolved.method} ${truncate(resolved.url, 60)}`,
    },
    (_progress, token) => sendRequest(resolved, token),
  );
  showResponse(context, view);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function sendRequest(req: ResolvedRequest, token: vscode.CancellationToken): Promise<HttpResponseView> {
  const request = { method: req.method, url: req.url };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const cancelSub = token.onCancellationRequested(() => controller.abort());

  try {
    const headers = new Headers();
    for (const [name, value] of req.headers) {
      try {
        headers.append(name, value);
      } catch {
        // Skip header names/values the platform refuses (e.g. forbidden headers in web hosts).
      }
    }
    const hasBody = req.body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';
    const response = await fetch(req.url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'follow',
      signal: controller.signal,
    });

    const { bytes, truncated, totalBytes } = await readBody(response);
    const durationMs = elapsed();
    return buildView(request, response, bytes, truncated, totalBytes, durationMs);
  } catch (err) {
    let message: string;
    if (timedOut) message = `Request timed out after ${TIMEOUT_MS / 1000} s.`;
    else if (controller.signal.aborted) message = 'Request cancelled.';
    else message = describeError(err);
    if (req.unresolved.length) message += `\nUnresolved variables: ${req.unresolved.join(', ')}`;
    return { kind: 'error', request, durationMs: elapsed(), message };
  } finally {
    clearTimeout(timer);
    cancelSub.dispose();
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // undici reports the real reason (ECONNREFUSED, ENOTFOUND, ...) in `cause`.
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

/** Reads up to MAX_BODY_BYTES; `totalBytes` is the Content-Length when the body was cut. */
async function readBody(
  response: Response,
): Promise<{ bytes: Uint8Array; truncated: boolean; totalBytes?: number }> {
  const declared = Number(response.headers.get('content-length'));
  if (!response.body) return { bytes: new Uint8Array(await response.arrayBuffer()), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > MAX_BODY_BYTES) {
      const keep = MAX_BODY_BYTES - received;
      if (keep > 0) chunks.push(value.subarray(0, keep));
      received = MAX_BODY_BYTES;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    received += value.length;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, truncated, totalBytes: truncated && Number.isFinite(declared) && declared > 0 ? declared : undefined };
}

const TEXT_TYPE_RE = /^text\/|json|xml|javascript|ecmascript|yaml|x-www-form-urlencoded|html|csv|graphql|x-sh/i;

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown charset label: fall back to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function buildView(
  request: { method: string; url: string },
  response: Response,
  bytes: Uint8Array,
  truncated: boolean,
  totalBytes: number | undefined,
  durationMs: number,
): HttpResponseView {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  const contentType = response.headers.get('content-type') ?? '';
  const mime = contentType.split(';')[0].trim().toLowerCase();

  const view: HttpResponseView = {
    kind: 'response',
    request,
    durationMs,
    status: response.status,
    statusText: response.statusText,
    headers,
    contentType,
    sizeBytes: totalBytes ?? bytes.length,
    truncated,
  };

  if (bytes.length === 0) {
    view.note = 'No response body.';
  } else if (mime.startsWith('image/') && !truncated) {
    view.imageDataUrl = `data:${mime};base64,${toBase64(bytes)}`;
  } else {
    const text = decodeText(bytes, contentType);
    const textual = !mime || TEXT_TYPE_RE.test(mime);
    if (!textual && text.slice(0, 8000).includes('\u0000')) {
      view.note = `Binary content (${mime}, ${bytes.length} bytes) cannot be displayed.`;
    } else {
      view.bodyText = (/json/i.test(mime) || !mime ? prettyJson(text) : undefined) ?? text;
    }
  }
  return view;
}

function showResponse(context: vscode.ExtensionContext, view: HttpResponseView): void {
  lastBodyText = view.bodyText ?? '';
  if (panel) {
    panel.reveal(undefined, true);
  } else {
    panelReady = false;
    const created = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'HTTP Response',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { ...viewerWebviewOptions(context.extensionUri, MEDIA_NAME), retainContextWhenHidden: true },
    );
    panel = created;
    created.webview.html = buildWebviewHtml({
      webview: created.webview,
      extensionUri: context.extensionUri,
      mediaName: MEDIA_NAME,
      title: 'HTTP Response',
    });
    created.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg?.type === 'ready') {
        panelReady = true;
        if (pendingView) {
          void created.webview.postMessage({ type: 'show', view: pendingView });
          pendingView = undefined;
        }
      } else if (msg?.type === 'copyBody') {
        void vscode.env.clipboard.writeText(lastBodyText);
        vscode.window.setStatusBarMessage('Docbench: response body copied', 2000);
      }
    });
    created.onDidDispose(() => {
      if (panel === created) {
        panel = undefined;
        panelReady = false;
        pendingView = undefined;
      }
    });
  }

  panel.title = view.kind === 'response' ? `${view.status} ${view.request.method}` : 'HTTP Response (error)';
  if (panelReady) void panel.webview.postMessage({ type: 'show', view });
  else pendingView = view;
}
