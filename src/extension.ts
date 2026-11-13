import * as vscode from 'vscode';
import { registerDefaults } from './editors/defaults';
import { registerDocx } from './editors/docx';
import { registerHtml } from './editors/html';
import { registerHttp } from './editors/http';
import { registerMarkdown, setPdfExporter } from './editors/markdown';
import { exportMarkdownPdf } from './editors/markdownPdf';
import { registerOpenWith } from './editors/openWith';
import { registerPdf } from './editors/pdf';
import { registerSpreadsheet } from './editors/spreadsheet';
import { registerXlsxEditor } from './editors/xlsxEditor';

export function activate(context: vscode.ExtensionContext): void {
  setPdfExporter(exportMarkdownPdf);
  context.subscriptions.push(
    registerSpreadsheet(context),
    registerXlsxEditor(context),
    registerDocx(context),
    registerPdf(context),
    registerMarkdown(context),
    registerHtml(context),
    registerHttp(context),
    registerOpenWith(),
    registerDefaults(context),
  );
}

export function deactivate(): void {}
