import { renderAsync } from 'docx-preview';
import { showError, startViewer } from '../common/vscode';
import './index.css';

const root = document.createElement('div');
root.id = 'docx-root';
const styles = document.createElement('div');
styles.id = 'docx-styles';
const body = document.createElement('div');
body.id = 'docx-body';
root.append(styles, body);
document.body.replaceChildren(root);

let generation = 0;

function describe(e: unknown, ext: string): string {
  const detail = e instanceof Error ? e.message : String(e);
  const hint =
    ext === '.dotx'
      ? ' This template may use an unsupported content type; try saving it as .docx.'
      : ' The file may be corrupt, password-protected or not a valid Word document.';
  return `Unable to render this document (${detail}).${hint}`;
}

startViewer(async (msg) => {
  const gen = ++generation;
  // showError() replaces <body>'s children; restore the viewer root so a later valid load renders.
  if (!root.isConnected) {
    document.body.replaceChildren(root);
  }
  body.replaceChildren();
  styles.replaceChildren();
  try {
    // Copy into a standalone ArrayBuffer; JSZip inside docx-preview accepts it directly.
    const buf = new Uint8Array(msg.data).buffer;
    await renderAsync(buf, body, styles, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true, // data: URLs satisfy the img-src CSP
    });
    if (gen !== generation) {
      return;
    }
    if (!body.querySelector('section, article, p, table')) {
      showError('The document rendered no content.');
    }
  } catch (e) {
    if (gen === generation) {
      showError(describe(e, msg.ext));
    }
  }
});
