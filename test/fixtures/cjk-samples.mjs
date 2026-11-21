// All Chinese / Japanese / Korean sample text used by the feature tests lives in this one file.
// Other files under test/ import these constants and contain no CJK characters themselves.
//
// The samples deliberately mix scripts with Latin letters and digits, use full-width punctuation, an
// ideographic space (U+3000) and a character outside the Basic Multilingual Plane (a surrogate pair),
// because those are the cases a text pipeline most often damages.

/** Ideographic (full-width) space. */
export const IDEOGRAPHIC_SPACE = '　';

export const HANS_HEADING = '简体中文标题';
export const HANT_HEADING = '繁體中文標題';
export const JA_HEADING = '日本語の見出し';
export const KO_HEADING = '한국어 제목';

export const HANS_PARAGRAPH = '这是一个测试文档，包含中英文混排English与数字2024。';
export const HANT_PARAGRAPH = '這是一個測試文件，「引號」與全形標點：！？';
export const JA_PARAGRAPH = 'ひらがなとカタカナと漢字：日本語のテスト文書です。魚の𩸽（ほっけ）。';
export const KO_PARAGRAPH = '한국어 테스트 문서입니다. 안녕하세요!';
export const SPACE_PARAGRAPH = `全角${IDEOGRAPHIC_SPACE}空格${IDEOGRAPHIC_SPACE}テスト`;
/** A paragraph indented with two ideographic spaces, as is common in Chinese prose. */
export const INDENTED_PARAGRAPH = `${IDEOGRAPHIC_SPACE}${IDEOGRAPHIC_SPACE}首行缩进的段落。`;

export const BOLD_TEXT = '粗体文字';
export const ITALIC_TEXT = '斜體文字';
export const STRIKE_TEXT = '取り消し線';

export const TABLE_HEADER = ['语言', '示例'];
export const TABLE_ROWS = [
  ['简体', '汉字'],
  ['繁體', '漢字'],
  ['日本語', 'かな'],
  ['한국어', '한글'],
];

export const TASK_OPEN = '待办事项';
export const TASK_DONE = '完了したタスク';

export const IMAGE_ALT = '图片说明画像이미지';

export const MERMAID_LABELS = ['开始', '処理', '완료'];

export const MATH_TEXT = '中文';
export const INLINE_MATH_PREFIX = '行内公式';

export const CODE_COMMENT = '注释コメント주석';
export const CODE_STRING = '你好，世界';

/** Text typed into the editor during the edit test. */
export const TYPED_TEXT = '追加テキスト추가';

/** Every visible CJK string of the Markdown document, as it must appear in the rendered editor. */
export const MARKDOWN_VISIBLE = [
  HANS_HEADING,
  HANT_HEADING,
  JA_HEADING,
  KO_HEADING,
  HANS_PARAGRAPH,
  HANT_PARAGRAPH,
  JA_PARAGRAPH,
  KO_PARAGRAPH,
  SPACE_PARAGRAPH,
  INDENTED_PARAGRAPH,
  BOLD_TEXT,
  ITALIC_TEXT,
  STRIKE_TEXT,
  ...TABLE_HEADER,
  ...TABLE_ROWS.flat(),
  TASK_OPEN,
  TASK_DONE,
];

/**
 * The Markdown document. It is written in the form the editor's engine serialises to, so an unedited
 * round trip can be compared byte for byte.
 */
export const MARKDOWN_DOC = `# ${HANS_HEADING}

## ${HANT_HEADING}

### ${JA_HEADING}

#### ${KO_HEADING}

Plain English paragraph.

${HANS_PARAGRAPH}

${HANT_PARAGRAPH}

${JA_PARAGRAPH}

${KO_PARAGRAPH}

${SPACE_PARAGRAPH}

${INDENTED_PARAGRAPH}

Emphasis: **${BOLD_TEXT}**, *${ITALIC_TEXT}* and ~~${STRIKE_TEXT}~~.

| ${TABLE_HEADER[0]}   | ${TABLE_HEADER[1]} |
| ------ | ---- |
${TABLE_ROWS.map((r) => `| ${r[0].padEnd(r[0].length === 2 ? 4 : 3)} | ${r[1]} |`).join('\n')}

* [ ] ${TASK_OPEN}
* [X] ${TASK_DONE}

![${IMAGE_ALT}](image.png)

\`\`\`mermaid
flowchart LR
  A[${MERMAID_LABELS[0]}] --> B[${MERMAID_LABELS[1]}]
  B --> C[${MERMAID_LABELS[2]}]
\`\`\`

${INLINE_MATH_PREFIX} $a^2 + b^2 = c^2$ end.

$$
\\text{${MATH_TEXT}} + \\ce{H2O}
$$

\`\`\`js
// ${CODE_COMMENT}
const greeting = "${CODE_STRING}";
console.log(greeting);
\`\`\`
`;

// --- PDF -------------------------------------------------------------------------------------------

