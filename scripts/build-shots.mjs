// Generates sharp README screenshots: the real built viewers (media/<name>/index.js) rendered in a
// headless browser inside a VS Code-style window frame, with numbered highlight boxes.
//
//   node scripts/build-shots.mjs <workdir> <demoFilesDir>      (writes <workdir>/*.html; highlights: scripts/shots-overlays.json)
//   node scripts/capture.mjs <workdir> 8000 markdown-editor pdf-export word-viewer excel-charts default-picker
// Run from the repository root after `npm run compile`.
//
// The demo files (Release notes.md / .pdf, Quarterly report.docx, Sales dashboard.xlsx) are the
// neutral sample documents used for the README.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const [work, demo] = process.argv.slice(2);
mkdirSync(work, { recursive: true });
const url = (p) => pathToFileURL(p).href;
const b64 = (name) => readFileSync(join(demo, name)).toString('base64');
const media = (name) => join(repo, 'media', name);

// ---------- VS Code "Dark Modern" variables the viewers rely on ----------
const THEME = `
:root{
--vscode-font-family:"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,"Courier New",monospace;
--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#cccccc;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;
--vscode-panel-border:#2b2b2b;--vscode-editorWidget-background:#202020;--vscode-editorWidget-border:#454545;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;--vscode-focusBorder:#0078d4;
--vscode-toolbar-hoverBackground:rgba(90,93,94,.31);--vscode-toolbar-activeBackground:rgba(99,102,103,.31);--vscode-errorForeground:#f85149;--vscode-icon-foreground:#cccccc;
--vscode-editorGroupHeader-tabsBackground:#181818;--vscode-textLink-foreground:#4daafc;--vscode-textBlockQuote-border:#2b2b2b;--vscode-textBlockQuote-background:#2b2b2b;
--vscode-scrollbarSlider-background:rgba(121,121,121,.4);--vscode-editorHoverWidget-background:#202020;--vscode-editorHoverWidget-border:#454545;
--vscode-editorGroup-border:#2b2b2b;--vscode-tab-activeBorderTop:#0078d4;--vscode-list-hoverBackground:#2a2d2e;--vscode-inputValidation-warningBackground:#352a05;
--vscode-inputValidation-warningBorder:#b89500;--vscode-editor-selectionBackground:#264f78;
}`;

