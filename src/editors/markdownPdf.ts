import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Desktop-only (registered from extension.ts, never from the web entry): the PDF is printed by a
// locally installed Chromium-based browser (Edge, Chrome, Chromium, Brave) running headless.
// Nothing leaves the machine: the page is loaded from a temp file with a CSP that blocks scripts
// and every network fetch, so remote images in the markdown are not downloaded.

const PRINT_TIMEOUT_MS = 90_000;

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2328; font: 11pt/1.55 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, "Noto Sans", sans-serif; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 .6em; line-height: 1.25; break-after: avoid; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid #d0d7de; }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid #d0d7de; }
h3 { font-size: 1.25em; } h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
body > :first-child { margin-top: 0; }
p, ul, ol, blockquote, pre, table, dl { margin: 0 0 1em; }
ul, ol { padding-left: 2em; }
li > ul, li > ol { margin: .25em 0 0; }
li + li { margin-top: .25em; }
p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote { unicode-bidi: plaintext; }
a { color: #0969da; text-decoration: none; }
code, kbd, samp { font: .9em Consolas, "SFMono-Regular", Menlo, "Liberation Mono", monospace; background: #eff1f3; padding: .15em .35em; border-radius: 4px; }
pre { padding: 12px 14px; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
pre code { padding: 0; background: none; font-size: .88em; }
blockquote { padding: 0 1em; color: #59636e; border-left: .25em solid #d0d7de; }
blockquote > :last-child { margin-bottom: 0; }
table { border-collapse: collapse; max-width: 100%; }
th, td { padding: 6px 12px; border: 1px solid #d0d7de; }
th { background: #f6f8fa; font-weight: 600; }
tr { break-inside: avoid; }
img { max-width: 100%; height: auto; break-inside: avoid; }
hr { margin: 1.5em 0; border: 0; border-top: 1px solid #d0d7de; }
li.vditor-task { list-style: none; margin-left: -1.4em; }
li.vditor-task input { margin: 0 .5em 0 0; }
.mermaid-diagram { margin: 0 0 1em; text-align: center; break-inside: avoid; }
.mermaid-diagram svg { max-width: 100%; height: auto; }
div.language-math { margin: 0 0 1em; text-align: center; overflow-x: auto; }
pre code.hljs { display: block; background: none; padding: 0; }
blockquote[data-gh-alert] { border-left-width: .25em; border-left-style: solid; color: inherit; break-inside: avoid; }
blockquote[data-gh-alert] .alert-title { font-weight: 600; }
blockquote[data-gh-alert="note"] { border-left-color: #0969da; } blockquote[data-gh-alert="note"] .alert-title { color: #0969da; }
blockquote[data-gh-alert="tip"] { border-left-color: #1a7f37; } blockquote[data-gh-alert="tip"] .alert-title { color: #1a7f37; }
blockquote[data-gh-alert="important"] { border-left-color: #8250df; } blockquote[data-gh-alert="important"] .alert-title { color: #8250df; }
blockquote[data-gh-alert="warning"] { border-left-color: #9a6700; } blockquote[data-gh-alert="warning"] .alert-title { color: #9a6700; }
blockquote[data-gh-alert="caution"] { border-left-color: #cf222e; } blockquote[data-gh-alert="caution"] .alert-title { color: #cf222e; }
`;

let exporting = false;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function isFile(p: string): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(vscode.Uri.file(p))).type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

async function firstExisting(candidates: (string | undefined)[]): Promise<string | undefined> {
  for (const c of candidates) {
    if (c && (await isFile(c))) {
      return c;
    }
  }
  return undefined;
}

async function findBrowser(): Promise<{ exe?: string; configured: boolean }> {
  // Machine-scoped (see package.json): only the user's own settings can name an executable.
  const configured = vscode.workspace.getConfiguration('docbench').get<string>('pdfExport.browserPath', '').trim();
  if (configured) {
    return { exe: (await isFile(configured)) ? configured : undefined, configured: true };
  }
  const env = process.env;
  let candidates: (string | undefined)[] = [];
  if (process.platform === 'win32') {
    const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']];
    const rel = [
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Google\\Chrome\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Chromium\\Application\\chrome.exe',
    ];
    candidates = rel.flatMap((r) => roots.map((root) => (root ? path.win32.join(root, r) : undefined)));
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  } else {
    const names = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
      'brave-browser',
    ];
    const dirs = (env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
    candidates = dirs.flatMap((d) => names.map((n) => path.join(d, n)));
  }
  return { exe: await firstExisting(candidates), configured: false };
}

/** KaTeX and highlight.js styles from the extension's own files, with font URLs made absolute. */
async function rendererCss(extensionUri: vscode.Uri): Promise<string> {
  const dist = vscode.Uri.joinPath(extensionUri, 'media', 'markdown', 'vditor', 'dist', 'js');
  const read = async (...parts: string[]): Promise<string> => {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, ...parts)));
    } catch {
      return '';
    }
  };
  const fonts = `${vscode.Uri.joinPath(dist, 'katex', 'fonts').toString()}/`;
  const katex = (await read('katex', 'katex.min.css')).replace(/url\(\s*['"]?fonts\//g, `url(${fonts}`);
  const hljs = await read('highlight.js', 'styles', 'github.min.css');
  return `${katex}
${hljs}`;
}

function buildHtml(title: string, bodyHtml: string, docUri: vscode.Uri, extraCss: string): string {
  // Relative images resolve against the markdown file's folder (file: documents only).
  const base =
    docUri.scheme === 'file' ? `<base href="${escapeHtml(vscode.Uri.joinPath(docUri, '..').toString())}/">` : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src file: data:">
${base}
<title>${escapeHtml(title)}</title>
<style>${extraCss}</style>
<style>${PRINT_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function printToPdf(exe: string, htmlFile: string, pdfFile: string, profileDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfFile}`,
      vscode.Uri.file(htmlFile).toString(),
    ];
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The browser took too long to produce the PDF.'));
    }, PRINT_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`The browser exited with code ${code}.`));
      }
    });
  });
}

/** Saves the rendered markdown `html` of `docUri` as a PDF chosen through a save dialog. */
export async function exportMarkdownPdf(docUri: vscode.Uri, html: string, extensionUri: vscode.Uri): Promise<void> {
  if (exporting) {
    void vscode.window.showInformationMessage('Docbench: a PDF export is already running.');
    return;
  }
  const name = docUri.path.substring(docUri.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '') || 'document';
  const target = await vscode.window.showSaveDialog({
    title: 'Export Markdown to PDF',
    saveLabel: 'Export PDF',
    defaultUri: vscode.Uri.joinPath(docUri, '..', `${name}.pdf`),
    filters: { PDF: ['pdf'] },
  });
  if (!target) {
    return;
  }

  const { exe, configured } = await findBrowser();
  if (!exe) {
    const openSettings = 'Open Settings';
    const choice = await vscode.window.showErrorMessage(
      configured
        ? 'Docbench: the browser set in "docbench.pdfExport.browserPath" was not found.'
        : 'Docbench: PDF export needs a Chromium-based browser (Microsoft Edge, Google Chrome, Chromium or Brave) and none was found. Install one, or set its path in settings.',
      openSettings,
    );
    if (choice === openSettings) {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'docbench.pdfExport.browserPath');
    }
    return;
  }

  exporting = true;
  let cleaned = false;
  const cleanup = (): void => {
    if (!cleaned) {
      cleaned = true;
      exporting = false;
      void removeTempDir(work);
    }
  };
  const work = vscode.Uri.file(path.join(os.tmpdir(), `docbench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Exporting "${name}.pdf"…` },
      async () => {
        await vscode.workspace.fs.createDirectory(work);
        const htmlUri = vscode.Uri.joinPath(work, 'document.html');
        const pdfUri = vscode.Uri.joinPath(work, 'document.pdf');
        await vscode.workspace.fs.writeFile(htmlUri, new TextEncoder().encode(buildHtml(name, html, docUri, await rendererCss(extensionUri))));
        await printToPdf(exe, htmlUri.fsPath, pdfUri.fsPath, vscode.Uri.joinPath(work, 'profile').fsPath);
        // Written through workspace.fs so remote / virtual targets work too.
        await vscode.workspace.fs.writeFile(target, await vscode.workspace.fs.readFile(pdfUri));
      },
    );
    cleanup();
    const open = 'Open';
    const reveal = 'Show in Folder';
    const choice = await vscode.window.showInformationMessage(
      `Docbench: exported ${target.path.substring(target.path.lastIndexOf('/') + 1)}`,
      open,
      ...(target.scheme === 'file' ? [reveal] : []),
    );
    if (choice === open) {
      await vscode.commands.executeCommand('vscode.openWith', target, 'docbench.pdf');
    } else if (choice === reveal) {
      await vscode.commands.executeCommand('revealFileInOS', target);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`Docbench: PDF export failed. ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    cleanup();
  }
}

/** The browser's helper processes can hold its profile for a moment after exiting, so retry. */
async function removeTempDir(dir: vscode.Uri): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 750));
    }
  }
}
