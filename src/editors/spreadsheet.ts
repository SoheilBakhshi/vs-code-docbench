import * as vscode from 'vscode';
import { BinaryReadonlyEditorProvider } from './base';

class SpreadsheetEditorProvider extends BinaryReadonlyEditorProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'spreadsheet', 'Spreadsheet');
  }
}

export function registerSpreadsheet(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider(
    'docbench.spreadsheet',
    new SpreadsheetEditorProvider(context),
    { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } },
  );
}
