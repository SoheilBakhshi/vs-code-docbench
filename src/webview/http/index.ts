import './index.css';
import type { HttpResponseView } from '../../common/httpParser';
import { vscodeApi } from '../common/vscode';

// All response content is inserted with textContent only (never innerHTML).

const app = document.getElementById('app') ?? document.body;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function statusClass(status: number): string {
  if (status >= 500) return 'status-5xx';
  if (status >= 400) return 'status-4xx';
  if (status >= 300) return 'status-3xx';
  if (status >= 200) return 'status-2xx';
  return 'status-1xx';
}

function renderRequestLine(view: HttpResponseView): HTMLElement {
  const line = el('div', 'request-line');
  line.append(el('span', 'method', view.request.method), el('span', 'url', view.request.url));
  return line;
}

function renderError(view: HttpResponseView): void {
  const box = el('div', 'error');
  box.append(el('div', 'error-title', 'Request failed'), el('pre', 'error-message', view.message ?? 'Unknown error'));
  app.replaceChildren(renderRequestLine(view), box, el('div', 'meta', `after ${formatDuration(view.durationMs)}`));
}

function renderHeaders(view: HttpResponseView): HTMLElement {
  const headers = view.headers ?? [];
  const details = el('details', 'section');
  const summary = el('summary', undefined, `Headers (${headers.length})`);
  summary.title = 'Show or hide the response headers';
  details.append(summary);
  const table = el('table', 'headers');
  for (const [name, value] of headers) {
    const row = el('tr');
    row.append(el('th', undefined, name), el('td', undefined, value));
    table.append(row);
  }
  details.append(table);
  return details;
}

function renderBody(view: HttpResponseView): HTMLElement {
  const section = el('section', 'section body');
  const head = el('div', 'body-head');
  head.append(el('h2', undefined, 'Body'));

  if (view.bodyText) {
    const copy = el('button', 'copy', 'Copy body');
    copy.type = 'button';
    copy.title = 'Copy the response body to the clipboard';
    copy.addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'copyBody' });
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy body'), 1500);
    });
    head.append(copy);
  }
  section.append(head);

  if (view.truncated) {
    section.append(
      el('div', 'notice', `Body truncated: only the first ${formatSize(10 * 1024 * 1024)} are shown.`),
    );
  }
  if (view.imageDataUrl) {
    const img = el('img', 'preview');
    img.src = view.imageDataUrl;
    img.alt = 'Response image';
    section.append(img);
  } else if (view.bodyText !== undefined) {
    section.append(el('pre', 'body-text', view.bodyText));
  } else {
    section.append(el('div', 'note', view.note ?? 'No response body.'));
  }
  return section;
}

function renderResponse(view: HttpResponseView): void {
  const status = view.status ?? 0;
  const statusLine = el('div', 'status-line');
  statusLine.append(
    el('span', `status ${statusClass(status)}`, `${status} ${view.statusText ?? ''}`.trim()),
    el('span', 'meta', `Time: ${formatDuration(view.durationMs)}`),
    el('span', 'meta', `Size: ${formatSize(view.sizeBytes ?? 0)}`),
  );
  if (view.contentType) statusLine.append(el('span', 'meta', view.contentType));
  app.replaceChildren(renderRequestLine(view), statusLine, renderHeaders(view), renderBody(view));
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; view?: HttpResponseView } | undefined;
  if (msg?.type !== 'show' || !msg.view) return;
  if (msg.view.kind === 'error') renderError(msg.view);
  else renderResponse(msg.view);
});

app.append(el('div', 'note', 'Send a request from a .http file to see the response here.'));
vscodeApi.postMessage({ type: 'ready' });
