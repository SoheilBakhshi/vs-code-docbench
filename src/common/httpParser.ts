// Pure parser for `.http` / `.rest` files (no vscode import, so it can be unit-tested in plain Node).
//
// Supported syntax (a lightweight subset of the common .http file conventions):
//
//   ### Optional request name        <- lines starting with '###' separate requests; trailing text is the name
//   # comment   // comment           <- comment lines are ignored before the request line and between headers
//   # @name myRequest                <- alternative way to name a request
//   @host = localhost:3000           <- file variable; may appear anywhere BEFORE the request that uses it
//   POST https://{{host}}/api?x=1    <- request line: METHOD URL [HTTP/1.1]; a bare URL means GET
//       &y=2                         <- continuation lines starting with '?' or '&' are appended to the URL
//   Content-Type: application/json   <- header lines 'Name: value' up to the first blank line
//                                    <- blank line
//   {"hello": "{{$guid}}"}           <- everything else is the body (trailing blank lines trimmed)
//
// Variables: {{name}} (file variables, may reference each other), {{$guid}}, {{$timestamp}} (epoch seconds),
// {{$randomInt min max}} and {{$processEnv NAME}} (only when the host provides environment access; otherwise
// left unresolved). `Authorization: Basic user:pass` / `Basic user pass` is converted to base64.
// Not supported: `< ./file` body includes, multipart helpers, request chaining, prompt variables.

export type HttpHeader = [name: string, value: string];

export interface HttpRequest {
  /** Optional name from the '###' line or a '# @name x' comment. */
  name?: string;
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
  /** 0-based line of the request line in the document. */
  line: number;
}

export interface FindResult {
  request?: HttpRequest;
  /** File variables visible to the request (declared before it in the document). */
  vars: Record<string, string>;
  error?: string;
}

export interface SubstitutionContext {
  /** Returns an environment variable, or undefined (desktop only). Without it `$processEnv` stays unresolved. */
  processEnv?: (name: string) => string | undefined;
  /** Random number in [0, 1); defaults to Math.random. */
  random?: () => number;
  /** Current time in ms; defaults to Date.now. */
  now?: () => number;
  /** UUID v4 generator; defaults to crypto.randomUUID with a fallback. */
  guid?: () => string;
}

export interface ResolvedRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
  /** Names of `{{...}}` placeholders that could not be resolved (left verbatim in the text). */
  unresolved: string[];
}

/** What the host sends to the response webview. */
export interface HttpResponseView {
  kind: 'response' | 'error';
  request: { method: string; url: string };
  durationMs: number;
  /** Error message (kind === 'error'). */
  message?: string;
  status?: number;
  statusText?: string;
  headers?: HttpHeader[];
  contentType?: string;
  /** Number of body bytes received. */
  sizeBytes?: number;
  /** True when the body was cut at the size limit. */
  truncated?: boolean;
  /** Decoded (and pretty-printed JSON) body text. */
  bodyText?: string;
  /** data: URL when the response is an image. */
  imageDataUrl?: string;
  /** Shown instead of bodyText for non-textual content. */
  note?: string;
}

interface Segment {
  startLine: number;
  /** Document line of lines[0]. */
  firstLine: number;
  endLine: number;
  name?: string;
  lines: string[];
}

interface ParsedBlock {
  vars: [name: string, value: string][];
  request?: HttpRequest;
}

const HEADER_RE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*)$/;
const VAR_RE = /^@([^\s=]+)\s*=\s*(.*)$/;
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function isComment(trimmed: string): boolean {
  return trimmed.startsWith('#') || trimmed.startsWith('//');
}

