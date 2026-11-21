// A small stand-in for the `vscode` module: just enough of the API for Docbench's editor providers to
// run unmodified in Node. Webview panels are supplied by the harness (host.mjs), which connects them to
// real Chromium pages. Dialogs and notifications are recorded and answered by `state.respond`.
import { promises as fsp } from 'node:fs';
import { posix } from 'node:path';

const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

export class Uri {
  constructor(scheme, authority, path, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path || '/';
    this.query = query;
    this.fragment = fragment;
  }
  static file(p) {
    return new Uri('file', '', p.replace(/\\/g, '/'));
  }
  static parse(s) {
    const m = /^([a-zA-Z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(s);
    if (!m) throw new Error(`Bad URI: ${s}`);
    return new Uri(m[1], m[2] ?? '', decodeURIComponent(m[3] ?? ''), m[4] ?? '', m[5] ?? '');
  }
  static joinPath(base, ...parts) {
    return base.with({ path: posix.join(base.path, ...parts) });
  }
  with(change) {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
  get fsPath() {
    return this.path;
  }
  toString() {
    return `${this.scheme}://${this.authority}${encodePath(this.path)}${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`;
  }
  toJSON() {
    return this.toString();
  }
}

export class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (fn) => {
      this.listeners.add(fn);
      return { dispose: () => this.listeners.delete(fn) };
    };
  }
  fire(e) {
    for (const fn of [...this.listeners]) fn(e);
  }
  dispose() {
    this.listeners.clear();
  }
}

export class Disposable {
  constructor(fn) {
    this.fn = fn;
  }
  static from(...items) {
    return new Disposable(() => items.forEach((i) => i?.dispose?.()));
  }
  dispose() {
    this.fn?.();
  }
}

export class Range {
  constructor(a, b, c, d) {
    this.start = { line: a, character: b };
    this.end = { line: c, character: d };
  }
}

export class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, text) {
    this.edits.push({ uri, range, text });
  }
}

export class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
  }
}

/** A text document whose whole text is replaced by each edit (all Docbench ever does). */
export class TextDocument {
  constructor(uri, text, languageId = 'plaintext') {
    this.uri = uri;
    this.fileName = uri.fsPath;
    this.languageId = languageId;
    this.text = text;
    this.version = 1;
  }
  getText() {
    return this.text;
  }
  get lineCount() {
    return this.text.split('\n').length;
  }
  validateRange(r) {
    return r;
  }
}

export const neverCancelled = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

/**
 * Builds the API object. `state` holds everything the tests inspect or steer.
 * `createPanel(viewType, title, options)` is provided by the harness.
 */
export function createVscode({ workspaceRoot, createPanel }) {
  const state = {
    providers: new Map(),
    commands: new Map(),
    executed: [],
    messages: [],
    config: {},
    globalState: new Map(),
    documents: new Map(),
    trusted: true,
    activeTextEditor: undefined,
    clipboard: '',
    /** Answers dialogs / notifications: (kind, message, items, options) => answer. */
    respond: () => undefined,
    saveDialogTarget: undefined,
    textChange: new EventEmitter(),
  };

  const notify = (kind) => async (message, ...rest) => {
    const opts = rest.length && typeof rest[0] === 'object' && rest[0] !== null && !('title' in rest[0]) ? rest.shift() : undefined;
    const items = rest;
    state.messages.push({ kind, message, items });
    return state.respond(kind, message, items, opts);
  };

  const fs = {
    async stat(uri) {
      const s = await fsp.stat(uri.fsPath);
      return { type: s.isDirectory() ? 2 : 1, size: s.size, ctime: s.ctimeMs, mtime: s.mtimeMs };
    },
    async readFile(uri) {
      return new Uint8Array(await fsp.readFile(uri.fsPath));
    },
    async writeFile(uri, data) {
      await fsp.writeFile(uri.fsPath, data);
    },
    async createDirectory(uri) {
      await fsp.mkdir(uri.fsPath, { recursive: true });
    },
    async delete(uri, opts) {
      await fsp.rm(uri.fsPath, { recursive: !!opts?.recursive, force: true });
    },
  };

  const vscode = {
    Uri,
    EventEmitter,
    Disposable,
    Range,
    WorkspaceEdit,
    RelativePattern,
    CancellationError,
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      fs,
      get isTrusted() {
        return state.trusted;
      },
      getConfiguration(section) {
        return {
          get: (key, def) => {
            const full = `${section}.${key}`;
            return full in state.config ? state.config[full] : def;
          },
          update: async (key, value) => {
            state.config[`${section}.${key}`] = value;
          },
        };
      },
      getWorkspaceFolder(uri) {
        const root = workspaceRoot.replace(/\/?$/, '/');
        return uri.scheme === 'file' && uri.path.startsWith(root) ? { uri: Uri.file(workspaceRoot), name: 'ws', index: 0 } : undefined;
      },
      onDidChangeTextDocument: state.textChange.event,
      onDidSaveTextDocument: new EventEmitter().event,
      onDidGrantWorkspaceTrust: new EventEmitter().event,
      onDidChangeConfiguration: new EventEmitter().event,
      createFileSystemWatcher() {
        const e = new EventEmitter();
        return { onDidChange: e.event, onDidCreate: e.event, onDidDelete: e.event, dispose() {} };
      },
      async applyEdit(edit) {
        for (const { uri, text } of edit.edits) {
          const doc = state.documents.get(uri.toString());
          if (!doc) return false;
          doc.text = text;
          doc.version++;
          // Like VS Code, the change event fires before applyEdit resolves.
          state.textChange.fire({ document: doc, contentChanges: [{ text }] });
        }
        return true;
      },
    },
    window: {
      registerCustomEditorProvider(viewType, provider, options) {
        state.providers.set(viewType, { provider, options });
        return new Disposable(() => state.providers.delete(viewType));
      },
      createWebviewPanel(viewType, title, _column, options) {
        return createPanel(viewType, title, options);
      },
      get activeTextEditor() {
        return state.activeTextEditor;
      },
      showInformationMessage: notify('info'),
      showWarningMessage: notify('warning'),
      showErrorMessage: notify('error'),
      async showSaveDialog(opts) {
        state.messages.push({ kind: 'saveDialog', message: opts?.title ?? '' });
        return state.saveDialogTarget;
      },
      async showOpenDialog() {
        return undefined;
      },
      async withProgress(_opts, task) {
        return task({ report() {} }, neverCancelled);
      },
      setStatusBarMessage() {
        return new Disposable();
      },
    },
    commands: {
      registerCommand(id, fn) {
        state.commands.set(id, fn);
        return new Disposable(() => state.commands.delete(id));
      },
      async executeCommand(id, ...args) {
        state.executed.push({ id, args });
        const fn = state.commands.get(id);
        return fn ? fn(...args) : undefined;
      },
    },
    env: {
      clipboard: {
        async writeText(t) {
          state.clipboard = t;
        },
      },
    },
  };

  const context = {
    extensionUri: undefined, // set by the harness
    subscriptions: [],
    globalState: {
      get: (k, d) => (state.globalState.has(k) ? state.globalState.get(k) : d),
      update: async (k, v) => void state.globalState.set(k, v),
    },
  };

  return { vscode, state, context };
}
