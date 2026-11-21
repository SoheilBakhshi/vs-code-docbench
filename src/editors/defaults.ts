import * as vscode from 'vscode';

// Opt-in "make Docbench my default" support. Our editors stay `priority: option`; this only
// writes `workbench.editorAssociations` (User settings) after the user explicitly picks file types,
// and can undo it. Works in the desktop and web extension (no node APIs).

const PROMPT_SHOWN_KEY = 'docbench.defaultsPromptShown';
/** pattern -> the association we replaced, so unticking restores it instead of just deleting. */
const REPLACED_KEY = 'docbench.replacedAssociations';
const CHOOSE = 'Choose File Types…';
const UNDO = 'Undo';

const VT = {
  markdown: 'docbench.markdown',
  pdf: 'docbench.pdf',
  docx: 'docbench.docx',
  spreadsheet: 'docbench.spreadsheet',
  xlsxEditor: 'docbench.xlsxEditor',
  html: 'docbench.html',
} as const;
const OUR_VIEW_TYPES = new Set<string>(Object.values(VT));

const SPREADSHEET_PATTERNS = ['*.xlsx', '*.xlsm', '*.xls', '*.ods', '*.csv', '*.tsv'];
/** The editable grid only claims these (see customEditors in package.json). */
const GRID_PATTERNS = new Set(['*.xlsx', '*.xlsm', '*.xls', '*.csv']);

interface Group {
  id: string;
  label: string;
  detail: string;
  patterns: string[];
  viewType: string;
  /** Ticked by default in the first-run prompt. */
  recommended: boolean;
}

const GROUPS: Group[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    detail: '.md, .markdown — WYSIWYG editor with Export to PDF',
    patterns: ['*.md', '*.markdown'],
    viewType: VT.markdown,
    recommended: true,
  },
  { id: 'pdf', label: 'PDF', detail: '.pdf', patterns: ['*.pdf'], viewType: VT.pdf, recommended: true },
  {
    id: 'word',
    label: 'Word documents',
    detail: '.docx, .dotx',
    patterns: ['*.docx', '*.dotx'],
    viewType: VT.docx,
    recommended: true,
  },
  {
    id: 'spreadsheet',
    label: 'Spreadsheets and CSV',
    detail: '.xlsx, .xlsm, .xls, .ods, .csv, .tsv — read-only viewer with charts, or an editable grid',
    patterns: SPREADSHEET_PATTERNS,
    viewType: VT.spreadsheet,
    recommended: true,
  },
  {
    id: 'html',
    label: 'HTML (preview only)',
    detail: '.html, .htm — shows a live preview instead of the source; use Open With… > Text Editor to edit',
    patterns: ['*.html', '*.htm'],
    viewType: VT.html,
    recommended: false,
  },
];

/** The file types this build can offer (the web entry has no pdf / word / spreadsheet editors). */
let offered: Group[] = GROUPS;

type Associations = Record<string, string>;

/** `workbench.editorAssociations` is an object, but older settings files may hold an array. */
function toAssociations(value: unknown): Associations {
  const out: Associations = {};
  if (Array.isArray(value)) {
    for (const e of value as { filenamePattern?: string; viewType?: string }[]) {
      if (e?.filenamePattern && e.viewType) {
        out[e.filenamePattern] = e.viewType;
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }
  }
  return out;
}

const config = () => vscode.workspace.getConfiguration('workbench');
const readUserAssociations = (): Associations => toAssociations(config().inspect('editorAssociations')?.globalValue);

async function writeUserAssociations(next: Associations): Promise<void> {
  await config().update('editorAssociations', Object.keys(next).length ? next : undefined, vscode.ConfigurationTarget.Global);
}

const sameAssociations = (a: Associations, b: Associations): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** A group counts as "on" when any of its patterns opens in one of our editors (even a hand-made partial setup). */
const isOn = (group: Group, current: Associations): boolean =>
  group.patterns.some((p) => OUR_VIEW_TYPES.has(current[p] ?? ''));

/** The view type to write for one pattern of a group (the grid only claims some spreadsheet patterns). */
function viewTypeFor(group: Group, pattern: string, spreadsheetChoice: string): string {
  return group.id === 'spreadsheet' && spreadsheetChoice === VT.xlsxEditor && GRID_PATTERNS.has(pattern)
    ? VT.xlsxEditor
    : group.viewType;
}

async function pickGroups(current: Associations, firstRun: boolean): Promise<Group[] | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { group: Group }>();
  qp.title = 'Docbench: default file types';
  qp.placeholder = 'Tick the file types that should open in Docbench by default, then press Enter';
  qp.canSelectMany = true;
  qp.ignoreFocusOut = true;
  qp.items = offered.map((group) => ({ label: group.label, detail: group.detail, group }));
  qp.selectedItems = qp.items.filter((i) => (firstRun ? i.group.recommended : isOn(i.group, current)));
  return new Promise((resolve) => {
    let accepted = false;
    qp.onDidAccept(() => {
      accepted = true;
      resolve(qp.selectedItems.map((i) => i.group));
      qp.hide();
    });
    qp.onDidHide(() => {
      if (!accepted) {
        resolve(undefined);
      }
      qp.dispose();
    });
    qp.show();
  });
}

