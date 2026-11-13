// Shared helpers for webview bundles (imported by src/webview/<name>/index.ts).
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi: VsCodeApi = acquireVsCodeApi();

export interface LoadMessage {
  type: 'load';
  fileName: string;
  ext: string;
  data: Uint8Array;
}

/**
 * File bytes cross the host/webview boundary through VS Code's message serialization, which does
 * not reliably hand back a Uint8Array (it can arrive as an ArrayBuffer, a Node Buffer JSON shape
 * `{type:'Buffer',data}`, an array, or an index-keyed plain object). Always normalise.
 */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  if (value && typeof value === 'object') {
    const obj = value as { type?: unknown; data?: unknown };
    if (obj.type === 'Buffer' && obj.data !== undefined) {
      return toBytes(obj.data);
    }
    const keys = Object.keys(value);
    const out = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      out[i] = (value as Record<string, number>)[i];
    }
    return out;
  }
  throw new Error('Unsupported file data received from the extension host.');
}

/**
 * Wires the standard handshake: registers handlers, then posts `ready`.
 * `onLoad` fires on the first load and on every reload after a file change.
 */
export function startViewer(
  onLoad: (msg: LoadMessage) => void | Promise<void>,
  onError?: (message: string) => void,
): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data;
    if (msg?.type === 'load') {
      try {
        void Promise.resolve(onLoad({ ...(msg as LoadMessage), data: toBytes(msg.data) })).catch((err) =>
          (onError ?? showError)(String(err instanceof Error ? err.message : err)),
        );
      } catch (err) {
        (onError ?? showError)(String(err instanceof Error ? err.message : err));
      }
    } else if (msg?.type === 'error') {
      (onError ?? showError)(String(msg.message));
    }
  });
  vscodeApi.postMessage({ type: 'ready' });
}

export function showError(message: string): void {
  const el = document.createElement('div');
  el.style.cssText = 'padding:16px;color:var(--vscode-errorForeground,#f55);font-family:var(--vscode-font-family)';
  el.textContent = message;
  document.body.replaceChildren(el);
}
