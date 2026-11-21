# Vditor fork for Docbench: provenance

This folder is a minimal, maintained fork of the Vditor Markdown editor. Docbench builds its Markdown
editor from it; the upstream package is not installed (`package.json` depends on `file:vendor/vditor`).
Why it exists and what it must not contain: [docs/CONTENT-POLICY.md](../../docs/CONTENT-POLICY.md).

## Upstream

| | |
|---|---|
| Package | `vditor@4.0.1` from the npm registry |
| Tarball | `vditor-4.0.1.tgz`, SHA-256 `b72767473a6220c0363abda5845a21762574190a247d07f27281caa07f66745b` |
| npm integrity | `sha512-CyajvPNE8fjCgEAzAaSxVEEWwQMJ5FTIVkNn3k+5IRaldqGwPRr8Dx2QLALHGCby8L/AJ6pQXjXiSPUGhHGmDw==` |
| Source | https://github.com/Vanessa219/vditor (tag v4.0.1) |
| Licence | MIT, [LICENSE](LICENSE) (verbatim, with the original copyright line) |
| Fork version | `4.0.1-docbench.1` |

Bundled third-party files, taken verbatim from the same tarball (`dist/js/...`): Mermaid, KaTeX (with
the mhchem extension and its WOFF2 fonts) and highlight.js. The Lute engine (`dist/js/lute/lute.min.js`,
Mulan PSL v2, https://github.com/88250/lute) is taken from the same tarball and modified as listed below.
Their licences are reproduced in `THIRD-PARTY-NOTICES.md`.

## What the fork contains

- `src/`: Vditor's TypeScript source (`src/index.ts`, `src/method.ts`, `src/ts/**`). Docbench compiles it
  with esbuild; `tsconfig.json` keeps Vditor's class-field semantics.
- `dist/*.d.ts`, `dist/ts/**`, `dist/types/`: upstream type declarations, used by Docbench's type check.
- `dist/index.css`: Vditor's compiled stylesheet (the Less sources are not part of the fork).
- `dist/css`, `dist/images`, `dist/js`: the runtime files the editor loads from the webview: light and dark
  content themes, the loading image, English interface strings, the Ant Design based icon set, Lute,
  Mermaid, KaTeX and highlight.js. Nothing else from upstream `dist/` is kept.

## Changes from upstream

Names below refer to rule ids in `scripts/content-policy/rules.mjs`; the policy lists them in full.

1. **Developer comments in Chinese removed** from all `.ts` files (527 comments) with
   `scripts/vendor/strip-cjk-comments.mjs`, which uses the TypeScript parser. Code was proven unchanged:
   every file transpiled with comments removed is byte-identical to upstream.
2. **Interface languages**: only English (`en_US`) is shipped and accepted; the default language is
   `en_US` instead of Chinese. The `II18n` type lists `en_US` only.
3. **Copy-to-publishing-site actions removed** (`wechat`, `zhihu`): the two preview-bar buttons, their
   icons in `dist/js/icons/ant.js`, the clipboard variants that rewrote maths for those sites, and the
   `IPreviewAction` values. The plain "copy" of selected preview content is kept, with an English tip.
4. **Help and info dialogs removed** (`Help.ts`, `Info.ts`, their declarations and toolbar entries): they
   only linked to the upstream community site (`ld246`, `b3log`). Error messages no longer link there.
5. **Video-site embeds removed** from `src/ts/markdown/mediaRender.ts` (`youku`, `qq-video`, `bilibili`
   and five other video sites). Links to `.mp4`/`.webm`/`.mp3`/... files still become `<video>`/`<audio>`.
   Docbench also leaves media rendering off.
6. **No outside services by default**: the default script CDN is empty (the host must pass `cdn`; Docbench
   passes the local webview address), the content-theme list names only the shipped light and dark themes,
   and PlantUML diagrams show an error instead of being sent to a remote rendering server.
7. **Font stacks**: two Chinese font families removed from the three `font-family` stacks in
   `dist/index.css` (`cjk-font`). Text in any script still renders through the browser's font fallback.
8. **Code-block copy button** falls back to "Copy" / "Copied" instead of Chinese text, and is built with
   DOM calls and `addEventListener` (`src/ts/markdown/codeRender.ts`) instead of inline `onmouseover` /
   `onclick` attributes, which a nonce-only `script-src` CSP blocks (upstream, Copy did nothing in
   Docbench's webview). Behaviour is unchanged: select the hidden textarea, copy, show "Copied".
9. **Build compatibility**: `src/ts/undo/index.ts` calls `new DiffMatchPatch.diff_match_patch()`, because
   esbuild does not allow calling an `import * as` namespace (upstream relied on webpack behaviour).
10. **Lute engine** (`dist/js/lute/lute.min.js`, exact, counted string edits on the minified upstream file):
    - 17 image emoji shortcuts that pointed to an emoji image folder Docbench does not ship (product logos
      such as `siyuan`, `b3log`, `hacpai`, `liandi`, `huaji`, and others) removed from the emoji map, and the
      file-extension special cases for two of them removed. Standard Unicode emoji are unchanged.
    - A link-base special case for the asset hosts of a note-taking app (`siyuan`) replaced by `false`.
    - Two product names (`b3log`, `hacpai`) removed from the term-typo dictionary.
    - One replacement that rewrote an image label used by articles pasted from a publishing platform removed.
    - Kept on purpose: full-width punctuation, ideographic-space handling and CJK-aware footnote rendering
      (needed for documents in Chinese, Japanese and Korean), and the IANA top-level domain list.
11. **Kept on purpose in the TypeScript source**: the input-method guard for `"《"` in `ir/index.ts` and
    `wysiwyg/index.ts`, which keeps typing in a Chinese IME working.
12. **Image preview overlay** (`src/ts/preview/image.ts`, opened by double-clicking an image): its close
    button and its backdrop closed the overlay through inline `onclick` attributes, which a nonce-only
    `script-src` CSP blocks, so the overlay could not be closed. Both now close through `addEventListener`;
    the close button is found by `data-type="close"`. Escape also closes it.
13. Upstream MIT licence banners at the top of `dist/index.css` and the content themes are kept verbatim.

Files removed from the upstream package (not copied into the fork): `README.md` (Chinese), the
non-English interface strings, the emoji image folder, the extra content themes, the Material icon set, the
other diagram engines (abcjs, echarts, flowchart, graphviz, markmap, mathjax, plantuml encoder,
smiles-drawer, wavedrom), prebuilt `index.js`/`method.js` bundles, and the Less sources.

## Updating the fork

1. `npm pack vditor@<version>` and unpack it outside the repository.
2. Copy the same file set, run `node scripts/vendor/strip-cjk-comments.mjs vendor/vditor/src vendor/vditor/dist`,
   and re-apply changes 2 to 13 (compare with `git diff` of this folder against the previous upstream).
3. `node scripts/vendor/vditor-provenance.mjs write <unpacked-package-dir>` to refresh the table below.
4. `npm run check:content` and `npm test` must pass; review any changed exception count in
   `scripts/content-policy/rules.mjs` instead of raising it blindly.

## Files

Status `verbatim`: identical to the upstream file. `modified`: changed as described above.
`vditor-provenance.mjs check` (run by `npm test`) fails if a file changes without this table being updated.

<!-- files:start -->
| File | Status | Upstream SHA-256 (first 16) | Fork SHA-256 (first 16) |
|---|---|---|---|
| LICENSE | verbatim | c50d6e1944c4c155 | c50d6e1944c4c155 |
| dist/css/content-theme/dark.css | verbatim | 79529741d2e94b6d | 79529741d2e94b6d |
| dist/css/content-theme/light.css | verbatim | 9848c5a4d637f180 | 9848c5a4d637f180 |
| dist/images/img-loading.svg | verbatim | 1212c6882e5627b3 | 1212c6882e5627b3 |
| dist/index.css | modified | c6e693e24d3c0b47 | 6a85e14279b23c05 |
| dist/index.d.ts | modified | cb8d2e4123063730 | 11109ba95d43999d |
| dist/js/highlight.js/LICENSE | verbatim | 6c081431591d9df6 | 6c081431591d9df6 |
| dist/js/highlight.js/highlight.min.js | verbatim | 3555e3c33b8a64ec | 3555e3c33b8a64ec |
| dist/js/highlight.js/styles/github-dark.min.css | verbatim | bd923f35d598428d | bd923f35d598428d |
| dist/js/highlight.js/styles/github.min.css | verbatim | 5f5db2458549f8b8 | 5f5db2458549f8b8 |
| dist/js/highlight.js/third-languages.js | verbatim | 3bf29ef22f3ce4c4 | 3bf29ef22f3ce4c4 |
| dist/js/i18n/en_US.js | verbatim | 91c5b70447a0d337 | 91c5b70447a0d337 |
| dist/js/icons/ant.js | modified | a91e14e09dcd7b99 | 16294b2ea767d6fd |
| dist/js/katex/fonts/KaTeX_AMS-Regular.woff2 | verbatim | 0cdd387c9590a1a9 | 0cdd387c9590a1a9 |
| dist/js/katex/fonts/KaTeX_Caligraphic-Bold.woff2 | verbatim | de7701e42cf1f4cf | de7701e42cf1f4cf |
| dist/js/katex/fonts/KaTeX_Caligraphic-Regular.woff2 | verbatim | 5d53e70ad607c235 | 5d53e70ad607c235 |
| dist/js/katex/fonts/KaTeX_Fraktur-Bold.woff2 | verbatim | 74444efd593c005e | 74444efd593c005e |
| dist/js/katex/fonts/KaTeX_Fraktur-Regular.woff2 | verbatim | 51814d270d06ff02 | 51814d270d06ff02 |
| dist/js/katex/fonts/KaTeX_Main-Bold.woff2 | verbatim | 0f60d1b897938ec9 | 0f60d1b897938ec9 |
| dist/js/katex/fonts/KaTeX_Main-BoldItalic.woff2 | verbatim | 99cd42a3c072d918 | 99cd42a3c072d918 |
| dist/js/katex/fonts/KaTeX_Main-Italic.woff2 | verbatim | 97479ca6cce906ab | 97479ca6cce906ab |
| dist/js/katex/fonts/KaTeX_Main-Regular.woff2 | verbatim | c2342cd8b869e017 | c2342cd8b869e017 |
| dist/js/katex/fonts/KaTeX_Math-BoldItalic.woff2 | verbatim | dc47344dbb6cb5b6 | dc47344dbb6cb5b6 |
| dist/js/katex/fonts/KaTeX_Math-Italic.woff2 | verbatim | 7af58c5ec8f132a2 | 7af58c5ec8f132a2 |
| dist/js/katex/fonts/KaTeX_SansSerif-Bold.woff2 | verbatim | e99ae51144bf1232 | e99ae51144bf1232 |
| dist/js/katex/fonts/KaTeX_SansSerif-Italic.woff2 | verbatim | 00b26ac825e20950 | 00b26ac825e20950 |
| dist/js/katex/fonts/KaTeX_SansSerif-Regular.woff2 | verbatim | 68e8c73ef42afd3c | 68e8c73ef42afd3c |
| dist/js/katex/fonts/KaTeX_Script-Regular.woff2 | verbatim | 036d4e95149b69ff | 036d4e95149b69ff |
| dist/js/katex/fonts/KaTeX_Size1-Regular.woff2 | verbatim | 6b47c40166b6dbe2 | 6b47c40166b6dbe2 |
| dist/js/katex/fonts/KaTeX_Size2-Regular.woff2 | verbatim | d04c54219f9eaec6 | d04c54219f9eaec6 |
| dist/js/katex/fonts/KaTeX_Size3-Regular.woff2 | verbatim | 73d591271b160496 | 73d591271b160496 |
| dist/js/katex/fonts/KaTeX_Size4-Regular.woff2 | verbatim | a4af7d414440a1c1 | a4af7d414440a1c1 |
| dist/js/katex/fonts/KaTeX_Typewriter-Regular.woff2 | verbatim | 71d517d67827787c | 71d517d67827787c |
| dist/js/katex/katex.min.css | verbatim | 505d5f829022bb7b | 505d5f829022bb7b |
| dist/js/katex/katex.min.js | verbatim | dc84b296ec3e884d | dc84b296ec3e884d |
| dist/js/katex/mhchem.min.js | verbatim | f0ca03df194b8c3d | f0ca03df194b8c3d |
| dist/js/lute/lute.min.js | modified | 53b61b051a3dfd9e | 013593a40539704f |
| dist/js/mermaid/mermaid.min.js | verbatim | 581ed7d74bd9048d | 581ed7d74bd9048d |
| dist/method.d.ts | modified | f6679676415848cb | 6ab6f97acd8d33ac |
| dist/ts/constants.d.ts | modified | 608b04c7bb30e22d | 10eaac111580a498 |
| dist/ts/devtools/index.d.ts | verbatim | 266f04886ef79b3f | 266f04886ef79b3f |
| dist/ts/export/index.d.ts | verbatim | e74644b7c49801f9 | e74644b7c49801f9 |
| dist/ts/hint/index.d.ts | verbatim | 9c1b49b978f2880b | 9c1b49b978f2880b |
| dist/ts/ir/expandMarker.d.ts | verbatim | 04f3953cfdb526ee | 04f3953cfdb526ee |
| dist/ts/ir/highlightToolbarIR.d.ts | verbatim | efa9312dbb063159 | efa9312dbb063159 |
| dist/ts/ir/index.d.ts | verbatim | 11f2a27d00ed259b | 11f2a27d00ed259b |
| dist/ts/ir/input.d.ts | verbatim | fde3ac869d1709a3 | fde3ac869d1709a3 |
| dist/ts/ir/process.d.ts | verbatim | d618b47beb70266c | d618b47beb70266c |
| dist/ts/ir/processKeydown.d.ts | verbatim | e525041b047aef09 | e525041b047aef09 |
| dist/ts/markdown/SMILESRender.d.ts | verbatim | 8b2387837e75c62f | 8b2387837e75c62f |
| dist/ts/markdown/abcRender.d.ts | verbatim | d91e42b883f643f4 | d91e42b883f643f4 |
| dist/ts/markdown/adapterRender.d.ts | modified | bc288e975a0544b1 | 06c35ec552fe5383 |
| dist/ts/markdown/anchorRender.d.ts | verbatim | b9a2d38240f23300 | b9a2d38240f23300 |
| dist/ts/markdown/chartRender.d.ts | verbatim | cec13157c0cfc7ad | cec13157c0cfc7ad |
| dist/ts/markdown/codeRender.d.ts | verbatim | e60f97c71739c6fe | e60f97c71739c6fe |
| dist/ts/markdown/flowchartRender.d.ts | verbatim | 66926fb2be3b7283 | 66926fb2be3b7283 |
| dist/ts/markdown/getHTML.d.ts | verbatim | 345a18330569d834 | 345a18330569d834 |
| dist/ts/markdown/getMarkdown.d.ts | verbatim | 93d0464cec737d22 | 93d0464cec737d22 |
| dist/ts/markdown/graphvizRender.d.ts | verbatim | d92648b79c93131d | d92648b79c93131d |
| dist/ts/markdown/highlightRender.d.ts | verbatim | 0bbfde011d515ce8 | 0bbfde011d515ce8 |
| dist/ts/markdown/imageCaptionRender.d.ts | verbatim | 3bdd1e3a7b7791a7 | 3bdd1e3a7b7791a7 |
| dist/ts/markdown/lazyLoadImageRender.d.ts | verbatim | 3712aa9545b929bb | 3712aa9545b929bb |
| dist/ts/markdown/markmapRender.d.ts | verbatim | 90be137778602abf | 90be137778602abf |
| dist/ts/markdown/mathRender.d.ts | verbatim | 2c443720391a7ee2 | 2c443720391a7ee2 |
| dist/ts/markdown/mediaRender.d.ts | verbatim | d7f6cbd22c9d7753 | d7f6cbd22c9d7753 |
| dist/ts/markdown/mermaidRender.d.ts | verbatim | e377b314309078b1 | e377b314309078b1 |
| dist/ts/markdown/mindmapRender.d.ts | verbatim | 124a349eac82e7b0 | 124a349eac82e7b0 |
| dist/ts/markdown/outlineRender.d.ts | verbatim | d3b8be6e42ea8fac | d3b8be6e42ea8fac |
| dist/ts/markdown/plantumlRender.d.ts | verbatim | ce0b30755d60ca94 | ce0b30755d60ca94 |
| dist/ts/markdown/previewRender.d.ts | verbatim | 5ebace75fcc43a74 | 5ebace75fcc43a74 |
| dist/ts/markdown/setLute.d.ts | verbatim | dfb082be83f4b652 | dfb082be83f4b652 |
| dist/ts/markdown/speechRender.d.ts | verbatim | ea7fb04c48f3a68c | ea7fb04c48f3a68c |
| dist/ts/markdown/wavedromRender.d.ts | verbatim | 443ad55c5a57f614 | 443ad55c5a57f614 |
| dist/ts/outline/index.d.ts | verbatim | be7d037185a845a1 | be7d037185a845a1 |
| dist/ts/preview/image.d.ts | verbatim | ef3784600053c462 | ef3784600053c462 |
| dist/ts/preview/index.d.ts | verbatim | 35ed855c4f2f891f | 35ed855c4f2f891f |
| dist/ts/resize/index.d.ts | verbatim | 04659b5f024321e9 | 04659b5f024321e9 |
| dist/ts/sv/index.d.ts | verbatim | f6635006c51628d9 | f6635006c51628d9 |
| dist/ts/sv/process.d.ts | verbatim | 7acf7d849a80201a | 7acf7d849a80201a |
| dist/ts/sv/processKeydown.d.ts | verbatim | e525041b047aef09 | e525041b047aef09 |
| dist/ts/tip/index.d.ts | verbatim | a2abb5b35a2b4723 | a2abb5b35a2b4723 |
| dist/ts/toolbar/Both.d.ts | verbatim | a68a0d0fe19db38b | a68a0d0fe19db38b |
| dist/ts/toolbar/Br.d.ts | verbatim | 3b539fd04a32e5a1 | 3b539fd04a32e5a1 |
| dist/ts/toolbar/CodeTheme.d.ts | verbatim | 93011740bfabb00a | 93011740bfabb00a |
| dist/ts/toolbar/ContentTheme.d.ts | verbatim | adb7cedc6ca34516 | adb7cedc6ca34516 |
| dist/ts/toolbar/Counter.d.ts | verbatim | ea5e8ebd2bf87304 | ea5e8ebd2bf87304 |
| dist/ts/toolbar/Custom.d.ts | verbatim | 613f9b7c9aa00791 | 613f9b7c9aa00791 |
| dist/ts/toolbar/Devtools.d.ts | verbatim | d4281fb65751820a | d4281fb65751820a |
| dist/ts/toolbar/Divider.d.ts | verbatim | f1774a7ef4264aa1 | f1774a7ef4264aa1 |
| dist/ts/toolbar/EditMode.d.ts | verbatim | 5b9bfea5d1081302 | 5b9bfea5d1081302 |
| dist/ts/toolbar/Emoji.d.ts | verbatim | e689bd74ed666bee | e689bd74ed666bee |
| dist/ts/toolbar/Export.d.ts | verbatim | 112aa4fae2bd838d | 112aa4fae2bd838d |
| dist/ts/toolbar/Fullscreen.d.ts | verbatim | 31f8776164bc438c | 31f8776164bc438c |
| dist/ts/toolbar/Headings.d.ts | verbatim | 9c89ad83e0219ef8 | 9c89ad83e0219ef8 |
| dist/ts/toolbar/Indent.d.ts | verbatim | 8f477749282aede4 | 8f477749282aede4 |
| dist/ts/toolbar/InsertAfter.d.ts | verbatim | ac2d4c0a115bf3d5 | ac2d4c0a115bf3d5 |
| dist/ts/toolbar/InsertBefore.d.ts | verbatim | 75c6c82ed380c541 | 75c6c82ed380c541 |
| dist/ts/toolbar/MenuItem.d.ts | verbatim | 2c8e67201de167c9 | 2c8e67201de167c9 |
| dist/ts/toolbar/Outdent.d.ts | verbatim | dc1c9e7286ea2adf | dc1c9e7286ea2adf |
| dist/ts/toolbar/Outline.d.ts | verbatim | a746512148c3752c | a746512148c3752c |
| dist/ts/toolbar/Preview.d.ts | verbatim | b69ccd1bbd2e1268 | b69ccd1bbd2e1268 |
| dist/ts/toolbar/Record.d.ts | verbatim | 8dc2ed0891b93057 | 8dc2ed0891b93057 |
| dist/ts/toolbar/Redo.d.ts | verbatim | 77cb4f1083322a01 | 77cb4f1083322a01 |
| dist/ts/toolbar/Undo.d.ts | verbatim | 0157d62ff62f56c0 | 0157d62ff62f56c0 |
| dist/ts/toolbar/Upload.d.ts | verbatim | 9c91296c90fd4b9f | 9c91296c90fd4b9f |
| dist/ts/toolbar/index.d.ts | verbatim | bbaac7f71867d78c | bbaac7f71867d78c |
| dist/ts/toolbar/setToolbar.d.ts | verbatim | 139556684bdeb633 | 139556684bdeb633 |
| dist/ts/ui/initUI.d.ts | verbatim | 77dd2ba9ccd393be | 77dd2ba9ccd393be |
| dist/ts/ui/setCodeTheme.d.ts | verbatim | 14f53353bf61285f | 14f53353bf61285f |
| dist/ts/ui/setContentTheme.d.ts | verbatim | 363f5e57adec8c81 | 363f5e57adec8c81 |
| dist/ts/ui/setPreviewMode.d.ts | verbatim | 05e9ada3848ded8b | 05e9ada3848ded8b |
| dist/ts/ui/setTheme.d.ts | verbatim | 0a7934dfa887a580 | 0a7934dfa887a580 |
| dist/ts/undo/index.d.ts | verbatim | d718118daa1fc1a9 | d718118daa1fc1a9 |
| dist/ts/upload/getElement.d.ts | verbatim | 104ea9d84fd0c373 | 104ea9d84fd0c373 |
| dist/ts/upload/index.d.ts | verbatim | 67cf907336d0d5ac | 67cf907336d0d5ac |
| dist/ts/upload/setHeaders.d.ts | verbatim | 0186643934d37fd2 | 0186643934d37fd2 |
| dist/ts/util/Options.d.ts | verbatim | b1a54e7969129c47 | b1a54e7969129c47 |
| dist/ts/util/RecordMedia.d.ts | verbatim | 4b08cbd05b2597a4 | 4b08cbd05b2597a4 |
| dist/ts/util/addScript.d.ts | verbatim | 62a135f464a36697 | 62a135f464a36697 |
| dist/ts/util/addStyle.d.ts | verbatim | 345ba7ff3ea45ead | 345ba7ff3ea45ead |
| dist/ts/util/code160to32.d.ts | verbatim | 2ab8926c86442acd | 2ab8926c86442acd |
| dist/ts/util/compatibility.d.ts | verbatim | 5e6ce5d74fc67102 | 5e6ce5d74fc67102 |
| dist/ts/util/editorCommonEvent.d.ts | verbatim | b9c977b7abfd2ab6 | b9c977b7abfd2ab6 |
| dist/ts/util/fixBrowserBehavior.d.ts | verbatim | 03a9de8894b65c61 | 03a9de8894b65c61 |
| dist/ts/util/function.d.ts | verbatim | ee4dffad38e2d28c | ee4dffad38e2d28c |
| dist/ts/util/getSelectText.d.ts | verbatim | 4116488070186706 | 4116488070186706 |
| dist/ts/util/hasClosest.d.ts | verbatim | 6af84463e410d3ff | 6af84463e410d3ff |
| dist/ts/util/hasClosestByHeadings.d.ts | verbatim | ea9cd355c3db407b | ea9cd355c3db407b |
| dist/ts/util/highlightToolbar.d.ts | verbatim | cfb2d700cbd929a0 | cfb2d700cbd929a0 |
| dist/ts/util/hotKey.d.ts | verbatim | f4e8a15527c93a41 | f4e8a15527c93a41 |
| dist/ts/util/log.d.ts | verbatim | 67322a687a23e887 | 67322a687a23e887 |
| dist/ts/util/merge.d.ts | verbatim | 1753fea1fb18ad94 | 1753fea1fb18ad94 |
| dist/ts/util/processCode.d.ts | verbatim | cdfbcb06b35a0d3b | cdfbcb06b35a0d3b |
| dist/ts/util/selection.d.ts | verbatim | 9894117b7c0be225 | 9894117b7c0be225 |
| dist/ts/util/toc.d.ts | verbatim | 79860c1cd9ae3998 | 79860c1cd9ae3998 |
| dist/ts/wysiwyg/afterRenderEvent.d.ts | verbatim | ae77e27b4cb77a6d | ae77e27b4cb77a6d |
| dist/ts/wysiwyg/highlightToolbarWYSIWYG.d.ts | verbatim | 3a6d9681489b3cb7 | 3a6d9681489b3cb7 |
| dist/ts/wysiwyg/index.d.ts | verbatim | bbb67d1c52c16add | bbb67d1c52c16add |
| dist/ts/wysiwyg/inlineTag.d.ts | verbatim | 3afb5afe5faff176 | 3afb5afe5faff176 |
| dist/ts/wysiwyg/input.d.ts | verbatim | f890f21982bde648 | f890f21982bde648 |
| dist/ts/wysiwyg/processKeydown.d.ts | verbatim | 934f58e8ddf556c3 | 934f58e8ddf556c3 |
| dist/ts/wysiwyg/renderDomByMd.d.ts | verbatim | 55f3873c8b9a3d56 | 55f3873c8b9a3d56 |
| dist/ts/wysiwyg/setHeading.d.ts | verbatim | d2985e9995565a67 | d2985e9995565a67 |
| dist/ts/wysiwyg/showCode.d.ts | verbatim | c6e87b2cfba48370 | c6e87b2cfba48370 |
| dist/ts/wysiwyg/toolbarEvent.d.ts | verbatim | df0131538df279eb | df0131538df279eb |
| dist/types/index.d.ts | modified | b5821cf67869fe82 | 083396664855dcdc |
| src/index.ts | modified | 2ed2773e7192b709 | 7e458afdc164f1fa |
| src/method.ts | modified | 8ebd9edfe8b9b448 | 9106b939a7fd8c6f |
| src/ts/constants.ts | modified | c7e0681f6d19136d | 7487a280ca954798 |
| src/ts/devtools/index.ts | verbatim | 9fa3b30c1ab78243 | 9fa3b30c1ab78243 |
| src/ts/export/index.ts | verbatim | 4909930d0d837d13 | 4909930d0d837d13 |
| src/ts/hint/index.ts | modified | 7f6f1bb2b4e9db1b | 121c12e81bb21a16 |
| src/ts/ir/expandMarker.ts | modified | 1411d8fbc244444b | 171fcec8fed8e328 |
| src/ts/ir/highlightToolbarIR.ts | verbatim | cd095096636f37a0 | cd095096636f37a0 |
| src/ts/ir/index.ts | modified | 4520e8cfb47bf3b7 | ef3a9f8617fe3304 |
| src/ts/ir/input.ts | modified | 0dd745de4a849f7a | 3686e0f46e83315e |
| src/ts/ir/process.ts | modified | 075d3c15f32c5472 | 106c305246e92dcd |
| src/ts/ir/processKeydown.ts | modified | abd015dba72b1ae5 | 92af974e08636986 |
| src/ts/markdown/SMILESRender.ts | verbatim | b98368fcb3db3852 | b98368fcb3db3852 |
| src/ts/markdown/abcRender.ts | verbatim | b25025339694a71a | b25025339694a71a |
| src/ts/markdown/adapterRender.ts | modified | 997af5fc48bc0f9e | 962a513f69408154 |
| src/ts/markdown/anchorRender.ts | verbatim | ea758917899b0953 | ea758917899b0953 |
| src/ts/markdown/chartRender.ts | verbatim | 6994a60e7e3573ec | 6994a60e7e3573ec |
| src/ts/markdown/codeRender.ts | modified | c58f35ea5cd4a629 | 4186f05abf366f36 |
| src/ts/markdown/flowchartRender.ts | verbatim | 574b2118a81c27fc | 574b2118a81c27fc |
| src/ts/markdown/getHTML.ts | verbatim | 6b0da69592da40fe | 6b0da69592da40fe |
| src/ts/markdown/getMarkdown.ts | verbatim | 724ce7edfc29f5a3 | 724ce7edfc29f5a3 |
| src/ts/markdown/graphvizRender.ts | verbatim | 5c904e7e3af07a39 | 5c904e7e3af07a39 |
| src/ts/markdown/highlightRender.ts | modified | ad52c4f927665420 | 5f5a44158690bebe |
| src/ts/markdown/imageCaptionRender.ts | verbatim | a4561b95d46bd7be | a4561b95d46bd7be |
| src/ts/markdown/lazyLoadImageRender.ts | verbatim | 7c9c35664efc6fe1 | 7c9c35664efc6fe1 |
| src/ts/markdown/markmapRender.ts | verbatim | 8a3ab27a002d56d6 | 8a3ab27a002d56d6 |
| src/ts/markdown/mathRender.ts | modified | 4eddb02f463ed88c | e000e4714b77a3d9 |
| src/ts/markdown/mediaRender.ts | modified | a843208b250adffd | 7b2874df3311017e |
| src/ts/markdown/mermaidRender.ts | modified | 507295154bc1080d | 089df174656cd216 |
| src/ts/markdown/mindmapRender.ts | verbatim | ad9374507633dd9a | ad9374507633dd9a |
| src/ts/markdown/outlineRender.ts | verbatim | 11fc731d674156de | 11fc731d674156de |
| src/ts/markdown/plantumlRender.ts | modified | b26f400b0088a249 | 855ed11e2091bc5a |
| src/ts/markdown/previewRender.ts | modified | 94e2009f355a82a7 | 35ce165d56000c83 |
| src/ts/markdown/setLute.ts | verbatim | 04ba36129ff1869b | 04ba36129ff1869b |
| src/ts/markdown/speechRender.ts | modified | f9bf5b8dfc0e80c4 | 24ffbade71354b43 |
| src/ts/markdown/wavedromRender.ts | verbatim | 35cf60f73ad55c64 | 35cf60f73ad55c64 |
| src/ts/outline/index.ts | verbatim | 2ed44ff8cbfb8470 | 2ed44ff8cbfb8470 |
| src/ts/preview/image.ts | modified | e7570976a5613ddc | f210127f2a9c2c34 |
| src/ts/preview/index.ts | modified | 50f4c73326b6a22f | 57f9137065db19cf |
| src/ts/resize/index.ts | verbatim | b6003fa8f1c7a012 | b6003fa8f1c7a012 |
| src/ts/sv/index.ts | verbatim | 550174d94149c3cd | 550174d94149c3cd |
| src/ts/sv/process.ts | verbatim | 07757009499308c0 | 07757009499308c0 |
| src/ts/sv/processKeydown.ts | verbatim | cf4ff9d34e8901c6 | cf4ff9d34e8901c6 |
| src/ts/tip/index.ts | modified | 0a6a823bce3baae8 | 8bb08e8f871c0734 |
| src/ts/toolbar/Both.ts | verbatim | f62ba38b9cb00fa6 | f62ba38b9cb00fa6 |
| src/ts/toolbar/Br.ts | verbatim | d4982f4166184498 | d4982f4166184498 |
| src/ts/toolbar/CodeTheme.ts | verbatim | 695409baad0756b0 | 695409baad0756b0 |
| src/ts/toolbar/ContentTheme.ts | verbatim | 56e440bd401805a6 | 56e440bd401805a6 |
| src/ts/toolbar/Counter.ts | verbatim | ccf8d4bd4a59f3ff | ccf8d4bd4a59f3ff |
| src/ts/toolbar/Custom.ts | verbatim | da93b271d47b158d | da93b271d47b158d |
| src/ts/toolbar/Devtools.ts | verbatim | 68a548823d71e917 | 68a548823d71e917 |
| src/ts/toolbar/Divider.ts | verbatim | cbb3045054b6636f | cbb3045054b6636f |
| src/ts/toolbar/EditMode.ts | modified | dcfb24af9f9f01e0 | 434d027af5bf164b |
| src/ts/toolbar/Emoji.ts | verbatim | 972cfe386351b662 | 972cfe386351b662 |
| src/ts/toolbar/Export.ts | verbatim | b88b728c4a020ca4 | b88b728c4a020ca4 |
| src/ts/toolbar/Fullscreen.ts | verbatim | 388f38b00c0b4c54 | 388f38b00c0b4c54 |
| src/ts/toolbar/Headings.ts | verbatim | 3620c865985640d2 | 3620c865985640d2 |
| src/ts/toolbar/Indent.ts | verbatim | 1818c31ef9d6a2fb | 1818c31ef9d6a2fb |
| src/ts/toolbar/InsertAfter.ts | verbatim | cb84ae6d8e8dcf55 | cb84ae6d8e8dcf55 |
| src/ts/toolbar/InsertBefore.ts | verbatim | 1841adaadfdb50aa | 1841adaadfdb50aa |
| src/ts/toolbar/MenuItem.ts | verbatim | 9c520a545df1d27a | 9c520a545df1d27a |
| src/ts/toolbar/Outdent.ts | verbatim | 601b9a1ee4b6c863 | 601b9a1ee4b6c863 |
| src/ts/toolbar/Outline.ts | verbatim | 7c17114983f2db15 | 7c17114983f2db15 |
| src/ts/toolbar/Preview.ts | verbatim | 228da212810315d7 | 228da212810315d7 |
| src/ts/toolbar/Record.ts | verbatim | 27a47a630f299185 | 27a47a630f299185 |
| src/ts/toolbar/Redo.ts | verbatim | ff0f0f85f81db93e | ff0f0f85f81db93e |
| src/ts/toolbar/Undo.ts | verbatim | 800341f30a18d804 | 800341f30a18d804 |
| src/ts/toolbar/Upload.ts | verbatim | 45627c95ced2fb9d | 45627c95ced2fb9d |
| src/ts/toolbar/index.ts | modified | 8937b4a39726e4aa | bd6a624310681f1a |
| src/ts/toolbar/setToolbar.ts | verbatim | c299ce3e3856b39a | c299ce3e3856b39a |
| src/ts/ui/initUI.ts | modified | 491cf30323ad8531 | b2070b7b054b2b07 |
| src/ts/ui/setCodeTheme.ts | verbatim | cb1b3f0604eb7896 | cb1b3f0604eb7896 |
| src/ts/ui/setContentTheme.ts | verbatim | e09593d22872a98c | e09593d22872a98c |
| src/ts/ui/setPreviewMode.ts | verbatim | 0cc62ee9471652a7 | 0cc62ee9471652a7 |
| src/ts/ui/setTheme.ts | verbatim | ae338a95061f2e3d | ae338a95061f2e3d |
| src/ts/undo/index.ts | modified | 5b164e623c352677 | 08615988c2794cc5 |
| src/ts/upload/getElement.ts | verbatim | 3ab89772dd249c64 | 3ab89772dd249c64 |
| src/ts/upload/index.ts | verbatim | c5cd5e9dde3ff955 | c5cd5e9dde3ff955 |
| src/ts/upload/setHeaders.ts | verbatim | 62450d175bbd650d | 62450d175bbd650d |
| src/ts/util/Options.ts | modified | ab3de4e69ee42401 | 3b20a12681b02f96 |
| src/ts/util/RecordMedia.ts | verbatim | b8e8821a3774f78f | b8e8821a3774f78f |
| src/ts/util/addScript.ts | modified | 2e8aed33d6c020df | e04b3207470577c9 |
| src/ts/util/addStyle.ts | verbatim | af0ce6a4c3714dfc | af0ce6a4c3714dfc |
| src/ts/util/code160to32.ts | modified | b5385dfad01bbdb2 | 5afcd6b41f713ff3 |
| src/ts/util/compatibility.ts | modified | 832922140a74eafa | db4ef0e556ccdd9d |
| src/ts/util/editorCommonEvent.ts | modified | e575cc99e50e7dbe | dba72b48f9bee60e |
| src/ts/util/fixBrowserBehavior.ts | modified | 3054e7a0fbd70f37 | 702e01bd264f1c22 |
| src/ts/util/function.ts | modified | 055e7278eb69adb3 | 841afe9d0bd9ee45 |
| src/ts/util/getSelectText.ts | verbatim | 5365d6188501d8a5 | 5365d6188501d8a5 |
| src/ts/util/hasClosest.ts | verbatim | 08ce69edee4e19f0 | 08ce69edee4e19f0 |
| src/ts/util/hasClosestByHeadings.ts | modified | 94321aea7b8be835 | 8474ea6982d822e0 |
| src/ts/util/highlightToolbar.ts | verbatim | 921193809cbb215e | 921193809cbb215e |
| src/ts/util/hotKey.ts | modified | 7fccc6c4c8218a87 | c6118efd204fc762 |
| src/ts/util/log.ts | verbatim | 7bad5b4c943a324d | 7bad5b4c943a324d |
| src/ts/util/merge.ts | verbatim | f267657cb56a1095 | f267657cb56a1095 |
| src/ts/util/processCode.ts | modified | 1cfda9545d6280ac | 328c2a27c560283c |
| src/ts/util/selection.ts | modified | f360097fe7954264 | 0cc730c9f4b2b932 |
| src/ts/util/toc.ts | modified | 9015d60a4b0fcae6 | 92284c7f847179f1 |
| src/ts/wysiwyg/afterRenderEvent.ts | verbatim | 8c5ba128da8bfab0 | 8c5ba128da8bfab0 |
| src/ts/wysiwyg/highlightToolbarWYSIWYG.ts | modified | 06d044403a74cb54 | 40bbc6a54325cddc |
| src/ts/wysiwyg/index.ts | modified | 91e7dee13df5de19 | 0c9bdffc63f5ca4d |
| src/ts/wysiwyg/inlineTag.ts | modified | 162c12bbca1b42e1 | 974ac0377ce207eb |
| src/ts/wysiwyg/input.ts | modified | 6a4f65d61a7ac96f | 4408ce9eb1631a90 |
| src/ts/wysiwyg/processKeydown.ts | modified | 3d7876f557b8e95c | a29abda775695492 |
| src/ts/wysiwyg/renderDomByMd.ts | verbatim | 9b0facca768b1110 | 9b0facca768b1110 |
| src/ts/wysiwyg/setHeading.ts | modified | ac1c23347d239bb9 | 176b72fff0e5e918 |
| src/ts/wysiwyg/showCode.ts | verbatim | 4ef19c2ed0683b6d | 4ef19c2ed0683b6d |
| src/ts/wysiwyg/toolbarEvent.ts | modified | 1985bfc511145418 | f6ba2edc2c53170d |
<!-- files:end -->