function splitSegments(text: string): Segment[] {
  const lines = text.split(/\r?\n/);
  const segments: Segment[] = [];
  let cur: Segment = { startLine: 0, firstLine: 0, endLine: 0, lines: [] };
  lines.forEach((line, i) => {
    if (line.startsWith('###')) {
      cur.endLine = i - 1;
      segments.push(cur);
      cur = { startLine: i, firstLine: i + 1, endLine: i, name: line.replace(/^#+/, '').trim() || undefined, lines: [] };
    } else {
      cur.lines.push(line);
    }
  });
  cur.endLine = lines.length - 1;
  segments.push(cur);
  return segments;
}

function parseSegment(seg: Segment): ParsedBlock {
  const L = seg.lines;
  const firstLine = seg.firstLine;
  const vars: [string, string][] = [];
  let name = seg.name;
  let i = 0;

  for (; i < L.length; i++) {
    const t = L[i].trim();
    if (!t) continue;
    if (isComment(t)) {
      const nm = /^(?:#|\/\/)\s*@name\s+(.+)$/.exec(t);
      if (nm) name = nm[1].trim();
      continue;
    }
    const v = VAR_RE.exec(t);
    if (v) {
      vars.push([v[1], v[2].trim()]);
      continue;
    }
    break;
  }
  if (i >= L.length) return { vars };

  const requestLine = i;
  const tokens = L[i].trim().split(/\s+/);
  if (tokens.length > 1 && /^HTTP\/\d/i.test(tokens[tokens.length - 1])) tokens.pop();
  let method = 'GET';
  if (tokens.length >= 2 && /^[A-Za-z]+$/.test(tokens[0])) method = tokens.shift()!.toUpperCase();
  let url = tokens.join(' ');
  i++;
  while (i < L.length && /^\s*[?&]/.test(L[i])) {
    url += L[i].trim();
    i++;
  }
  url = url.replace(/\s+HTTP\/\d[\d.]*$/i, ''); // version may trail the last continuation line

  const headers: HttpHeader[] = [];
  for (; i < L.length; i++) {
    const t = L[i].trim();
    if (!t) {
      i++;
      break;
    }
    if (isComment(t)) continue;
    const h = HEADER_RE.exec(t);
    if (!h) break; // not a header: the body starts here
    headers.push([h[1], h[2].trim()]);
  }

  const bodyLines = L.slice(i);
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
  let body = bodyLines.join('\n');
  const ct = headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? '';
  if (/x-www-form-urlencoded/i.test(ct)) body = bodyLines.map((l) => l.trim()).join('');

  return { vars, request: { name, method, url, headers, body, line: firstLine + requestLine } };
}

/** Finds the request whose block contains `line` (0-based) and the file variables declared up to there. */
export function findRequestAt(text: string, line: number): FindResult {
  const segments = splitSegments(text);
  let idx = segments.findIndex((s) => line >= s.startLine && line <= s.endLine);
  if (idx < 0) idx = segments.length - 1;

  const vars: Record<string, string> = {};
  let target: ParsedBlock = { vars: [] };
  for (let k = 0; k <= idx; k++) {
    const block = parseSegment(segments[k]);
    for (const [n, v] of block.vars) vars[n] = v;
    if (k === idx) target = block;
  }
  if (!target.request) return { vars, error: 'No HTTP request found at the cursor position.' };
  return { request: target.request, vars };
}

function defaultGuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function resolveSystemVariable(expr: string, ctx: SubstitutionContext): string | undefined {
  const [fn, ...args] = expr.split(/\s+/);
  switch (fn) {
    case '$guid':
      return (ctx.guid ?? defaultGuid)();
    case '$timestamp':
      return String(Math.floor((ctx.now ?? Date.now)() / 1000));
    case '$randomInt': {
      const min = Number(args[0] ?? 0);
      const max = Number(args[1] ?? 1000);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return undefined;
      return String(Math.floor((ctx.random ?? Math.random)() * (max - min)) + min);
    }
    case '$processEnv':
      return args[0] && ctx.processEnv ? ctx.processEnv(args[0]) : undefined;
    default:
      return undefined;
  }
}

/** Replaces `{{...}}` placeholders; unresolved names are collected and left verbatim. */
export function substitute(
  text: string,
  vars: Record<string, string>,
  ctx: SubstitutionContext,
  unresolved: string[] = [],
  depth = 0,
): string {
  return text.replace(PLACEHOLDER_RE, (whole, expr: string) => {
    let value: string | undefined;
    if (expr.startsWith('$')) {
      value = resolveSystemVariable(expr, ctx);
    } else if (Object.prototype.hasOwnProperty.call(vars, expr)) {
      value = depth < 8 ? substitute(vars[expr], vars, ctx, unresolved, depth + 1) : vars[expr];
    }
    if (value === undefined) {
      if (!unresolved.includes(expr)) unresolved.push(expr);
      return whole;
    }
    return value;
  });
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Applies variable substitution and `Authorization: Basic user:pass` encoding. */
export function resolveRequest(
  req: HttpRequest,
  vars: Record<string, string>,
  ctx: SubstitutionContext = {},
): ResolvedRequest {
  const unresolved: string[] = [];
  const sub = (s: string) => substitute(s, vars, ctx, unresolved);
  const headers: HttpHeader[] = req.headers.map(([n, v]) => {
    const name = sub(n);
    let value = sub(v);
    if (name.toLowerCase() === 'authorization') {
      const m = /^Basic\s+([^\s:]+)(?::|\s+)(.+)$/i.exec(value);
      if (m) value = 'Basic ' + toBase64(`${m[1]}:${m[2]}`);
    }
    return [name, value];
  });
  return { method: req.method, url: sub(req.url), headers, body: sub(req.body), unresolved };
}

/**
 * Re-indents valid JSON with two spaces while keeping every token verbatim (no number precision loss).
 * Returns undefined when `text` is not a JSON object/array.
 */
export function prettyJson(text: string): string | undefined {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    JSON.parse(t);
  } catch {
    return undefined;
  }
  let out = '';
  let indent = 0;
  let inStr = false;
  const nl = () => '\n' + '  '.repeat(indent);
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += t[++i];
      else if (c === '"') inStr = false;
      continue;
    }
    switch (c) {
      case '"':
        inStr = true;
        out += c;
        break;
      case '{':
      case '[': {
        let j = i + 1;
        while (j < t.length && /\s/.test(t[j])) j++;
        if (t[j] === (c === '{' ? '}' : ']')) {
          out += c + t[j];
          i = j;
        } else {
          indent++;
          out += c + nl();
        }
        break;
      }
      case '}':
      case ']':
        indent--;
        out += nl() + c;
        break;
      case ',':
        out += c + nl();
        break;
      case ':':
        out += ': ';
        break;
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        break;
      default:
        out += c;
    }
  }
  return out;
}