/** Lines of the generated PDF (one per paragraph); page 2 holds the last one. */
export const PDF_PAGE1 = [
  'Docbench PDF sample, Latin text 123.',
  '简体中文：你好，世界。',
  '繁體中文：歡迎使用。',
  '日本語：こんにちは、カタカナ。',
  '한국어: 안녕하세요.',
];
export const PDF_PAGE2 = ['第二页：结束。'];
/** BCP 47 tags so the browser picks a matching installed font for each line. */
export const PDF_LANGS = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'];

// --- Word ------------------------------------------------------------------------------------------

export const DOCX_TITLE = '文档标题';
export const DOCX_PARAGRAPHS = [
  '第一段：简体中文段落。',
  '第二段：繁體中文段落。',
  '第三段落：日本語の文章です。',
  '네 번째 단락: 한국어 문장.',
];
/** Run with an explicit East Asian font (rFonts w:eastAsia). */
export const DOCX_EAST_ASIA_RUN = '东亚字体文字';
/** East Asian font name for that run; a generic family installed on the test machine. */
export const DOCX_EAST_ASIA_FONT = 'IPAGothic';
export const DOCX_TABLE = [
  ['名前', '数量'],
  ['りんご', '三'],
  ['사과', '다섯'],
];

// --- Spreadsheets ----------------------------------------------------------------------------------

export const XLSX_SHEETS = ['销售数据', '日本語シート', '한국어시트'];
export const XLSX_DATA = {
  [XLSX_SHEETS[0]]: [
    ['产品', '数量', '备注'],
    ['苹果', 10, '红色'],
    ['香蕉', 20, '黄色'],
  ],
  [XLSX_SHEETS[1]]: [
    ['品名', '値'],
    ['みかん', 5],
  ],
  [XLSX_SHEETS[2]]: [
    ['이름', '값'],
    ['배', 7],
  ],
};
export const CSV_TEXT = '城市,人口,説明\n北京,2189,首都\n東京,1396,首都\n서울,950,수도\n';
export const CSV_CELLS = ['城市', '人口', '説明', '北京', '首都', '東京', '서울', '수도'];

/** Chart title (optional chart test). */
export const CHART_TITLE = '销量图表';

/** New cell text typed in the spreadsheet editor. */
export const XLSX_NEW_CELL = '新しい値새값';

// --- HTML ------------------------------------------------------------------------------------------

export const HTML_HEADING = '网页标题';
export const HTML_PARAGRAPHS = ['中文段落内容。', '日本語の段落です。', '한국어 단락입니다.'];
/** Written into the page by its own inline script (scripts run in a trusted workspace). */
export const HTML_SCRIPT_TEXT = '脚本生成的文字スクリプト스크립트';
export const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${HTML_HEADING}</title></head>
<body>
<h1 id="title">${HTML_HEADING}</h1>
${HTML_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n')}
<p id="scripted"></p>
<script>document.getElementById('scripted').textContent = '${HTML_SCRIPT_TEXT}';</script>
</body>
</html>
`;

// --- HTTP ------------------------------------------------------------------------------------------

export const HTTP_COMMENT = '中文注释';
export const HTTP_REQUEST_NAME = '日本語リクエスト';
export const HTTP_HEADER_VALUE = '한국어값';
export const HTTP_VAR_VALUE = '变量值';
export const HTTP_BODY_TEXT = '请求正文：こんにちは、안녕';
export const HTTP_PASSWORD = '密码パスワード';
export const HTTP_RESPONSE_TEXT = '响应内容：ありがとう、감사합니다';

/** A .http file; `{{base}}` is the local test server address, substituted by the test. */
export const HTTP_FILE = `# ${HTTP_COMMENT}
@label = ${HTTP_VAR_VALUE}

### ${HTTP_REQUEST_NAME}
// ${HTTP_COMMENT}
POST {{base}}/echo?q={{label}}
Content-Type: application/json; charset=utf-8
X-Note: ${HTTP_HEADER_VALUE}
# ${HTTP_COMMENT}
X-Label: {{label}}

{"text": "${HTTP_BODY_TEXT}", "label": "{{label}}"}

###
GET {{base}}/second
`;

// --- Samples for test/vditor-fork.test.mjs (Lute engine, undo history, input-method guard). ---
export const FORK_SAMPLES = {
  // Paired punctuation a Chinese IME inserts; the editor must not reprocess the line meanwhile.
  imeGuard: '《',
  // A product image emoji removed from the fork's Lute engine: it must stay plain text.
  removedEmoji: ':siyuan:',
  before: `${HANS_PARAGRAPH}\n${JA_PARAGRAPH}\n`,
  after: `${HANS_PARAGRAPH}\n${TYPED_TEXT}${JA_PARAGRAPH}\n${KO_PARAGRAPH}\n`,
  markdown: `# ${HANS_HEADING} ${JA_HEADING} ${KO_HEADING}\n\n${SPACE_PARAGRAPH}\n\n${HANT_PARAGRAPH}\n\n:smile: :siyuan:\n`,
  mustRender: [HANS_HEADING, JA_HEADING, KO_HEADING, SPACE_PARAGRAPH, HANT_PARAGRAPH],
  roundTrip: `# ${HANS_HEADING}\n\n${SPACE_PARAGRAPH}\n\n${JA_PARAGRAPH}\n\n- ${KO_PARAGRAPH}\n`,
};