/** Viewer vs editable grid. The current choice is listed first so Enter keeps it; Escape keeps it too. */
async function pickSpreadsheetEditor(currentViewType: string, hasCurrent: boolean): Promise<string> {
  const items = [
    {
      label: 'Viewer',
      description: hasCurrent && currentViewType === VT.spreadsheet ? 'current' : 'recommended',
      detail: 'Read-only, shows charts.',
      viewType: VT.spreadsheet,
    },
    {
      label: 'Editable grid',
      description: hasCurrent && currentViewType === VT.xlsxEditor ? 'current' : undefined,
      detail:
        'Edit and save .xlsx, .xlsm, .xls and .csv. Saving drops cell formatting, charts, images and pivot tables. (.ods and .tsv always open in the viewer.)',
      viewType: VT.xlsxEditor,
    },
  ];
  if (hasCurrent && currentViewType === VT.xlsxEditor) {
    items.reverse();
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'How should spreadsheets open?',
    placeHolder: 'You can still pick the other one any time with Open With…',
    ignoreFocusOut: true,
  });
  return picked?.viewType ?? currentViewType;
}

/** Entries a workspace/folder setting maps to something else; those win over the User setting. */
function workspaceOverrides(patterns: string[]): string[] {
  const inspected = config().inspect('editorAssociations');
  const scoped = [inspected?.workspaceValue, inspected?.workspaceFolderValue].map(toAssociations);
  return patterns.filter((p) => scoped.some((s) => s[p] && !OUR_VIEW_TYPES.has(s[p])));
}

