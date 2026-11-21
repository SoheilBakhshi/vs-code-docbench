// Regression tests for the content-policy checker (docs/CONTENT-POLICY.md).
// This file feeds blocked terms and encodings to the checker on purpose; rules.mjs lists it as an exception.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { judge, scanText } from '../scripts/content-policy/check.mjs';
import { EXCEPTIONS, TERMS } from '../scripts/content-policy/rules.mjs';

const scan = (text, name = 'sample.js') => scanText(name, text);

test('every blocked term is found in plain text, case-insensitively', () => {
  const samples = {
    wechat: 'Share to WeChat', zhihu: 'zhihu.com', bilibili: 'BILIBILI', youku: 'v.youku.com', 'qq-video': 'https://v.qq.com/x',
    iqiyi: 'iqiyi', weibo: 'Weibo', douyin: 'douyin', xiaohongshu: 'xiaohongshu', baidu: 'baidu', alipay: 'Alipay',
    tencent: 'Tencent', dingtalk: 'DingTalk', 'cn-dev-sites': 'gitee.com', b3log: 'b3log.org', ld246: 'ld246.com',
    hacpai: 'HacPai', liandi: 'liandi', siyuan: 'SiYuan', huaji: 'huaji.gif', 'cjk-font': 'font-family: "Microsoft YaHei"',
    'cjk-locale': 'lang: "zh_CN"',
  };
  assert.deepEqual(Object.keys(samples).sort(), TERMS.map((t) => t.id).sort(), 'one sample per rule');
  for (const [id, text] of Object.entries(samples)) {
    assert.ok(scan(text)[id] >= 1, `${id} not found in ${JSON.stringify(text)}`);
  }
});

test('terms are found in file names', () => {
  assert.equal(scan(undefined, 'dist/js/i18n/zh_CN.js')['name:cjk-locale'], 1);
  assert.equal(scan(undefined, 'images/emoji/siyuan.png')['name:siyuan'], 1);
  assert.deepEqual(scan(undefined, 'media/pdf/cmaps/UniJIS-UTF16-H.bcmap'), {});
});

test('terms hidden behind escapes and encodings are found', () => {
  assert.equal(scan('"w\\u0065chat"').wechat, 1, '\\u escape');
  assert.equal(scan('/v\\.qq\\.com/')['qq-video'], 1, 'regex-escaped dots');
  assert.equal(scan('"\\x7a\\x68\\x69\\x68\\x75"').zhihu, 1, '\\x bytes');
  assert.equal(scan('%62%69%6c%69%62%69%6c%69').bilibili, 1, 'URL encoding');
  assert.equal(scan('&#x79;ouku').youku, 1, 'HTML character reference');
  const b64 = Buffer.from('<svg><title>icon for hacpai, padded to be long enough</title></svg>').toString('base64');
  assert.equal(scan(`url(data:image/svg+xml;base64,${b64})`).hacpai, 1, 'base64');
});

test('CJK characters are counted literally and behind every supported encoding', () => {
  const one = String.fromCodePoint(0x4e2d);
  assert.equal(scan(`"${one}"`).cjk, 1, 'literal');
  assert.equal(scan('"\\u4e2d\\u6587"')['cjk-escaped'], 2, '\\uXXXX');
  assert.equal(scan('"\\\\u4e2d"')['cjk-escaped'], 1, 'double-escaped \\uXXXX');
  assert.equal(scan('"\\u{4E2D}"')['cjk-escaped'], 1, '\\u{...}');
  assert.equal(scan('"\\xE4\\xB8\\xAD"')['cjk-escaped'], 1, 'UTF-8 bytes');
  assert.equal(scan('%E4%B8%AD')['cjk-escaped'], 1, 'URL encoding');
  assert.equal(scan('&#x4E2D;&#20013;')['cjk-escaped'], 2, 'character references');
  const b64 = Buffer.from(`<svg><text>${one}${one}</text> some padding text for length</svg>`).toString('base64');
  assert.equal(scan(b64)['cjk-escaped'], 2, 'base64');
  assert.equal(scan('"\\u3042"')['cjk-escaped'], 1, 'kana');
  assert.equal(scan('"\\uD55C"')['cjk-escaped'], 1, 'Hangul');
  assert.equal(scan('"\\uFF01"')['cjk-escaped'], 1, 'full-width form');
});

test('Unicode ranges in character classes are not content', () => {
  assert.deepEqual(scan('/[\\u3041-\\u3096\\u4e00-\\u9fff]/'), {});
  const lo = String.fromCodePoint(0x3041);
  const hi = String.fromCodePoint(0x3096);
  assert.deepEqual(scan(`/[${lo}-${hi}]/`), {});
  assert.deepEqual(scan('Plain English text with "straight quotes" and a hyphen-joined word.'), {});
});

test('exceptions must match their exact counts', () => {
  const entry = EXCEPTIONS.find((e) => e.files.includes('vendor/vditor/LICENSE'));
  const path = entry.files[0];
  assert.deepEqual(judge(path, { ...entry.allow }).failures, []);
  assert.equal(judge(path, { ...entry.allow, b3log: entry.allow.b3log + 1 }).failures.length, 1, 'more than allowed');
  assert.equal(judge(path, { ...entry.allow, b3log: entry.allow.b3log - 1 }).failures.length, 1, 'stale exception');
  assert.equal(judge(path, { ...entry.allow, wechat: 1 }).failures.length, 1, 'rule not covered');
  assert.equal(judge('src/other.ts', { cjk: 1 }).failures.length, 1, 'file without exception');
});

test('exceptions name exact files only and give a reason', () => {
  for (const e of EXCEPTIONS) {
    assert.ok(e.reason && e.reason.length > 20, `reason for ${e.files}`);
    for (const f of e.files) {
      assert.doesNotMatch(f, /[*?]|\/$/, `exception must name a file, not a pattern or folder: ${f}`);
    }
    if (e.allow === '*') {
      assert.ok(e.files.every((f) => /^(scripts\/content-policy\/rules\.mjs|docs\/CONTENT-POLICY\.md|test\/content-policy\.test\.mjs)$/.test(f)),
        `blanket exceptions are only for the policy, its rules and this test: ${e.files}`);
    }
  }
});

test('the maintained tree passes the content policy', () => {
  const out = execFileSync(process.execPath, ['scripts/content-policy/check.mjs', 'tree'], { encoding: 'utf8' });
  assert.match(out, /content policy: OK/);
});
