# Changelog

## 0.6.2

### Changed
- Docbench no longer starts with every VS Code launch. It now starts the first time you open a file in one of its viewers or run one of its commands, and the one-time "open by default?" offer appears then.
- Spreadsheets are now read and written with SheetJS 0.20.3 (was 0.18.5), which includes the fixes for the publicly reported issues in the older release.
- The Word viewer is now listed as **Docbench: DOCX** in **Open With...**.
- Smaller package: pdf.js's scripting sandbox is no longer shipped (Docbench never ran scripts inside PDFs), and addresses of outside services inside the Markdown editor library (its default CDN, remote diagram rendering, video embeds, help links) are removed at build time. They were already blocked by the editor's security policy.
- The licence of the Lute Markdown engine (Mulan PSL v2) is now reproduced in `THIRD-PARTY-NOTICES.md`.
- README tidied.

## 0.6.1

### Changed
- README and store listing tidied: clearer install steps, a shorter project-status note, and file types named by extension (`docx`, `xlsx`, `csv`).
- Removed a start-up step that renamed default-editor entries left by pre-0.4 development builds. Docbench now changes `workbench.editorAssociations` only when you confirm it in **Choose Default File Types**.

## 0.6.0

### Added
- **Mermaid diagrams**: a fenced `mermaid` code block renders as a diagram in the Markdown editor (click it to edit the source). The diagram engine is bundled, so nothing is fetched from the internet.
- **GitHub-flavoured Markdown**: maths (`$inline$` and `$$block$$`, KaTeX, including `\ce{}` chemistry), syntax-highlighted code blocks (light and dark), footnotes, and GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) with coloured bars. Tables, task lists and strikethrough were already supported.
- PDF and Word export now include the rendered diagrams, maths (PDF: typeset; Word: the LaTeX text), highlighted code (PDF) and alert labels. Word embeds each diagram as a picture.

### Changed
- The editor no longer rewrites your text for two features that used to alter the file: bare URLs are left as typed (no automatic `<...>` links) and `> [!NOTE]` alerts are kept as written.
- Known formatting normalisations when you edit a document (the text means the same): table separator rows are spaced (`| :- | -: |`), a checked task becomes `[X]`, a footnote definition moves to the end of the file, and `:emoji:` shortcodes become the emoji character.
- Diagram engines other than Mermaid (Graphviz, ECharts, PlantUML, ...) are not included.

## 0.5.2

### Fixed
- The Close button of the full-screen image viewer (double-click an image in the Markdown editor) did nothing. The editor library closes it with inline handlers that Docbench's strict script policy blocks. Close, a click on the image, and the Escape key now work.

## 0.5.1

### Changed
- The PDF and Word export buttons now share one icon style (a page labelled PDF / DOC) in the Markdown ribbon and the editor title bar. The Word command previously had no title-bar icon and showed as text.

## 0.5.0

### Added
- **Export Markdown to Word (.docx)**: ribbon button, editor-title icon and the command *Export Markdown to Word*. Headings, inline formatting, links, nested / ordered / task lists, quotes, code blocks, tables and images are converted to real Word content. Works in the browser version too.

## 0.4.3

### Added
- When a Markdown document contains images from the internet (such as README badges), the editor now says so and offers a one-click **Show images** button, instead of silently showing broken images. The images stay hidden by default so the editor makes no network requests on its own.

## 0.4.2

### Fixed
- **Images now display in the Markdown editor.** Relative images (including `<img>` tags such as a README's logo) and embedded images show while editing; the paths in your file are saved back unchanged.

### Added
- Setting `docbench.markdown.loadRemoteImages` (off by default) to also show `https://` images such as badges. Needs a trusted workspace.

### Changed
- The Markdown editor may read the Markdown file's own folder and its workspace folder, to display images.

## 0.4.1

Store-readiness pass: documentation, licensing and a few fixes found in review.

### Added
- Logo, social preview, screenshots, a full README, `THIRD-PARTY-NOTICES.md` and publishing notes.
- Store listing metadata (icon, gallery banner, categories, keywords, links) and Restricted Mode declaration.

### Changed
- The HTML preview no longer loads remote (`https:`) images, so the only network feature is the `.http` client.
- `{{$processEnv}}` in `.http` files is only resolved in a trusted workspace.
- The package is much smaller: only the Vditor files the editor really loads are shipped.
- Removed the unused lint / test scripts.

### Fixed
- 100% stacked line and area charts now plot percentages (only bar charts did).
- The spreadsheet question in the default-editor picker no longer says "current" before anything is set.
- Clearer wording for charts that cannot be drawn.

## 0.4.0

### Added
- **Excel charts**: the spreadsheet viewer now draws charts (column, bar, line, area, pie, doughnut, scatter, bubble, radar, and combination charts with a secondary axis).
- **Markdown → PDF export** (ribbon button, editor-title icon and command), using an installed Chromium-based browser.
- **Optional default editors**: a one-time offer after install and the command *Choose Default File Types*, with Undo and restore of anything it replaced.
- **Open in Docbench** / **Edit Spreadsheet in Docbench** in the Explorer and tab context menus.
- Tooltips on every ribbon and toolbar button; a curly-quote icon for the Quote button.
- A notice in the spreadsheet editor when the opened file has charts (saving drops them).
- Restricted Mode support: HTML preview scripts are disabled until the workspace is trusted.
- Placeholder pages in the browser version for viewers that need desktop VS Code.
- Logo and store listing metadata.

### Changed
- The PDF browser-path setting (`docbench.pdfExport.browserPath`) is machine-scoped, so a workspace cannot set it.

### Fixed
- File contents reached the viewers in a shape they could not read, so spreadsheets (and others) failed to open.
- PDF export no longer leaves temporary files behind.

## 0.3.x

- Markdown WYSIWYG editor with two-way sync to the text document.
- HTML live preview with inlined local resources.
- Editable spreadsheet grid with save support.
- `.http` / `.rest` request client.

## 0.1 – 0.2

- Read-only viewers for spreadsheets / CSV, Word and PDF.
