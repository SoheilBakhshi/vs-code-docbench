// The only place where Docbench's content-policy matching rules live.
// Policy: docs/CONTENT-POLICY.md. Checker: scripts/content-policy/check.mjs.
//
// This file names the blocked terms on purpose, so it is itself listed under EXCEPTIONS below.

/**
 * Blocked terms. Each is matched case-insensitively in file names and in file text, including text that
 * is hidden behind escapes or encodings (see check.mjs). `\b` is not used because minified code and
 * file names join words with `_`, `-` and `.`; terms are chosen so that they do not occur inside
 * ordinary English words.
 */
export const TERMS = [
  // Chinese apps, social platforms, publishing and video sites, and their services.
  { id: 'wechat', category: 'app', pattern: 'wechat|weixin|mp-wechat' },
  { id: 'zhihu', category: 'app', pattern: 'zhihu' },
  { id: 'bilibili', category: 'app', pattern: 'bilibili' },
  { id: 'youku', category: 'app', pattern: 'youku' },
  { id: 'qq-video', category: 'app', pattern: 'v\\.qq\\.com|qq\\.com/' },
  { id: 'iqiyi', category: 'app', pattern: 'iqiyi' },
  { id: 'weibo', category: 'app', pattern: 'weibo' },
  { id: 'douyin', category: 'app', pattern: 'douyin|kuaishou|ixigua|toutiao' },
  { id: 'xiaohongshu', category: 'app', pattern: 'xiaohongshu' },
  { id: 'baidu', category: 'app', pattern: 'baidu' },
  { id: 'alipay', category: 'app', pattern: 'alipay|taobao|alibaba|aliyun' },
  { id: 'tencent', category: 'app', pattern: 'tencent' },
  { id: 'dingtalk', category: 'app', pattern: 'dingtalk|feishu' },
  { id: 'cn-dev-sites', category: 'app', pattern: 'csdn\\.|juejin|jianshu|gitee\\.' },
  // The upstream Markdown editor's own product family and community sites.
  { id: 'b3log', category: 'branding', pattern: 'b3log' },
  { id: 'ld246', category: 'branding', pattern: 'ld246' },
  { id: 'hacpai', category: 'branding', pattern: 'hacpai' },
  { id: 'liandi', category: 'branding', pattern: 'liandi' },
  { id: 'siyuan', category: 'branding', pattern: 'siyuan|liuyun' },
  { id: 'huaji', category: 'branding', pattern: 'huaji' },
  // Chinese, Japanese and Korean font families.
  {
    id: 'cjk-font',
    category: 'font',
    pattern: [
      'pingfang', 'hiragino', 'yahei', 'jhenghei', 'simsun', 'simhei', 'nsimsun', 'stheiti', 'stsong', 'stkaiti',
      'heiti', 'songti', 'kaiti', 'fangsong', 'mingliu', 'dfkai', 'wenquanyi', 'noto (?:sans|serif) cjk',
      'source han (?:sans|serif)', 'ms gothic', 'ms mincho', 'ms pgothic', 'ms pmincho', 'meiryo',
      'yu gothic', 'yu mincho', 'malgun', 'nanum', 'gulim', 'dotum', 'batang', 'apple sd gothic',
    ].join('|'),
  },
  // Interface localisations other than English.
  { id: 'cjk-locale', category: 'locale', pattern: 'zh[_-](?:cn|tw|hk|hans|hant)|ja[_-]jp|ko[_-]kr' },
];

/**
 * Chinese, Japanese and Korean characters: CJK radicals, punctuation, kana, bopomofo, Hangul, ideographs,
 * compatibility forms and full-width forms. Used to find interface strings, emoji names and demo text.
 */
export const CJK_CLASS =
  '\\u1100-\\u11ff\\u2e80-\\u2fdf\\u3000-\\u303f\\u3040-\\u30ff\\u3100-\\u31ff\\u3400-\\u4dbf\\u4e00-\\u9fff' +
  '\\ua960-\\ua97f\\uac00-\\ud7ff\\uf900-\\ufaff\\ufe30-\\ufe4f\\uff00-\\uffef';
