import * as vscode from 'vscode';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Reads a file through `vscode.workspace.fs` (remote/SSH-safe). Files over `maxBytes`
 * are refused with a warning instead of being pushed wholesale into a webview.
 */
export async function readFileGuarded(
  uri: vscode.Uri,
  maxBytes: number = MAX_FILE_BYTES,
): Promise<Uint8Array | undefined> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > maxBytes) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    const limit = (maxBytes / (1024 * 1024)).toFixed(0);
    void vscode.window.showWarningMessage(
      `Docbench: "${basename(uri)}" is ${mb} MB, which exceeds the ${limit} MB limit for in-editor viewing.`,
    );
    return undefined;
  }
  return vscode.workspace.fs.readFile(uri);
}

export function basename(uri: vscode.Uri): string {
  const p = uri.path;
  return p.substring(p.lastIndexOf('/') + 1);
}

export function extname(uri: vscode.Uri): string {
  const name = basename(uri);
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.substring(i).toLowerCase();
}
