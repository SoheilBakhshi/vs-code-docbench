import * as vscode from 'vscode';

// Our editors are registered with priority "option" (never hijack a file type), so these
// user-invoked commands are the one-click way to open a file in them without "Open With…".

const VIEW_TYPES: Record<string, string> = {
  '.pdf': 'docbench.pdf',
  '.docx': 'docbench.docx',
  '.dotx': 'docbench.docx',
  '.xlsx': 'docbench.spreadsheet',
  '.xlsm': 'docbench.spreadsheet',
  '.xls': 'docbench.spreadsheet',
  '.ods': 'docbench.spreadsheet',
  '.csv': 'docbench.spreadsheet',
  '.tsv': 'docbench.spreadsheet',
  '.md': 'docbench.markdown',
  '.markdown': 'docbench.markdown',
  '.html': 'docbench.html',
  '.htm': 'docbench.html',
};

const EDIT_VIEW_TYPES = new Set(['.xlsx', '.xlsm', '.xls', '.csv']);

function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input as { uri?: vscode.Uri } | undefined;
  return input?.uri ?? vscode.window.activeTextEditor?.document.uri;
}

function ext(uri: vscode.Uri): string {
  const p = uri.path;
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.substring(i).toLowerCase();
}

async function openWithViewer(arg: unknown, edit: boolean): Promise<void> {
  const uri = targetUri(arg);
  if (!uri) {
    void vscode.window.showInformationMessage('Docbench: select a file first.');
    return;
  }
  const e = ext(uri);
  const viewType = edit && EDIT_VIEW_TYPES.has(e) ? 'docbench.xlsxEditor' : VIEW_TYPES[e];
  if (!viewType) {
    void vscode.window.showInformationMessage(`Docbench: "${e || uri.path}" is not a supported file type.`);
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
}

export function registerOpenWith(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('docbench.openInViewer', (arg?: unknown) => openWithViewer(arg, false)),
    vscode.commands.registerCommand('docbench.openInEditor', (arg?: unknown) => openWithViewer(arg, true)),
  );
}