export const CJK = new RegExp(`[${CJK_CLASS}]`, 'u');

/** File types whose content is scanned as text. Everything else is checked by name only. */
export const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json', '.css', '.less', '.html', '.htm', '.svg', '.md',
  '.markdown', '.txt', '.yml', '.yaml', '.xml', '.http', '.rest', '.csv', '.tsv', '.map', '.vsixmanifest',
  '',
]);

/** A Vditor runtime file: its path in the fork and its path inside the packaged extension. */
const vditorRuntime = (rel) => [`vendor/vditor/dist/${rel}`, `extension/media/markdown/vditor/dist/${rel}`];

/**
 * Allowed matches. Every entry names exact files (repository paths and/or paths inside the VSIX),
 * exact rule ids and the exact number of matches, with the reason they must stay. A count that changes
 * (for example after a dependency update) fails the check until the entry is reviewed and updated.
 * Directory-wide exceptions are not allowed.
 *
 * `cjk` counts characters written literally; `cjk-escaped` counts characters hidden behind \u, \x
 * (UTF-8 bytes), %XX, &#x; or base64 encodings. Character ranges such as `ぁ-ゖ` in regular
 * expressions are not counted: they describe Unicode support, not content.
 */
export const EXCEPTIONS = [
  // --- The policy and its own checks name what they block. ---
  {
    files: ['scripts/content-policy/rules.mjs'],
    reason: 'Security check: the single list of blocked terms and character classes.',
    allow: '*',
  },
  {
    files: ['docs/CONTENT-POLICY.md'],
    reason: 'The policy names the unwanted integrations, fonts and asset categories it forbids.',
    allow: '*',
  },
  {
    files: ['test/content-policy.test.mjs'],
    reason: 'Regression test: feeds blocked terms and encodings to the checker to prove they are caught.',
    allow: '*',
  },
  {
    files: ['vendor/vditor/PROVENANCE.md'],
    reason: 'Modification record of the Vditor fork: names each removed item by its rule id and the IME character it keeps.',
    allow: { cjk: 1, wechat: 1, zhihu: 1, bilibili: 1, youku: 1, b3log: 3, ld246: 1, hacpai: 2, liandi: 1, siyuan: 2, huaji: 1 },
  },
  {
    files: ['test/fixtures/cjk-samples.mjs'],
    reason:
      'Test data (never shipped): Chinese, Japanese and Korean user-document text for the rendering checks, their ' +
      'lang tags, the IME character, and one removed product emoji name to prove it stays plain text.',
    allow: { cjk: 520, 'cjk-locale': 3, siyuan: 2 },
  },
  {
    files: ['scripts/content-policy/check.mjs'],
    reason: 'Security check: comments show the escaped and regex-escaped forms that the decoder handles.',
    allow: { 'cjk-escaped': 2, 'qq-video': 1 },
  },
  // --- Functional support for editing Asian-language documents. ---
  {
    files: ['vendor/vditor/src/ts/ir/index.ts', 'vendor/vditor/src/ts/wysiwyg/index.ts'],
    reason:
      'Input-method guard: while a Chinese IME inserts the paired punctuation "《", the editor must not reprocess the line.',
    allow: { cjk: 1 },
  },
  {
    files: vditorRuntime('js/lute/lute.min.js'),
    reason:
      'Lute Markdown engine. cjk-escaped: full-width punctuation and ideographic spaces used when parsing and ' +
      'rendering CJK text, two standard Unicode emoji, and a disabled paragraph-indent option. weibo, baidu, alipay: ' +
      'entries of the IANA top-level domain list used to recognise URLs (one each: WEIBO, BAIDU, ALIBABA, ALIPAY, TAOBAO).',
    allow: { 'cjk-escaped': 21, weibo: 1, baidu: 1, alipay: 3 },
  },
  {
    files: vditorRuntime('js/mermaid/mermaid.min.js'),
    reason: 'Mermaid (verbatim): Unicode letter and whitespace classes in its parsers and text measurement.',
    allow: { 'cjk-escaped': 13 },
  },
  {
    files: vditorRuntime('js/highlight.js/highlight.min.js'),
    reason: 'highlight.js (verbatim): Unicode identifier classes used to tokenise source code.',
    allow: { 'cjk-escaped': 5 },
  },
  {
    files: vditorRuntime('js/katex/katex.min.js'),
    reason: 'KaTeX (verbatim): Unicode range in its lexer so that maths can contain CJK text.',
    allow: { 'cjk-escaped': 2 },
  },
  // --- Built bundles in the package (sources are covered above or are npm dependencies). ---
  {
    files: ['extension/media/markdown/index.js'],
    reason:
      'Markdown editor bundle. cjk-escaped: the Vditor IME guard (2) and, from the docx library (Export to Word), ' +
      'the standard Office theme table that maps Japanese, Korean, Simplified and Traditional Chinese text to fonts ' +
      'in exported .docx files (20). cjk-font: the same table\'s font for Bopomofo text.',
    allow: { 'cjk-escaped': 22, 'cjk-font': 1 },
  },
  {
    files: ['extension/media/markdown/index.css'],
    reason: 'Vditor stylesheet with its MIT licence banner, kept by esbuild as a legal comment.',
    allow: { b3log: 2, cjk: 2 },
  },
  {
    files: ['extension/media/spreadsheet/index.js'],
    reason:
      'SheetJS: Chinese and Japanese date/time format tokens, element names of the UOF spreadsheet format, localised ' +
      'sheet-list names it parses, and the Office theme font table it writes into saved workbooks.',
    allow: { 'cjk-escaped': 123 },
  },
  {
    files: ['extension/media/xlsx-editor/index.js'],
    reason: 'SheetJS as in the spreadsheet viewer (123), plus the editor\'s currency format showing the yuan sign (2).',
    allow: { 'cjk-escaped': 125 },
  },
  {
    files: ['extension/media/pdf/pdf.worker.min.mjs'],
    reason:
      'pdf.js: substitution table that maps CJK font names referenced (but not embedded) by a PDF to fallback ' +
      'fonts, so Chinese, Japanese and Korean PDFs render.',
    allow: { 'cjk-font': 89 },
  },
  // --- Required licence texts and copyright notices (kept verbatim). ---
  {
    files: [...vditorRuntime('css/content-theme/light.css'), ...vditorRuntime('css/content-theme/dark.css')],
    reason: 'Vditor MIT licence banner, kept verbatim at the top of the file (copyright holder in its original form).',
    allow: { b3log: 2, cjk: 2 },
  },
  {
    files: ['vendor/vditor/dist/index.css'],
    reason: 'Vditor MIT licence banner, which upstream repeats twice at the top of the file (kept verbatim).',
    allow: { b3log: 6, cjk: 4 },
  },
  {
    files: ['vendor/vditor/LICENSE'],
    reason: 'Vditor MIT licence. The copyright line names the copyright holder in its original form.',
    allow: { b3log: 2, cjk: 2 },
  },
  {
    files: ['scripts/licenses/lute-LICENSE.txt'],
    reason: 'Mulan PSL v2 licence of the Lute engine; the Chinese and English texts are both part of the licence.',
    allow: { cjk: 1096 },
  },
  {
    files: ['THIRD-PARTY-NOTICES.md', 'extension/THIRD-PARTY-NOTICES.md'],
    reason: 'Reproduces the licences above (Vditor copyright holder, Mulan PSL v2 in Chinese and English).',
    allow: { b3log: 2, cjk: 1098 },
  },
];

/** Files that only exist to test the checker and must never ship. */
export const TEST_ONLY = ['test/'];
