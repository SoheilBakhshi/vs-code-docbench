// Web-extension entry: only the viewers that need no desktop APIs (markdown, html, http); the
// desktop-only editors get placeholder pages (see webStubs.ts).
import * as vscode from 'vscode';
import { registerDefaults } from './editors/defaults';
import { registerHtml } from './editors/html';
import { registerHttp } from './editors/http';
import { registerMarkdown } from './editors/markdown';
import { registerOpenWith } from './editors/openWith';
import { registerWebStubs } from './editors/webStubs';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerMarkdown(context), registerHtml(context), registerHttp(context), registerOpenWith(), registerDefaults(context, ['markdown', 'html']), registerWebStubs());
}

export function deactivate(): void {}
