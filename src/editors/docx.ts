import * as vscode from 'vscode';
import { BinaryReadonlyEditorProvider } from './base';

class DocxEditorProvider extends BinaryReadonlyEditorProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'docx', 'Word Viewer');
  }
}

export function registerDocx(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider('docbench.docx', new DocxEditorProvider(context), {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  });
}
