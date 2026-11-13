import { vscodeApi } from '../common/vscode';
import './index.css';

// Hosts the user's HTML in a sandboxed iframe. The document text arrives from the extension
// host (already carrying <base> and CSP) and is assigned via srcdoc - no inline scripts here.
const frame = document.getElementById('preview') as HTMLIFrameElement;

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg?.type === 'render' && typeof msg.html === 'string') {
    // Opaque-origin sandbox; the page's own scripts are only allowed in a trusted workspace.
    frame.setAttribute('sandbox', msg.scripts ? 'allow-scripts' : '');
    frame.srcdoc = msg.html;
  }
});

vscodeApi.postMessage({ type: 'ready' });
