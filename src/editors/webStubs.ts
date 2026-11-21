import * as vscode from 'vscode';

// The web build has no pdf / word / spreadsheet viewers, but package.json contributes them and
// `workbench.editorAssociations` can arrive through Settings Sync. Register placeholders so such a
// file shows an explanation instead of "no custom editor provider registered".

const DESKTOP_ONLY: Record<string, string> = {
  'docbench.pdf': 'PDF',
  'docbench.docx': 'Word',
  'docbench.spreadsheet': 'spreadsheet',
  'docbench.xlsxEditor': 'spreadsheet',
};

function page(kind: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;line-height:1.5}</style></head>
<body><h3>${kind} files need the desktop version of VS Code</h3>
<p>Docbench can only show this type of file in the desktop app, not in the browser.
Use <b>Open With…</b> and pick another editor, or open the file in the desktop app.</p></body></html>`;
}

export function registerWebStubs(): vscode.Disposable {
  return vscode.Disposable.from(
    ...Object.entries(DESKTOP_ONLY).map(([viewType, kind]) =>
      vscode.window.registerCustomEditorProvider(viewType, {
        openCustomDocument: (uri: vscode.Uri): vscode.CustomDocument => ({ uri, dispose() {} }),
        resolveCustomEditor: (_doc: vscode.CustomDocument, panel: vscode.WebviewPanel): void => {
          panel.webview.html = page(kind);
        },
      } satisfies vscode.CustomReadonlyEditorProvider),
    ),
  );
}
