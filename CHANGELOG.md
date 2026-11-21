# Changelog

## 0.6.7

### Internal
- `npm run check:release` now also works on Windows when Node.js is installed in a folder whose path contains spaces. No change to the extension itself.

## 0.6.6

### Fixed
- Export to Word now embeds images stored next to the Markdown file.
- Export to PDF now includes images stored next to the Markdown file.
- The "images from the internet" notice no longer appears for documents whose images are all local.
- The Copy button on code blocks in the Markdown editor now works (the editor's security policy blocked it).
- `.http` requests: header values that cannot be sent (characters outside Latin-1) are now reported instead of being dropped silently.

### Internal
- The Markdown editor's image preview now closes (button, backdrop, Escape) through the editor's own code; the separate workaround is gone.
- The Vditor fork is checked out byte for byte on every platform (`.gitattributes`), so its provenance check also passes on Windows.

## 0.6.5

### Changed
- The Markdown editor is now built from a small, maintained fork of Vditor kept in this repository (`vendor/vditor`), compiled from its TypeScript source. Unused parts were removed from the source itself instead of being stripped at build time: other interface languages, copy-to-publishing-site buttons, the help and info dialogs, video-site embeds, product emoji in the Lute engine, two font names, developer comments that were not in English, and default addresses of outside services. Every change is listed with file hashes in `vendor/vditor/PROVENANCE.md`. Nothing you could use before is gone.
- `THIRD-PARTY-NOTICES.md` now also reproduces the licences of Mermaid, KaTeX, the Ant Design icons and diff-match-patch, and describes the changes made to Vditor and Lute.

### Fixed
- Typing paired punctuation with a Chinese input method in the Markdown editor no longer gets interrupted (an earlier build step removed the editor's guard for it).
- Export to Word keeps ideographic (full-width) and no-break spaces instead of turning them into ordinary spaces.
- The image preview that opens when you double-click an image in the Markdown editor no longer triggers security-policy errors when it opens or closes.

### Internal
- New content-policy checks scan the source tree and every file of the packaged `.vsix`, and the release workflow stops if any check fails. Feature tests open Markdown, PDF, Word, spreadsheet and HTML documents with Chinese, Japanese and Korean text.

## 0.6.4

### Added
- Markdown editor: the **outline pane can be resized**. Drag its inner edge; double-click the edge to go back to the default width.
- Markdown editor: the **outline pane can sit on the left or the right**. Use the button in the outline's title bar to switch sides. The side and width are remembered.
- Markdown editor: **Insert image** ribbon button. Pick one or more images; they are linked with a path relative to the Markdown file. Images outside the file's folder and workspace can be copied next to it so they show in the editor.
- Markdown editor: **Shift + drag** files into the editor. Files from the VS Code Explorer are linked where they are (images as `![...](...)`, other files as links); files from the operating system are copied next to the Markdown file first (never overwriting).

## 0.6.3

### Changed
- Repository banner image updated to name file types by extension. No change to the extension itself.

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