/** Lets the user choose which file types open in Docbench by default (and undo that). */
export async function chooseDefaults(context: vscode.ExtensionContext, firstRun = false): Promise<void> {
  const before = readUserAssociations();
  const wasOn = new Set(offered.filter((g) => isOn(g, before)).map((g) => g.id));
  const chosen = await pickGroups(before, firstRun);
  if (!chosen) {
    return;
  }

  const currentSheet = SPREADSHEET_PATTERNS.some((p) => before[p] === VT.xlsxEditor) ? VT.xlsxEditor : VT.spreadsheet;
  const sheetChoice = chosen.some((g) => g.id === 'spreadsheet') ? await pickSpreadsheetEditor(currentSheet, wasOn.has('spreadsheet')) : currentSheet;

  // Re-read: the pickers can stay open for a while and settings may have changed meanwhile.
  const latest = readUserAssociations();
  const replacedBefore = context.globalState.get<Record<string, string>>(REPLACED_KEY, {});
  const replaced = { ...replacedBefore };
  const next: Associations = { ...latest };
  const overwritten: string[] = [];
  const restored: string[] = [];

  for (const group of offered) {
    const on = chosen.includes(group);
    for (const pattern of group.patterns) {
      if (on) {
        const existing = next[pattern];
        if (existing && existing !== 'default' && !OUR_VIEW_TYPES.has(existing)) {
          replaced[pattern] = existing;
          overwritten.push(pattern);
        }
        next[pattern] = viewTypeFor(group, pattern, sheetChoice);
      } else if (wasOn.has(group.id) && OUR_VIEW_TYPES.has(next[pattern] ?? '')) {
        // Only types that were ticked when the picker opened and are now unticked are given back.
        if (replaced[pattern]) {
          next[pattern] = replaced[pattern];
          delete replaced[pattern];
          restored.push(pattern);
        } else {
          delete next[pattern];
        }
      }
    }
  }

  if (sameAssociations(next, latest)) {
    void vscode.window.showInformationMessage('Docbench: no changes made.');
    return;
  }

  try {
    await writeUserAssociations(next);
    await context.globalState.update(REPLACED_KEY, replaced);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Docbench: could not update your User settings (${e instanceof Error ? e.message : String(e)}). If settings.json is open with unsaved changes or errors, fix that and try again.`,
    );
    return;
  }

  const names = chosen.map((g) => g.label);
  const parts = [
    names.length
      ? `Docbench is now the default for: ${names.join(', ')}.`
      : 'Docbench is no longer the default for any file type.',
    'Files that are already open keep their editor.',
  ];
  if (overwritten.length) {
    parts.push(`It replaced your earlier choice for ${overwritten.join(', ')} (restored if you untick them).`);
  }
  if (restored.length) {
    parts.push(`Your earlier choice was restored for ${restored.join(', ')}.`);
  }
  const overridden = workspaceOverrides(chosen.flatMap((g) => g.patterns));
  if (overridden.length) {
    parts.push(`Note: this workspace's own settings still override ${overridden.join(', ')}.`);
  }
  const choice = await vscode.window.showInformationMessage(parts.join(' '), UNDO);
  if (choice === UNDO) {
    try {
      await writeUserAssociations(latest);
      await context.globalState.update(REPLACED_KEY, replacedBefore);
      void vscode.window.showInformationMessage('Docbench: default file types reverted.');
    } catch (e) {
      void vscode.window.showErrorMessage(`Docbench: could not revert (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
}

/** One-time, non-modal offer the first time Docbench is used (the extension activates on use, not at start-up). Changes nothing unless the user opts in. */
export function offerDefaultsOnce(context: vscode.ExtensionContext): vscode.Disposable {
  if (context.globalState.get<boolean>(PROMPT_SHOWN_KEY)) {
    return { dispose() {} };
  }
  const timer = setTimeout(() => {
    void (async () => {
      try {
        // Re-check: another window may have made the offer in the meantime.
        if (context.globalState.get<boolean>(PROMPT_SHOWN_KEY)) {
          return;
        }
        if (offered.some((g) => isOn(g, readUserAssociations()))) {
          await context.globalState.update(PROMPT_SHOWN_KEY, true);
          return;
        }
        const kinds = offered.filter((g) => g.recommended).map((g) => g.label.replace(/ documents| and CSV/, ''));
        const list = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(kinds);
        const choice = await vscode.window.showInformationMessage(
          `Docbench is installed. Open ${list} files in it by default? Nothing changes unless you choose, and you can change or undo it any time ("Docbench: Choose Default File Types").`,
          CHOOSE,
          'Not Now',
        );
        // Marked once the offer was answered or dismissed (not if the window closed first).
        await context.globalState.update(PROMPT_SHOWN_KEY, true);
        if (choice === CHOOSE) {
          await chooseDefaults(context, true);
        }
      } catch (e) {
        void vscode.window.showErrorMessage(`Docbench: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, 3000);
  return { dispose: () => clearTimeout(timer) };
}

/** `groupIds` limits what is offered; omit it for the desktop build (everything). */
export function registerDefaults(context: vscode.ExtensionContext, groupIds?: string[]): vscode.Disposable {
  offered = groupIds ? GROUPS.filter((g) => groupIds.includes(g.id)) : GROUPS;
  return vscode.Disposable.from(
    vscode.commands.registerCommand('docbench.chooseDefaults', () => chooseDefaults(context, false)),
    offerDefaultsOnce(context),
  );
}
