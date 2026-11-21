# Content policy

This is the single authoritative policy for what Docbench's maintained source, its dependencies and its
distributed package may contain. Contributor and coding-agent instructions link here. The exact
matching rules and every allowed exception live in one file, `scripts/content-policy/rules.mjs`.

## 1. Rule

Docbench does not contain references to Chinese apps, social platforms, publishing or video services and
their branding, Chinese or other Asian font declarations, or unused Asian-language content and assets.
This is a product choice. It applies to:

- the maintained source: code, comments, documentation, screenshots, sample data, configuration, build
  tools, generated files kept in Git, and release material;
- dependencies: anything Docbench builds from, including forks kept in this repository;
- the distributed package: every file inside the `.vsix`.

Removing material only while packaging is not enough. The maintained source must be clean too.

## 2. What is not allowed

1. **Apps, social platforms and services**: WeChat (Weixin, its official-account platform), Zhihu, Bilibili,
   Youku, QQ video, iQIYI, Weibo, Douyin, Kuaishou, Xigua, Toutiao, Xiaohongshu, Baidu, Alipay, Taobao,
   Alibaba and Aliyun, Tencent, DingTalk, Feishu, CSDN, Juejin, Jianshu and Gitee, including their
   embeds, share or copy buttons, players, logins, APIs and addresses.
2. **Branding and community sites of upstream products** that Docbench does not use: B3log, LD246,
   HacPai, Liandi, SiYuan (and its asset hosts), and product logo emoji such as Huaji.
3. **Font declarations** naming Chinese, Japanese or Korean font families (for example PingFang, Hiragino,
   Microsoft YaHei, JhengHei, SimSun, SimHei, Heiti, Songti, Kaiti, FangSong, MingLiU, WenQuanYi,
   Noto Sans/Serif CJK, Source Han, MS Gothic, MS Mincho, Meiryo, Yu Gothic, Malgun Gothic, Nanum, Gulim,
   Dotum, Batang). Docbench's own CSS uses the VS Code fonts or generic families.
4. **Unused Asian-language content**: interface translations and locale files (`zh_CN`, `zh_TW`, `ja_JP`,
   `ko_KR` and similar), interface strings, developer comments, emoji packs, icons, demo or sample
   content, screenshots and README files written for those products or languages.
5. **Unused assets of any kind** pulled in with such content (images, themes, icon sets, players).

## 3. What must stay

1. **Licences, copyright notices, attribution and provenance**, verbatim, including original names and
   original-language text when the licence requires it (for example the Vditor copyright line, and the
   Mulan PSL v2 licence of Lute in Chinese and English). Modifications of third-party components are
   recorded accurately (`vendor/vditor/PROVENANCE.md`, `THIRD-PARTY-NOTICES.md`).
2. **Unicode support.** Users can open, edit and render documents in any language, including Chinese,
   Japanese and Korean. Character classes and ranges in parsers, input-method handling and CJK-aware
   punctuation or spacing logic are functional code, not content.
3. **Functional decoding resources** needed for supported documents, for example pdf.js character maps and
   its font substitution table for PDFs that reference but do not embed CJK fonts, SheetJS number-format and
   file-format tokens, and the standard Office theme font table written into exported `.docx`/`.xlsx` files.
4. **Functioning code is not removed because of where a component comes from.** Only unwanted content,
   integrations, fonts and unused assets are removed.

## 4. Allowed matches (exceptions)

Some files must contain blocked terms or characters: the rules and their tests, this policy, required
notices, and functional resources from section 3. Each exception in `scripts/content-policy/rules.mjs`:

- names exact files (repository path and, where it ships, the path inside the `.vsix`), never a directory;
- names exact rule ids with the exact number of matches, so any change fails the check until reviewed;
- states why the match must stay.

Do not remove or alter a required notice to get a clean scan, and do not raise a count without checking
what the new matches are.

## 5. Dependencies

- Before adding or updating a dependency, run `node scripts/content-policy/check.mjs dir node_modules/<pkg>`
  on it and review what it contains and what of it ships (`npm run package`, then the package checks).
- A dependency whose **shipped** files contain unwanted material is replaced by a cleaned, traceable version
  (a minimal fork in `vendor/` with a provenance file listing upstream version, hashes and every change),
  or the material is removed upstream. Excluding files from the `.vsix` does not make a dependency clean.
- Material that stays inside an installed package but is never built into or copied to the package is
  recorded in section 7 below. It must not be imported, copied or referenced.
- SheetJS is not forked (a project rule); its matches are functional (section 3).

## 6. Checks (mandatory before merging and before releasing)

| Command | What it checks |
|---|---|
| `npm run check:content` | Every file Git tracks or would track: names and text, including `\u`, `\u{}`, `\x` UTF-8 bytes, `%XX`, HTML character references and base64 runs, against `rules.mjs`. |
| `npm test` | Checker regression tests, the Vditor fork's provenance hashes and clean-up, and the feature tests with Chinese, Japanese and Korean documents. |
| `npm run check:release` | Builds the `.vsix`, scans every file inside it with the same rules, and checks that every packaged file has a stated purpose, that no private, source, map or backup file is included, and that packaged files are byte-identical to the build and to `vendor/vditor`. |

The release workflow runs these checks and stops publication when any fails.

## 7. Inventory (release 0.6.5)

Measured with `scripts/content-policy/check.mjs`. Removed from the maintained source and the package:

| Where | Removed |
|---|---|
| Vditor (now `vendor/vditor`, see its PROVENANCE.md) | 527 developer comments in Chinese (3,206 characters); 11 non-English interface languages from the accepted list and types; 2 copy-to-publishing-site buttons with their icons, clipboard variants and Chinese tip texts; the help dialog (7 links to the upstream community site) and the info dialog (product site and sponsor links); 34 further links to that community site in error messages (4) and type comments (30); 8 video-site embeds (3 of them the Chinese video sites above); the default script CDN and remote PlantUML rendering; 2 Chinese font names in 3 font stacks; Chinese fallback text of the code copy button; Chinese README, locale files, emoji images, extra themes and the second icon set (not copied into the fork). |
| Lute engine (`vendor/vditor/dist/js/lute/lute.min.js`) | 17 product-logo image emoji and 2 special cases; a link-base rule for an outside app's asset hosts; 2 product names in the term dictionary; a label rewrite for pasted articles from a publishing platform. |
| `esbuild.mjs` | All rewrite rules, the broad CJK character-range deletion and the after-build check that depended on them (the build now copies the clean fork as it is). |
| Notices | Corrected: the fork, its changes and Lute's modification are described; Mermaid, KaTeX, Ant Design icons and diff-match-patch licences added. |

Kept, and listed as exceptions with exact counts in `rules.mjs`: required notices (Vditor licence and
banners, Mulan PSL v2), the input-method guard for `"《"`, Lute's CJK punctuation handling and the IANA
top-level domain list, Unicode classes in Mermaid, KaTeX and highlight.js, the pdf.js font substitution
table, SheetJS tokens and the Office theme font table (also written by the `docx` library).

Installed but never built into or copied to the package (accounted for, not shipped): `x-data-spreadsheet`
Chinese locale files and demo page; `pdfjs-dist` viewer files (`web/`) and unused worker variants;
`docx` sub-bundles (`layout`, `shapes`, `bibliography`, `macros`, `html`) and its type comments; SheetJS
codepage tables (`cpexcel`) and other prebuilt variants. The package checks prove none of them ships.