// ---------- a viewer page (runs the real bundle with a mocked VS Code API) ----------
function viewerPage({ bundle, body = '', bodyAttrs = '', head = '', scripts = [], messages = [], after = '', bodyClass = 'vscode-dark' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${THEME}</style>
<link rel="stylesheet" href="${url(join(media(bundle), 'index.css'))}">${head}</head>
<body class="${bodyClass}" ${bodyAttrs}>${body || '<div id="app"></div>'}
<script>
  window.__errs = [];
  const note = (m) => { window.__errs.push(m); document.documentElement.setAttribute('data-errs', window.__errs.join(' | ')); };
  window.addEventListener('error', (e) => note('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => note('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  window.acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
</script>
${scripts.map((s) => `<script src="${url(s)}"></script>`).join('\n')}
<script src="${url(join(media(bundle), 'index.js'))}"></script>
<script>${messages.map(([delay, code]) => `setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: ${code} })), ${delay});`).join('\n')}</script>${after ? `<script>${after}</script>` : ''}
</body></html>`;
}

const vd = join(media('markdown'), 'vditor/dist');
const releaseNotes = readFileSync(join(demo, 'Release notes.md'), 'utf8');
const pages = {
  markdown: viewerPage({
    bundle: 'markdown',
    bodyAttrs: `data-vditor-cdn="${url(join(media('markdown'), 'vditor'))}" data-vditor-root="${url(vd)}" data-link-base="${url(demo)}/" data-remote-images="true"`,
    scripts: [join(vd, 'js/i18n/en_US.js'), join(vd, 'js/icons/ant.js'), join(vd, 'js/lute/lute.min.js')],
    messages: [[1500, `{ type: 'update', text: ${JSON.stringify(releaseNotes)} }`]],
  }),
  pdf: viewerPage({
    bundle: 'pdf',
    bodyAttrs: `data-worker-src="${url(join(media('pdf'), 'pdf.worker.min.mjs'))}" data-cmap-url="${url(join(media('pdf'), 'cmaps'))}/" data-font-url="${url(join(media('pdf'), 'standard_fonts'))}/" data-wasm-url="${url(join(media('pdf'), 'wasm'))}/" data-icc-url="${url(join(media('pdf'), 'iccs'))}/"`,
    after: `setTimeout(() => { const b = (t) => [...document.querySelectorAll('.pdf-toolbar button')].find((x) => x.textContent.trim() === t); b('100%')?.click(); }, 2500); setTimeout(() => { const m = [...document.querySelectorAll('.pdf-toolbar button')].find((x) => x.textContent.trim() === '\u2212' || x.title.startsWith('Zoom out')); m?.click(); m?.click(); }, 3500);`,
    messages: [[800, `{ type: 'load', fileName: 'Release notes.pdf', ext: '.pdf', data: bytes('${b64('Release notes.pdf')}') }`]],
  }),
  docx: viewerPage({
    bundle: 'docx',
    messages: [[800, `{ type: 'load', fileName: 'Quarterly report.docx', ext: '.docx', data: bytes('${b64('Quarterly report.docx')}') }`]],
  }),
  sheet: viewerPage({
    bundle: 'spreadsheet',
    messages: [[800, `{ type: 'load', fileName: 'Sales dashboard.xlsx', ext: '.xlsx', data: bytes('${b64('Sales dashboard.xlsx')}') }`]],
  }),
};
for (const [name, html] of Object.entries(pages)) writeFileSync(join(work, `viewer-${name}.html`), html);

// ---------- the window frame ----------
const FILES = [
  ['api.http', '#b8b8b8'],
  ['app.js', '#e5c07b'],
  ['page.html', '#e37933'],
  ['pic.png', '#a074c4'],
  ['Quarterly report.docx', '#4a90d9'],
  ['Release notes.md', '#519aba'],
  ['Release notes.pdf', '#e5534b'],
  ['Sales dashboard.xlsx', '#3fb950'],
  ['style.css', '#519aba'],
];
const icon = (name) => `<img src="${url(join(repo, 'assets/icons', name))}" width="16" height="16" style="display:block">`;

function frame({ shot, active, viewer, label, tabActions = '', overlays = [], extra = '', content }) {
  const badge = (n, st = '') => `<span class="n" style="${st}">${n}</span>`;
  const boxes = overlays
    .map((o) => `<div class="hl" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px">${badge(o.n, o.nStyle)}${o.label ? `<span class="lbl" style="${o.lblStyle ?? ''}">${o.label}</span>` : ''}</div>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${THEME}
*{box-sizing:border-box}html,body{margin:0;width:1600px;height:900px;overflow:hidden;background:#181818;color:#ccc;font:13px "Segoe UI",system-ui,sans-serif}
.title{position:absolute;left:0;top:0;width:1600px;height:32px;background:#181818;border-bottom:1px solid #2b2b2b;display:flex;align-items:center;gap:14px;padding:0 10px;font-size:12px;color:#ccc}
.title .menu span{margin-right:12px}.title .cmd{position:absolute;left:520px;top:4px;width:560px;height:24px;border:1px solid #3c3c3c;border-radius:6px;background:#1f1f1f;text-align:center;line-height:22px;color:#9d9d9d}
.title .win{position:absolute;right:0;top:0;display:flex}.title .win i{width:46px;height:32px;display:block;position:relative}
.act{position:absolute;left:0;top:32px;width:48px;height:846px;background:#181818;border-right:1px solid #2b2b2b}
.act b{display:block;width:22px;height:22px;margin:13px auto;border:2px solid #858585;border-radius:5px}.act b.on{border-color:#fff}
.side{position:absolute;left:48px;top:32px;width:240px;height:846px;background:#181818;border-right:1px solid #2b2b2b;font-size:13px}
.side h6{margin:0;padding:10px 20px;font-size:11px;letter-spacing:.5px;font-weight:400;color:#ccc}
.side .root{padding:3px 12px;font-weight:700;font-size:11px;text-transform:uppercase}
.side .f{display:flex;align-items:center;gap:8px;padding:3px 12px 3px 26px;height:22px;color:#ccc}.side .f.on{background:#37373d;color:#fff}
.side .f i{width:12px;height:12px;border-radius:3px;display:block}
.tabs{position:absolute;left:288px;top:32px;width:1312px;height:35px;background:#181818;border-bottom:1px solid #2b2b2b;display:flex}
.tab{display:flex;align-items:center;gap:8px;padding:0 14px;height:35px;background:#1f1f1f;color:#fff;border-right:1px solid #2b2b2b;border-top:1px solid #0078d4;font-size:13px}
.tab i{width:12px;height:12px;border-radius:3px;display:block}.tab u{text-decoration:none;color:#9d9d9d;margin-left:6px}
.tabs .acts{position:absolute;right:12px;top:9px;display:flex;gap:14px;align-items:center}
.crumb{position:absolute;left:288px;top:67px;width:1312px;height:22px;background:#1f1f1f;display:flex;align-items:center;padding:0 16px;font-size:12px;color:#9d9d9d;justify-content:space-between}
.view{position:absolute;left:288px;top:89px;width:1312px;height:789px;background:#1f1f1f}
.view iframe{width:100%;height:100%;border:0;background:#1f1f1f}
.status{position:absolute;left:0;top:878px;width:1600px;height:22px;background:#181818;border-top:1px solid #2b2b2b;font-size:12px;color:#ccc;display:flex;align-items:center;padding:0 10px;gap:16px}
.hl{position:absolute;border:3px solid #ff4d6d;border-radius:8px;box-shadow:0 0 0 2px rgba(0,0,0,.45),0 0 18px rgba(255,77,109,.55);pointer-events:none;z-index:50}
.hl .n{position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#ff4d6d;color:#fff;font:700 15px/26px "Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.6)}
.hl .lbl{position:absolute;white-space:nowrap;background:#ff4d6d;color:#fff;font:600 13px/1 "Segoe UI",sans-serif;padding:5px 9px;border-radius:5px;box-shadow:0 1px 4px rgba(0,0,0,.6)}
${extra}
</style></head><body>
<div class="title"><span style="font-weight:700;color:#4daafc">&#9679;</span><div class="menu"><span>File</span><span>Edit</span><span>Selection</span><span>View</span><span>Go</span><span>Run</span><span>Terminal</span><span>Help</span></div><div class="cmd">docbench-demo</div></div>
<div class="act"><b class="on"></b><b></b><b></b><b></b><b></b></div>
<div class="side"><h6>EXPLORER</h6><div class="root">&#8964; docbench-demo</div>
${FILES.map(([f, c]) => `<div class="f${f === active ? ' on' : ''}"><i style="background:${c}"></i>${f}</div>`).join('')}</div>
<div class="tabs"><div class="tab"><i style="background:${FILES.find(([f]) => f === active)?.[1] ?? '#888'}"></i>${active}<u>&#215;</u></div><div class="acts">${tabActions}</div></div>
<div class="crumb"><span>${active}</span><span>${label ?? ''}</span></div>
<div class="view">${content ?? `<iframe src="${url(join(work, `viewer-${viewer}.html`))}"></iframe>`}</div>
<div class="status"><span>&#9095; main</span><span>&#9888; 0 &#10005; 0</span></div>
${boxes}
</body></html>`;
}

// ---------- the shots (coordinates are in the 1600x900 frame) ----------
const cfg = JSON.parse(readFileSync(join(repo, 'scripts/shots-overlays.json'), 'utf8'));
const shots = {
  'markdown-editor': frame({
    shot: 'markdown-editor',
    active: 'Release notes.md',
    viewer: 'markdown',
    label: 'Docbench: Markdown &#8964;',
    tabActions: `${icon('pdf-dark.svg')}${icon('docx-dark.svg')}<span style="color:#ccc">&#9707;</span><span style="color:#ccc">&#8943;</span>`,
    overlays: cfg['markdown-editor'] ?? [],
    extra: `.tip{position:absolute;z-index:60;background:#202020;border:1px solid #454545;border-radius:4px;padding:4px 8px;font-size:12px;color:#ccc;box-shadow:0 2px 8px rgba(0,0,0,.6)}`,
  }),
  'pdf-export': frame({ shot: 'pdf-export', active: 'Release notes.pdf', viewer: 'pdf', label: 'Docbench: PDF &#8964;', overlays: cfg['pdf-export'] ?? [] }),
  'word-viewer': frame({ shot: 'word-viewer', active: 'Quarterly report.docx', viewer: 'docx', label: 'Docbench: Word &#8964;', overlays: cfg['word-viewer'] ?? [] }),
  'excel-charts': frame({ shot: 'excel-charts', active: 'Sales dashboard.xlsx', viewer: 'sheet', label: 'Docbench: Spreadsheet &#8964;', overlays: cfg['excel-charts'] ?? [] }),
};

// The "default file types" picker is not a webview, so it is drawn to match VS Code's quick pick.
const row = (checked, label, detail) => `<div class="qi"><span class="cb${checked ? ' on' : ''}">${checked ? '&#10003;' : ''}</span><div><div class="ql">${label}</div><div class="qd">${detail}</div></div></div>`;
shots['default-picker'] = frame({
  shot: 'default-picker',
  active: 'Release notes.md',
  label: '',
  overlays: cfg['default-picker'] ?? [],
  content: `<div style="padding:60px 0 0 140px;color:#9d9d9d;font-size:13px"><h2 style="color:#ccc;font-weight:400;font-size:30px;margin:0">Visual Studio Code</h2><p>Editing evolved</p></div>`,
  extra: `.qp{position:absolute;left:520px;top:30px;width:640px;background:#202020;border:1px solid #454545;border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.7);padding:6px 0 6px;z-index:40;font-size:13px}
.qp .qt{text-align:center;color:#ccc;font-size:13px;padding:3px 0 7px}
.qp .qin{margin:0 8px 6px;display:flex;align-items:center;gap:8px}.qp .qin .box{flex:1;height:26px;background:#313131;border:1px solid #0078d4;border-radius:3px;padding:0 8px;line-height:24px;color:#8b8b8b;display:flex;justify-content:space-between}
.qp .qin .cnt{background:#0078d4;color:#fff;border-radius:10px;padding:0 8px;line-height:18px;margin-top:3px;font-size:11px;height:18px}.qp .qok{background:#0078d4;color:#fff;border-radius:3px;padding:0 14px;line-height:26px}
.qi{display:flex;gap:10px;padding:5px 10px 5px 10px;align-items:flex-start}.qi .cb{width:16px;height:16px;border:1px solid #6b6b6b;border-radius:3px;margin-top:2px;color:#fff;font-size:12px;text-align:center;line-height:14px;background:#313131}
.qi .cb.on{background:#0078d4;border-color:#0078d4}.qi .ql{color:#e6e6e6;font-size:13px}.qi .qd{color:#9d9d9d;font-size:12px;margin-top:1px}`,
});
shots['default-picker'] = shots['default-picker'].replace(
  '</body>',
  `<div class="qp"><div class="qt">Docbench: default file types</div><div class="qin"><div class="box"><span>Tick the file types that should open in Docbench by default, then press Enter</span><span class="cnt">4 Selected</span></div><div class="qok">OK</div></div>
${row(true, 'Markdown', '.md, .markdown &mdash; WYSIWYG editor with Export to PDF')}${row(true, 'PDF', '.pdf')}${row(true, 'Word documents', '.docx, .dotx')}${row(true, 'Spreadsheets and CSV', '.xlsx, .xlsm, .xls, .ods, .csv, .tsv &mdash; read-only viewer with charts, or an editable grid')}${row(false, 'HTML (preview only)', '.html, .htm &mdash; shows a live preview instead of the source; use Open With&hellip; &gt; Text Editor to edit')}</div></body>`,
);
for (const [name, html] of Object.entries(shots)) writeFileSync(join(work, `${name}.html`), html);
console.log('wrote', Object.keys(shots).join(', '));
