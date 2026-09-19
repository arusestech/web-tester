// 📂 소스에서 시나리오 초안 만들기 (정적 분석 — 브라우저도 AI 도 쓰지 않고 파일만 읽는다)
//
// discover(화면에서 링크 수집)는 "서버가 떠 있어야" 하고 권한에 보이는 메뉴만 얻는다.
// 이 모듈은 반대로 서버 없이 **소스 트리**를 읽어 baseUrl·login·menus·forbidden·expect·조회조건 후보를 뽑는다.
// CLAUDE.md "시나리오 작성 절차" 의 1~8 번을 규칙으로 옮긴 것이고, 결과는 항상 **초안**이다.
// 근거(파일:줄)를 모두 남겨서 사람이 보고서에서 확인하고 고를 수 있게 한다.
//
// 한계(정직하게): 화면 정의가 DB 에 있는 프레임워크(uBridge .ub 등)는 메뉴가 소스에 없다 → discover 를 쓴다.
//   권한별로 달라지는 메뉴·JS 로 그리는 메뉴도 못 본다. expect 는 런타임과 다를 수 있어 첫 실행 확인이 필요하다.
import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_SCAN_VERSION = 1;

// ---------- 상수 ----------
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.settings', '.vscode', '.gradle', '.mvn',
  'target', 'build', 'out', 'bin', 'dist', 'logs', 'log', 'temp', 'tmp', 'coverage', 'test-output', 'browsers']);
const EXTS = new Set(['.java', '.jsp', '.jspf', '.jspx', '.html', '.htm', '.xml', '.sql', '.properties', '.yml', '.yaml']);
const BACKUP_RE = /(_backup|_bak|_old|_org|_orig|\.bak|\.orig|복사본|- ?copy|\(\d\)\.)/i;
const MAX_FILE = 1_500_000;      // 1.5MB 넘는 파일은 생성물·덤프일 가능성이 높다
const MAX_FILES = 30000;

// 금지 버튼 후보 (CLAUDE.md 3번). 실제로 소스에서 발견된 것만 결과에 넣는다
const DANGER_WORDS = ['삭제', '제거', '발송', '전송', '결제', '승인', '반려', '마감', '상신', '이관', '전결', '회수',
  '반영', '확정', '발행', '통보', '일괄', '초기화', '업로드', '등록', '수정', '저장', '실행',
  'Delete', 'Remove', 'Send', 'Save', 'Submit', 'Upload'];
// 메뉴 이름/URL 에 이 단어가 있으면 "조회만" 으로 표시 (누르지 말라는 뜻이 아니라, 화면 자체가 위험할 수 있다는 표시)
const RISKY_MENU = /(삭제|발송|전송|결제|승인|반려|마감|상신|이관|전결)/;
// 화면이 아닌 주소 — 메뉴에서 뺀다. 부분 일치로 판단하지 않는다(정상 화면 /excelLog·/mgmtExcelUpload 를 잃지 않게)
function notScreenUrl(url) {
  const u = String(url).split('?')[0];
  const last = u.split('/').filter(Boolean).pop()?.toLowerCase() || '';
  if (/logout/i.test(u)) return '로그아웃';
  if (/^\/(login|logon|signin|sso)(\/|$)/i.test(u)) return '로그인·SSO 화면';
  if (/^\/api(\/|$)/i.test(u)) return 'API 경로';
  if (/\.(json|xml|xls|xlsx|zip|pdf|csv|jpg|png|gif|css|js)$/i.test(last)) return '파일·데이터 응답';
  if (ALONE_WORDS.has(last) || ['ajax', 'json', 'callback', 'error'].includes(last)) return '다운로드·업로드 등 처리';
  return '';
}

// ---------- 작은 도구들 ----------
const norm = (p) => String(p).split(path.sep).join('/');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripTags = (s) => clean(String(s ?? '').replace(/<[^>]*>/g, ' '));
const blank = (s) => s.replace(/[^\n]/g, ' ');            // 길이·줄번호를 보존하면서 지우기
const uniq = (a) => [...new Set(a)];

// 파일 읽기. 옛 한국 프로젝트는 CP949(euc-kr) 로 저장된 소스가 섞여 있어, utf8 로 깨지면 euc-kr 로 다시 읽는다
export function readText(abs) {
  const buf = fs.readFileSync(abs);
  const s = buf.toString('utf8');
  if (!s.includes('�')) return s.replace(/^﻿/, '');
  try { return new TextDecoder('euc-kr').decode(buf).replace(/^﻿/, ''); } catch { return s.replace(/^﻿/, ''); }
}

function lineOffsets(src) {
  const off = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') off.push(i + 1);
  return off;
}
function lineAt(off, idx) {
  let lo = 0, hi = off.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (off[mid] <= idx) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

/**
 * 자바 주석·문자열 처리.
 *  code = 주석만 지운 것 (문자열 리터럴은 그대로 — 경로를 뽑아야 하므로)
 *  skel = 주석 + 문자열 내용까지 지운 것 (중괄호 짝 맞추기용 — 문자열 안의 { 에 속지 않게)
 * 길이와 줄 위치는 원본과 같다.
 */
export function maskJava(src) {
  let code = '', skel = '', i = 0;
  const n = src.length;
  const both = (s) => { code += s; skel += s; };
  const gone = (s) => { const b = blank(s); code += b; skel += b; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; gone(src.slice(i, j)); i = j; }
    else if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; gone(src.slice(i, j)); i = j; }
    else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') j += 2; else if (src[j] === c) { j++; break; } else if (src[j] === '\n') break; else j++; }
      const lit = src.slice(i, j);
      code += lit;
      skel += c + blank(lit.slice(1, -1)) + (lit.length > 1 ? lit.slice(-1) : '');
      i = j;
    } else {
      let j = i;
      while (j < n && !(src[j] === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) && src[j] !== '"' && src[j] !== "'") j++;
      both(src.slice(i, j)); i = j;
    }
  }
  return { code, skel };
}

// JSP/HTML: 주석만 지운다 (<%-- --%>, <!-- -->). 주석 안에 옛 메뉴가 들어 있는 경우가 많다
export const maskMarkup = (src) => src.replace(/<%--[\s\S]*?--%>|<!--[\s\S]*?-->/g, blank);

// 태그 속성 → { 이름: 값 }
function attrsOf(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) o[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return o;
}

// ---------- 1. 파일 훑기 ----------
export function walkSource(root, { log = () => {}, maxFiles = MAX_FILES } = {}) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`소스 폴더가 없습니다: ${root}`);
  const files = [], skipped = [];
  const stack = [root];
  let hitLimit = false;
  while (stack.length) {
    const dir = stack.pop();
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        stack.push(abs); continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!EXTS.has(ext)) continue;
      const rel = norm(path.relative(root, abs));
      // 주석 처리된 옛 컨트롤러가 그대로 들어 있는 백업 파일은 통째로 뺀다 (실측: 우리은행 ApiVocController_backup_0903.java)
      if (BACKUP_RE.test(e.name)) { skipped.push({ rel, why: '백업/사본으로 보이는 파일' }); continue; }
      let size = 0; try { size = fs.statSync(abs).size; } catch { continue; }
      if (size > MAX_FILE) { skipped.push({ rel, why: `너무 큼 (${Math.round(size / 1024)}KB)` }); continue; }
      files.push({ abs, rel, ext, name: e.name, size });
      if (files.length >= maxFiles) { hitLimit = true; break; }
    }
    if (hitLimit) break;
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  log(`파일 ${files.length}개 (제외 ${skipped.length}개)`);
  return { files, skipped, hitLimit };
}

// ---------- 2. 설정: baseUrl ----------
function scanConfigFile(f, src, ctx) {
  const off = lineOffsets(src);
  const ev = (idx, text) => ({ file: f.rel, line: lineAt(off, idx), text: clean(text).slice(0, 120) });
  if (f.ext === '.properties') {
    for (const m of src.matchAll(/^\s*server\.port\s*=\s*(\d+)/gm)) ctx.ports.push({ port: +m[1], ...ev(m.index, m[0]) });
    for (const m of src.matchAll(/^\s*server\.(?:servlet\.)?context[-.]?path\s*=\s*(\S+)/gmi)) ctx.contexts.push({ ctx: m[1], ...ev(m.index, m[0]) });
  } else if (f.ext === '.yml' || f.ext === '.yaml') {
    // application-local.yml 처럼 프로필이 여러 개면 local 을 먼저 본다 (개발 PC 에서 도는 값)
    const rank = /local/i.test(f.rel) ? 0 : /dev/i.test(f.rel) ? 1 : /prod|real|운영/i.test(f.rel) ? 3 : 2;
    const sv = src.match(/^server:\s*$([\s\S]{0,800})/m);
    if (sv) {
      const p = sv[1].match(/^\s+port:\s*["']?(\d+)/m);              // port: '8081' 처럼 따옴표가 붙는 경우가 많다
      if (p) ctx.ports.push({ port: +p[1], rank, ...ev(src.indexOf(p[0]), p[0]) });
      const c = sv[1].match(/^\s+context-path:\s*["']?([^"'\s]+)/m);
      if (c) ctx.contexts.push({ ctx: c[1], rank, ...ev(src.indexOf(c[0]), c[0]) });
    }
  } else if (f.ext === '.xml') {
    if (/\bserver\.xml$/i.test(f.rel) || /<Server\b/.test(src)) {
      for (const m of src.matchAll(/<Connector\b[^>]*>/g)) {
        const a = attrsOf(m[0]);
        const port = +a.port;
        if (port && port !== 8005 && port !== 8009 && !/AJP/i.test(a.protocol || '')) ctx.ports.push({ port, ...ev(m.index, m[0]) });
      }
      for (const m of src.matchAll(/<Context\b[^>]*>/g)) { const a = attrsOf(m[0]); if (a.path) ctx.contexts.push({ ctx: a.path, ...ev(m.index, m[0]) }); }
    }
    if (/pom\.xml$/i.test(f.rel)) {
      const fin = src.match(/<finalName>\s*([^<\s]+)\s*<\/finalName>/);
      // ${project.artifactId} 처럼 빌드 때 정해지는 값은 컨텍스트로 못 쓴다
      if (fin && !/[${}]/.test(fin[1])) ctx.contexts.push({ ctx: '/' + fin[1].replace(/^\//, ''), ...ev(src.indexOf(fin[0]), fin[0]), weak: true });
    }
    // web.xml: 프론트 컨트롤러 확장자(*.do / *.ub) — 컨트롤러 경로에 붙일 확장자
    if (/web\.xml$/i.test(f.rel)) {
      for (const m of src.matchAll(/<url-pattern>\s*\*(\.\w+)\s*<\/url-pattern>/g)) {
        if (/\.(jsp|jspx|css|js|png|gif)$/i.test(m[1])) continue;
        ctx.urlSuffix.push({ suffix: m[1], ...ev(m.index, m[0]) });
      }
    }
    // Spring MVC 뷰 리졸버
    for (const m of src.matchAll(/<property\s+name="(prefix|suffix)"\s+value="([^"]*)"/g)) ctx.view[m[1]] = m[2];
  }
  if (f.ext === '.properties' || f.ext === '.yml' || f.ext === '.yaml') {
    const pre = src.match(/spring\.mvc\.view\.prefix\s*[=:]\s*(\S+)/) || src.match(/^\s+prefix:\s*(\S+)/m);
    const suf = src.match(/spring\.mvc\.view\.suffix\s*[=:]\s*(\S+)/) || src.match(/^\s+suffix:\s*(\S+)/m);
    if (pre) ctx.view.prefix = pre[1].replace(/["']/g, '');
    if (suf) ctx.view.suffix = suf[1].replace(/["']/g, '');
  }
}

function decideBaseUrl(ctx, override) {
  const evidence = [];
  const byRank = (a, b) => (a.rank ?? 2) - (b.rank ?? 2);
  const port = [...ctx.ports].sort(byRank)[0];
  const context = [...ctx.contexts].filter((c) => !c.weak).sort(byRank)[0] || ctx.contexts[0];
  if (port) evidence.push({ ...port, what: `포트 ${port.port}` });
  if (context) evidence.push({ ...context, what: `컨텍스트 ${context.ctx}` });
  const p = port ? port.port : 8080;
  let c = context ? String(context.ctx).replace(/\/+$/, '') : '';
  if (c === '/' ) c = '';
  if (c && !c.startsWith('/')) c = '/' + c;
  const value = override || `http://localhost:${p}${c}`;
  return {
    value,
    guessed: !override,
    context: c,
    evidence,
    candidates: uniq(ctx.ports.map((x) => `${x.port} (${x.file}:${x.line})`)).slice(0, 6),
  };
}

// ---------- 3. 컨트롤러(Spring MVC) ----------
const ANN_RE = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(([\s\S]{0,400}?)\)/g;

function annPaths(args) {
  const out = [];
  for (const m of args.matchAll(/(?:(\w+)\s*=\s*)?(\{[^}]*\}|"(?:[^"\\]|\\.)*")/g)) {
    if (m[1] && !/^(value|path)$/.test(m[1])) continue;
    for (const s of m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(s[1]);
  }
  return out;
}

// 애너테이션 **바로 위**의 설명(javadoc / // 한 줄) → 메뉴 이름 후보.
// "바로 위" 가 핵심 — 멀리 있는 클래스 javadoc 을 가져오면 모든 메뉴 이름이 "<pre> com…" 이 된다(실측).
function docBefore(src, idx) {
  const head = src.slice(Math.max(0, idx - 1200), idx);
  // javadoc 안에 다시 */ 가 나오면 안 된다 — 그러지 않으면 "앞 메서드의 주석 + 코드 + 이번 주석" 이 통째로 잡힌다
  const m = head.match(/(?:\/\*\*((?:(?!\*\/)[\s\S])*)\*\/|\/\/[ \t]*([^\n]*)\n)\s*(?:@[\w.]+\s*(?:\([^()]*\))?\s*)*$/);
  if (!m) return '';
  const raw = m[1] !== undefined ? m[1].replace(/^\s*\*/gm, ' ').replace(/@\w+[\s\S]*$/, '') : m[2];
  const t = clean(raw).split(/[.。\n]/)[0].replace(/^[/*\s\-–]+/, '').trim();
  if (!t || t.length > 40) return '';
  if (/[<>{};=()]|^com\./.test(t)) return '';                 // 코드·패키지명·태그가 섞인 주석은 이름이 아니다
  if (!/[가-힣]/.test(t) && !/^[A-Za-z][\w ]+$/.test(t)) return '';
  return t;
}
function swaggerName(block) {
  const m = block.match(/@(?:Operation|ApiOperation)\s*\([^)]*?(?:summary|value)\s*=\s*"([^"]+)"/);
  return m ? clean(m[1]) : '';
}

// 메서드 본문 범위 (skel 기준 중괄호 짝)
function bodyRange(skel, from) {
  const open = skel.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < skel.length; i++) {
    if (skel[i] === '{') depth++;
    else if (skel[i] === '}') { depth--; if (!depth) return [open, i]; }
  }
  return [open, skel.length];
}

function scanController(f, src, ctx) {
  if (!/@(Rest)?Controller\b/.test(src)) return;
  const { code, skel } = maskJava(src);
  const off = lineOffsets(src);
  const isRest = /@RestController\b/.test(code);
  const clsIdx = (() => { const m = code.match(/\b(?:public\s+|final\s+|abstract\s+)*class\s+\w+/); return m ? m.index : 0; })();
  // 클래스 레벨 매핑
  let base = '';
  ANN_RE.lastIndex = 0;
  for (let m; (m = ANN_RE.exec(code));) {
    if (m.index > clsIdx) break;
    const ps = annPaths(m[2]);
    if (ps.length) base = ps[0];
  }
  ANN_RE.lastIndex = 0;
  for (let m; (m = ANN_RE.exec(code));) {
    if (m.index < clsIdx) continue;
    const kind = m[1], args = m[2], at = m.index;
    const paths = annPaths(args);
    if (!paths.length) continue;
    const line = lineAt(off, at);
    const where = { file: f.rel, line };
    // 메서드 시그니처 + 나머지 애너테이션
    const after = code.slice(m.index + m[0].length, m.index + m[0].length + 800);
    const sig = after.match(/(?:public|protected|private)\s+(?:static\s+|final\s+)*([\w.<>,\[\]\s?]+?)\s+(\w+)\s*\(/);
    const annBlock = sig ? after.slice(0, sig.index) : after.slice(0, 200);
    const responseBody = /@ResponseBody\b/.test(annBlock);
    const httpMethods = [...args.matchAll(/RequestMethod\.(\w+)/g)].map((x) => x[1]);
    const method = kind === 'Request' ? (httpMethods[0] || 'ANY') : kind.toUpperCase();
    const ret = clean(sig ? sig[1] : '');
    const fn = sig ? sig[2] : '';
    const full = uniq(paths.map((p) => normUrl(joinPath(base, p))));

    const api = isRest || responseBody || /^(Map|List|Set|ResponseEntity|byte|void|int|long|boolean|Object|JSON)/.test(ret) || /Dto|Vo|Response/.test(ret);
    const writeOnly = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
    // 한 메서드 = 한 화면. @GetMapping({"", "index"}) 처럼 여러 주소면 가장 짧은 것만 쓴다
    const url = full.filter((u) => !/\{/.test(u)).sort((a, b) => a.length - b.length)[0];
    const item = { url: url || full[0], method, ret, fn, ...where, api, kind };
    if (api) { ctx.apis.push(item); continue; }
    if (writeOnly) { ctx.skipped.push({ name: fn, url: item.url, why: `${method} 전용 (저장·삭제 처리)`, ...where }); continue; }
    if (!url) { ctx.skipped.push({ name: fn, url: full[0], why: '경로 변수({}) 가 있어 직접 열 수 없음', ...where }); continue; }
    const last = url.split('/').pop();
    if (notMenu(last, fn)) { ctx.skipped.push({ name: fn, url, why: '화면이 아닌 처리(모달·팝업·엑셀·검증 등)', ...where }); continue; }
    // 뷰 이름 (return "x/y" 형태일 때만. StringBuilder 로 조립하면 못 읽는다 → 뒤에서 파일명으로 찾는다)
    let view = '';
    if (sig) {
      const r = bodyRange(skel, m.index + m[0].length + sig.index);
      if (r) {
        const b = code.slice(r[0], r[1]);
        const rv = b.match(/return\s+"([^"]+)"/) || b.match(/setViewName\s*\(\s*"([^"]+)"/) || b.match(/new\s+ModelAndView\s*\(\s*"([^"]+)"/);
        if (rv) view = rv[1];
      }
    }
    const name = swaggerName(annBlock) || docBefore(src, at) || '';
    ctx.menuCands.push({
      url, name, view, hint: last, source: 'controller', confidence: name ? 'mid' : 'low',
      evidence: [{ ...where, what: `@${kind}Mapping ${fn}()` }],
      needSuffix: !/\.\w{2,5}$/.test(url),
    });
  }
}

const joinPath = (a, b) => {
  const s = `${a || ''}/${b || ''}`.replace(/\/{2,}/g, '/');
  return s.startsWith('/') ? s : '/' + s;
};
// 같은 화면의 다른 표기를 하나로: "/x/" "/x/index" → "/x"
const normUrl = (u) => u.replace(/\/index$/i, '').replace(/\/+$/, '') || '/';
// 화면이 아닌 처리 (모달 조각·검증·엑셀 등). **단어 단위**로 본다 —
// 부분 일치로 하면 vocProcessList 가 "proc" 에 걸려 사라진다(실측: 우리은행에서 진짜 메뉴 4개가 이렇게 빠졌음)
const NOT_MENU_WORDS = new Set(['modal', 'popup', 'layer', 'dialog', 'ajax', 'json', 'token', 'callback', 'valid', 'validate', 'dup']);
// 이 단어들은 **조각 전체**가 그 단어일 때만 제외한다.
// (discover 에서 겪은 것과 같은 함정 — 부분 일치로 빼면 /excelLog·/mgmtExcelUpload 같은 정상 화면이 사라진다)
const ALONE_WORDS = new Set(['excel', 'download', 'upload', 'save', 'insert', 'update', 'delete', 'remove', 'print', 'count', 'cnt']);
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const notMenu = (last, fn) => {
  const w = words(`${last} ${fn}`);
  if (w.some((x) => NOT_MENU_WORDS.has(x))) return true;
  return [last, fn].some((s) => ALONE_WORDS.has(String(s).toLowerCase()));
};

// ---------- 4. 메뉴 JSP (사이드바/탑메뉴) ----------
const MENU_FILE_RE = /(menu|lnb|gnb|left|top|nav|side|header|tiles|include|layout)/i;
// 에디터·플러그인·도움말 안의 "메뉴"는 앱 메뉴가 아니다 (스타벅스 실측: 에디터 도움말 htm 이 메뉴로 잡혔음)
// ① 에디터·라이브러리 이름은 경로 어디에 있어도 라이브러리다 (CrossEditor/, smarteditor/ …)
const LIB_NAME_RE = /(editor|tinymce|jquery|bootstrap|datepicker|fullcalendar|highcharts|swiper)\//i;
// ② 흔한 단어는 **경로 조각 전체**가 그 단어일 때만 (business 경로의 latest/ document/ 를 잃지 않게)
const LIB_DIR_RE = /(^|\/)(plugins?|vendor|libs?|samples?|demo|guide|help|docs?|tests?|dist)\//i;
const isLibPath = (rel) => LIB_NAME_RE.test(rel) || LIB_DIR_RE.test(rel);

function urlFromAttrs(a, ctx) {
  // href
  const href = a.href || '';
  if (href && !/^(#|javascript:|mailto:|tel:)/i.test(href) && !/^https?:/i.test(href)) return { url: href, how: 'href' };
  // onclick 안의 경로
  const js = `${a.onclick || ''} ${href}`;
  const m = js.match(/['"]([^'"]*\/[^'"]*\.(?:do|jsp|ub|action|html?|nhn|php))(?:\?[^'"]*)?['"]/i)
    || js.match(/(?:location\.href|location\.replace|window\.open|goPage|goMenu|fnMove|fn_move|movePage|moveMenu|goUrl)\s*[=(]\s*['"]([^'"]+)['"]/i);
  if (m) return { url: m[1], how: 'onclick' };
  // 사용자 정의 속성 (uxl/전자정부: menuurl="VOC1001", data-menu-url="vocList")
  for (const [k, v] of Object.entries(a)) {
    if (!/(url|link|page|path|scrn|screen|prog)/i.test(k) || /menupath/i.test(k)) continue;
    if (!v || /^(#|javascript)/i.test(v) || v.length > 120) continue;
    if (/^\//.test(v)) return { url: v, how: k };
    if (/^[A-Za-z][\w-]{2,30}$/.test(v)) return { code: v, how: k };   // 화면ID·슬러그 → 규칙으로 변환
  }
  return null;
}
function nameFromAttrs(a, text) {
  for (const [k, v] of Object.entries(a)) if (/(path|nm|name|title|label)/i.test(k) && v && v.includes('>')) return clean(v.replace(/\s*>\s*/g, ' > '));
  if (text) return text;
  for (const [k, v] of Object.entries(a)) if (/(nm$|name|title|label|text)/i.test(k) && v && v.length <= 40) return clean(v);
  return '';
}

function scanMenuMarkup(f, src, ctx) {
  const body = maskMarkup(src);
  const off = lineOffsets(src);
  if (/<c:forEach|\$\{[\w.]*menu/i.test(body) && MENU_FILE_RE.test(f.rel)) {
    ctx.dynamicMenuFiles.push(f.rel);
  }
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const a = attrsOf(m[1]);
    const text = stripTags(m[2]).slice(0, 60);
    const got = urlFromAttrs(a, ctx);
    if (!got) continue;
    const name = nameFromAttrs(a, text);
    if (!name) continue;
    // JS 문자열을 이어 붙여 만든 주소('+fileId+')·앵커(#)는 메뉴가 아니다
    if (/['"+<>${}]/.test(name) || /['"+${}]/.test(got.url || '')) continue;
    if ((got.url || '').includes('#')) continue;
    ctx.menuCands.push({
      url: got.url || '', code: got.code || '', name, source: 'menu-jsp',
      confidence: got.url ? 'high' : 'mid',
      evidence: [{ file: f.rel, line: lineAt(off, m.index), what: `<a ${got.how}>` }],
    });
  }
}

// ---------- 5. 메뉴 테이블 INSERT (가장 정확) ----------
const MENU_TABLE_RE = /(MENU|MNU|PROGRAM|PRGM|SCREEN|SCRN)/i;
const COL_NAME_RE = /(MENU|MNU|PRGM|PROGRAM|SCRN|SCREEN)?_?(NM|NAME|TITLE|TITL)$|^(NM|NAME|TITLE)$/i;
const COL_URL_RE = /(URL|LINK|ADDR|PATH|FILE|SCRN_?ID|SCREEN_?ID|PRGM_?ID|PROGRAM_?ID|PAGE)/i;
const COL_ID_RE = /^(MENU_?ID|MNU_?ID|MENU_?CD|MENU_?SEQ|ID|SEQ)$/i;
const COL_UP_RE = /^(UP|UPPER|PARENT|P|HIGH|PRNT)_?(MENU_?)?(ID|CD|SEQ)$/i;

function parseValueList(src, from) {
  // '(' 다음 위치에서 시작. 따옴표 안의 괄호·쉼표를 무시하고 값 배열을 만든다
  const vals = [];
  let cur = '', depth = 1, i = from, q = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q && src[i - 1] !== '\\') q = ''; cur += c; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(') { depth++; cur += c; continue; }
    if (c === ')') { depth--; if (!depth) { vals.push(cur); i++; break; } cur += c; continue; }
    if (c === ',' && depth === 1) { vals.push(cur); cur = ''; continue; }
    cur += c;
  }
  return { vals: vals.map((v) => clean(v).replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1')), end: i };
}

function scanMenuSql(f, src, ctx) {
  const off = lineOffsets(src);
  const re = /insert\s+into\s+([\w."`\[\]]+)\s*\(([^)]*)\)\s*values\s*\(/gi;
  const rows = [];
  for (let m; (m = re.exec(src));) {
    const table = m[1].replace(/["`\[\]]/g, '');
    if (!MENU_TABLE_RE.test(table)) continue;
    const cols = m[2].split(',').map((c) => clean(c).replace(/["`\[\]]/g, '').split('.').pop().toUpperCase());
    const { vals, end } = parseValueList(src, m.index + m[0].length);
    re.lastIndex = end;
    if (vals.length !== cols.length) continue;
    const at = (re2) => cols.findIndex((c) => re2.test(c));
    const iName = at(COL_NAME_RE), iUrl = at(COL_URL_RE), iId = at(COL_ID_RE), iUp = at(COL_UP_RE);
    if (iName < 0 || iUrl < 0) continue;
    rows.push({
      table, name: clean(vals[iName]), url: clean(vals[iUrl]),
      id: iId >= 0 ? clean(vals[iId]) : '', up: iUp >= 0 ? clean(vals[iUp]) : '',
      file: f.rel, line: lineAt(off, m.index),
    });
  }
  if (!rows.length) return;
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id, r]));
  const fullName = (r, depth = 0) => {
    if (depth > 3 || !r.up || !byId.has(r.up)) return r.name;
    const p = byId.get(r.up);
    if (p === r) return r.name;
    return `${fullName(p, depth + 1)} > ${r.name}`;
  };
  for (const r of rows) {
    const v = r.url;
    if (!v || /^(null|#|-)$/i.test(v)) { ctx.skipped.push({ name: r.name, url: v, why: '메뉴 테이블에 URL 이 비어 있음', file: r.file, line: r.line }); continue; }
    const isPath = /^[/.]/.test(v) || /\.\w{2,5}(\?|$)/.test(v);
    ctx.menuCands.push({
      url: isPath ? v : '', code: isPath ? '' : v, name: fullName(r), source: 'menu-sql', confidence: 'high',
      evidence: [{ file: r.file, line: r.line, what: `${r.table} INSERT` }],
    });
  }
  ctx.sqlMenuFiles.push(`${f.rel} (${rows.length}행)`);
}

// ---------- 5-b. 메타 프레임워크 화면 정의 XML ----------
// uBridge/uxl 같은 메타 프레임워크는 화면을 XML 로 정의한다 (실측: 스타벅스 src.resource/…/screen/voc/VOC1001.xml
// → <screenBuilder id="VOC1001" screenType="list"><screenName>VOC 목록</screenName>). 526개 = 사실상 화면 목록 전체.
function scanScreenDef(f, src, ctx) {
  const m = src.match(/<(screenBuilder|screen|page)\b([^>]*)>/i);
  if (!m) return;
  const a = attrsOf(m[0]);
  const id = a.id || f.name.replace(/\.\w+$/, '');
  if (!/^[A-Za-z]{2,6}\d{2,6}$/.test(id)) return;
  const nm = src.match(/<(?:screenName|screenNm|pageName|title|name)>\s*([^<]{1,60})\s*<\//i);
  const name = nm ? clean(nm[1]) : '';
  const type = String(a.screentype || a.type || '').toLowerCase();
  const where = { file: f.rel, line: 1, what: `<${m[1]} id=${id}>` };
  if (/popup|dialog|modal/.test(type)) { ctx.skipped.push({ name: name || id, url: id, why: '팝업 전용 화면 (직접 열면 렌더가 다를 수 있음)', ...where }); return; }
  // 화면 정의가 가리키는 JSP (<filePath>/standard/voc/</filePath><fileName>VOC1001</fileName>)
  // → 이걸로 실제 화면 JSP 를 찾아 expect·조회조건·상세·버튼을 뽑는다
  const fp = src.match(/<filePath>\s*([^<]*)\s*<\//i), fn = src.match(/<fileName>\s*([^<]*)\s*<\//i);
  const view = fn ? `${clean(fp ? fp[1] : '')}${clean(fn[1])}`.replace(/\/{2,}/g, '/') : '';
  ctx.menuCands.push({ code: id, url: '', name, view, hint: id, source: 'screen-def', confidence: name ? 'high' : 'mid', evidence: [where] });
}

// ---------- 6. struts / 옛 Spring XML / tiles ----------
function scanXmlScreens(f, src, ctx) {
  const off = lineOffsets(src);
  if (/struts-config|struts\.xml$/i.test(f.rel) || /<action-mappings\b/.test(src)) {
    for (const m of src.matchAll(/<action\b([^>]*)>/g)) {
      const a = attrsOf(m[0]);
      const p = a.path || a.name;
      if (!p) continue;
      ctx.menuCands.push({
        url: p.startsWith('/') ? p : '/' + p, name: '', source: 'struts', confidence: 'low',
        evidence: [{ file: f.rel, line: lineAt(off, m.index), what: '<action path>' }],
        needSuffix: !/\.\w{2,5}$/.test(p),
      });
    }
  }
  // tiles: 뷰 이름 → JSP 파일
  for (const m of src.matchAll(/<definition\b([^>]*)>([\s\S]{0,600}?)<\/definition>/g)) {
    const a = attrsOf(m[0]);
    if (!a.name) continue;
    const put = m[2].match(/<put-attribute\b[^>]*name="(?:body|content|main)"[^>]*value="([^"]+)"/);
    const tpl = put ? put[1] : a.template;
    if (tpl && /\.jspx?$/i.test(tpl)) ctx.tiles[a.name] = tpl;
  }
  // 옛 Spring: <bean name="/emp/list.do" class="...Controller">
  for (const m of src.matchAll(/<bean\b[^>]*name="(\/[^"]+)"[^>]*>/g)) {
    ctx.menuCands.push({
      url: m[1], name: '', source: 'spring-xml', confidence: 'low',
      evidence: [{ file: f.rel, line: lineAt(off, m.index), what: '<bean name>' }],
    });
  }
}

// ---------- 7. 금지 버튼 후보 ----------
function scanDangerWords(f, src, ctx) {
  const off = lineOffsets(src);
  const seen = new Set();
  const hit = (text, idx) => {
    const t = clean(text);
    if (!t || t.length > 20) return;
    for (const w of DANGER_WORDS) {
      if (!t.includes(w)) continue;
      const e = ctx.danger.get(w) || { word: w, count: 0, sample: null };
      e.count++;
      if (!e.sample) e.sample = { file: f.rel, line: lineAt(off, idx), text: t };
      ctx.danger.set(w, e);
      if (!seen.has(w)) seen.add(w);
    }
  };
  for (const m of src.matchAll(/<(?:button|a|span|input|td|th|li|div|em|strong)\b[^>]*>([^<]{1,20})</gi)) hit(m[1], m.index);
  for (const m of src.matchAll(/(?:value|title|alt|data-label)\s*=\s*"([^"]{1,20})"/gi)) hit(m[1], m.index);
}

// ---------- 8. 로그인 화면 ----------
function scanLoginCandidate(f, src, ctx) {
  const pw = src.match(/<input\b[^>]*type\s*=\s*["']?password["']?[^>]*>/i);
  if (!pw) return;
  let score = 0;
  if (/(login|signin|sign_in|logon)/i.test(f.rel)) score += 4;
  if (/(mob|mobile|partner|sso|test|sample|old)/i.test(f.rel)) score -= 3;
  if (/<form\b/i.test(src)) score += 1;
  if (/[가-힣]/.test(src)) score += 1;
  ctx.loginCands.push({ file: f, src, score, pwTag: pw[0], pwIdx: pw.index });
}

const selOf = (a) => (a.id ? `#${a.id}` : a.name ? `input[name=${a.name}]` : '');

function buildLogin(ctx, opts) {
  const best = ctx.loginCands.sort((a, b) => b.score - a.score)[0];
  if (!best) return { found: false, why: '비밀번호 입력란이 있는 화면을 찾지 못했습니다' };
  const { file: f, src } = best;
  const off = lineOffsets(src);
  const body = maskMarkup(src);
  const pwAttr = attrsOf(best.pwTag);
  // 아이디 칸: 비밀번호 앞쪽의 마지막 text 입력, 없으면 이름에 id/user 가 든 입력
  const inputs = [...body.matchAll(/<input\b[^>]*>/gi)].map((m) => ({ a: attrsOf(m[0]), idx: m.index }));
  const before = inputs.filter((x) => x.idx < best.pwIdx && !/^(hidden|submit|button|checkbox|radio|image)$/i.test(x.a.type || 'text'));
  const idIn = [...before].reverse().find((x) => /(id|user|emp|login|mber|사번)/i.test(`${x.a.id} ${x.a.name}`)) || before[before.length - 1];
  // 로그인 버튼: 비밀번호 입력란 **뒤**의 후보들에 점수를 매겨 가장 그럴듯한 것을 고른다.
  // 먼저 나오는 것을 그냥 쓰면 "아이디 저장" 체크박스(div.login-idcheck)를 집는다(실측: 스타벅스 BCO0001)
  let btn = '';
  let bestScore = 0;
  const tail = body.slice(best.pwIdx + best.pwTag.length);
  for (const c of tail.matchAll(/<(button|a|input|div|span|img)\b([^>]*)>([^<]{0,20})/gi)) {
    const a = attrsOf(c[0]);
    const tag = c[1].toLowerCase();
    if (tag === 'input' && !/^(submit|button|image)$/i.test(a.type || '')) continue;   // 다른 입력란
    const txt = clean(c[3]);
    const idcls = `${a.id || ''} ${a.class || ''}`;
    const blob = `${idcls} ${a.onclick || ''} ${a['data-click'] || ''} ${a.value || ''} ${a.alt || ''} ${txt}`;
    if (!/(로그인|login|signin|sign_in|logon|submit)/i.test(blob)) continue;
    let s = 1;
    if (/(로그인|login|signin|submit)/i.test(`${txt} ${a.value || ''} ${a.alt || ''}`)) s += 3;
    if (/btn|button|submit/i.test(idcls)) s += 3;
    if (tag === 'button' || /^(submit|image)$/i.test(a.type || '')) s += 3;
    if (a.onclick || a['data-click']) s += 2;
    if (/(idcheck|idsave|save|find|search|join|cert|reset|help|pw|passwd|password|sso)/i.test(idcls)) s -= 6;  // 아이디저장·비번찾기 등
    if (s <= bestScore) continue;
    const sel = a.id ? `#${a.id}`
      : a['data-click'] ? `[data-click="${a['data-click']}"]`
        : a.name ? `[name=${a.name}]`
          : (txt && /[가-힣A-Za-z]/.test(txt)) ? `text=${txt}`
            : a.class ? `${tag}.${String(a.class).split(/\s+/)[0]}` : '';
    if (sel) { btn = sel; bestScore = s; }
  }
  const form = body.match(/<form\b[^>]*>/i);
  const action = form ? attrsOf(form[0]).action : '';
  // 로그인 화면 URL: ① 컨트롤러의 login GET 매핑 중 가장 짧은 것 ② 이 뷰를 여는 매핑 ③ 직접 열 수 있는 JSP 경로
  const viewKey = f.rel.replace(/^.*?(WebContent|webapp|resources)\//, '').replace(/\.jspx?$/, '');
  const byName = ctx.menuCands.filter((m) => m.source === 'controller' && /login|logon|signin/i.test(m.url) && !/logout/i.test(m.url))
    .map((m) => m.url).sort((a, b) => a.length - b.length);
  const byView = ctx.menuCands.find((m) => m.view && viewKey.endsWith(m.view.replace(/^\//, '')));
  // 파일명이 화면ID(BCO0001.jsp)이고 화면ID→URL 규칙을 알면 그것이 가장 정확하다
  const scrn = f.name.match(/^([A-Z]{2,6}\d{3,6})\.jspx?$/);
  const byScreen = scrn && opts.pattern ? opts.pattern.replace('{}', scrn[1]) : '';
  let url = byScreen || byName[0] || (byView ? byView.url : '') || guessJspUrl(f.rel) || (action && action.startsWith('/') ? action : '/login');
  if (opts.context && url.startsWith(opts.context + '/')) url = url.slice(opts.context.length);   // baseUrl 에 이미 컨텍스트가 있으면 뺀다
  const pwSel = selOf(pwAttr) || 'input[type=password]';
  const steps = [
    { action: 'fill', selector: idIn ? selOf(idIn.a) : 'input[name=userId]', value: opts.user || '{{userId}}' },
    { action: 'fill', selector: pwSel, value: '{{password}}' },
    { action: 'click', selector: btn || 'button[type=submit]' },
  ];
  return {
    // detect = "이게 아직 보이면 로그인 실패". 로그인 URL 에 login 이 안 들어가는 사이트(/screen/BCO0001.ub)에서는
    // urlNotContains:login 이 항상 통과해 버리므로 비밀번호 칸으로 판정하는 쪽이 안전하다
    found: true, url, steps, detect: pwSel,
    success: /login|logon|signin/i.test(url) ? { urlNotContains: 'login' } : {},
    file: f.rel, line: lineAt(off, best.pwIdx),
    fields: { id: idIn ? selOf(idIn.a) : '', pw: selOf(pwAttr), button: btn, action },
    todo: [
      !btn && '로그인 버튼 셀렉터를 못 찾았습니다 — 화면에서 확인하세요',
      !idIn && '아이디 입력란을 못 찾았습니다',
      !opts.user && '테스트 계정 ID 를 채우세요 (지금은 실행할 때마다 묻습니다)',
    ].filter(Boolean),
  };
}

// WEB-INF 밖의 JSP 는 직접 열 수 있다 → URL 로 쓸 수 있음
function guessJspUrl(rel) {
  const m = rel.match(/(?:WebContent|webapp|web|src\/main\/webapp)\/(.+\.jspx?)$/i);
  if (!m || /WEB-INF/i.test(m[1])) return '';
  return '/' + m[1];
}

// ---------- 9. 화면 JSP 분석: expect / 조회조건 / 상세 ----------
export function analyzeView(abs, rel) {
  let src; try { src = readText(abs); } catch { return null; }
  const body = maskMarkup(src);
  const off = lineOffsets(src);
  const out = { file: rel, expect: [], inputs: [], buttons: [], detail: null, notes: [] };

  // --- 그리드/목록 ---
  const grids = [];
  for (const m of body.matchAll(/\$\(\s*["']#([\w-]+)["']\s*\)\s*\.jqGrid\s*\(/g)) grids.push({ sel: `#${m[1]}`, kind: 'jqGrid', line: lineAt(off, m.index) });
  for (const m of body.matchAll(/new\s+tui\.Grid\s*\(\s*\{[\s\S]{0,300}?el:\s*(?:document\.getElementById\(\s*['"]([\w-]+)['"]|['"]#([\w-]+)['"])/g)) {
    grids.push({ sel: `#${m[1] || m[2]}`, kind: 'toastUI', line: lineAt(off, m.index) });
  }
  for (const m of body.matchAll(/<table\b([^>]*)>/gi)) {
    const a = attrsOf(m[0]);
    if (!a.id) continue;
    if (/(list|grid|tbl|table|result)/i.test(a.id)) grids.push({ sel: `#${a.id}`, kind: 'table', line: lineAt(off, m.index) });
  }
  for (const m of body.matchAll(/<div\b([^>]*)>/gi)) {
    const a = attrsOf(m[0]);
    if (a.id && /(grid|list|tree)/i.test(`${a.id} ${a.class || ''}`)) grids.push({ sel: `#${a.id}`, kind: 'div', line: lineAt(off, m.index) });
  }
  // --- 폼 ---
  const forms = [];
  for (const m of body.matchAll(/<form\b([^>]*)>/gi)) {
    const a = attrsOf(m[0]);
    if (a.id) forms.push({ sel: `#${a.id}`, id: a.id, line: lineAt(off, m.index), search: /(search|srch|cond|find|list)/i.test(a.id) });
  }
  const grid = grids[0];
  const form = forms.find((x) => !x.search) || forms[0];
  if (grid) out.expect.push({ sel: grid.sel, why: `${grid.kind} 목록`, line: grid.line, confidence: grid.kind === 'jqGrid' || grid.kind === 'toastUI' ? 'mid' : 'low' });
  else if (form) out.expect.push({ sel: form.sel, why: '폼', line: form.line, confidence: 'low' });

  // --- 조회 조건 입력란 ---
  const scope = forms.find((x) => x.search);
  for (const m of body.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const a = attrsOf(m[0]);
    const type = (m[1].toLowerCase() === 'input' ? (a.type || 'text') : m[1]).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'file', 'password'].includes(type)) continue;
    const key = a.name || a.id;
    if (!key || key.length > 40) continue;
    // 라벨: 바로 앞의 <th> 또는 <label>
    const head = body.slice(Math.max(0, m.index - 300), m.index);
    const lb = [...head.matchAll(/<(?:th|label)\b[^>]*>([^<]{1,30})</gi)].pop();
    let label = clean(lb ? lb[1] : (a.title || a.placeholder || ''));
    if (/해\s*주세요|하세요|하십시오|입력$|선택$/.test(label)) label = '';   // "…입력해주세요" 같은 안내문은 이름이 아니다
    out.inputs.push({
      key, type, label,
      readonly: 'readonly' in a || 'disabled' in a,
      date: /(date|dt|ymd|일자|날짜)/i.test(`${key} ${a.class || ''}`),
      inSearchForm: !!scope, line: lineAt(off, m.index),
    });
  }
  // 조회 버튼
  const btn = [...body.matchAll(/<(?:a|button|input)\b([^>]*)>([^<]{0,10})/gi)]
    .map((m) => ({ a: attrsOf(m[0]), txt: clean(m[2]), idx: m.index }))
    .find((x) => /(조회|검색|search|srch)/i.test(`${x.a.id} ${x.a.onclick || ''} ${x.a.value || ''} ${x.txt}`));
  if (btn) out.searchBtn = { sel: btn.a.id ? `#${btn.a.id}` : btn.txt ? `text=${btn.txt}` : '', line: lineAt(off, btn.idx) };

  // --- 화면의 버튼 목록 ---
  // 클릭 스텝을 자동으로 만들지는 않는다(누르면 데이터가 바뀌고, 성공 판정을 소스에서 정할 수 없다).
  // 대신 "이 화면에 어떤 버튼이 있는지"를 목록으로 남겨 CRUD 흐름(⏺ 녹화)을 만들 때 고르게 한다.
  const btnSeen = new Set();
  for (const m of body.matchAll(/<(?:ub:)?(button|a|input|div|span)\b([^>]*)>([^<]{0,24})/gi)) {
    const a = attrsOf(m[0]);
    const tag = m[1].toLowerCase();
    const txt = clean(m[3]);
    const label = clean(txt || a.value || a.title || a.alt || '');
    const idcls = `${a.id || ''} ${a.class || ''}`;
    const looksBtn = tag === 'button' || /^(submit|button|image)$/i.test(a.type || '') || /btn|button/i.test(idcls) || (!!a.onclick && !!label);
    if (!looksBtn || !label || label.length > 20) continue;
    if (!/[가-힣A-Za-z]/.test(label)) continue;
    if (/['"+<>${};=]/.test(label)) continue;   // JS 문자열로 조립한 마크업에서 잘려 나온 조각 (tag +='<button…)
    const sel = a.id ? `#${a.id}` : a.name ? `[name=${a.name}]` : `text=${label}`;
    const key = `${label}|${sel}`;
    if (btnSeen.has(key)) continue;
    btnSeen.add(key);
    const danger = DANGER_WORDS.find((w) => label.includes(w)) || '';
    out.buttons.push({ label, sel, danger, line: lineAt(off, m.index) });
    if (out.buttons.length >= 20) break;
  }

  // 메타 화면(uxl 등)은 버튼이 JSP 마크업에 없고 스크립트에서 id 로만 다뤄진다 ($('#btnRegister').click(…)).
  // 그 id 들도 실제 화면의 버튼이므로 목록에 넣는다 (이름은 id 그대로 — 한글 라벨은 메타 페이지에 있어 알 수 없다)
  const JS_DANGER = /(del|remove|save|send|submit|regist|insert|update|approve|reject|excel|upload|print|apply|confirm)/i;
  for (const m of body.matchAll(/\$\(\s*['"]#([\w-]*[Bb][Tt][Nn][\w-]*)['"]\s*\)/g)) {
    if (out.buttons.length >= 20) break;
    const id = m[1];
    const sel = `#${id}`;
    if (btnSeen.has(`${id}|${sel}`) || out.buttons.some((b) => b.sel === sel)) continue;
    btnSeen.add(`${id}|${sel}`);
    out.buttons.push({ label: id, sel, danger: JS_DANGER.test(id) ? id : '', line: lineAt(off, m.index), js: true });
  }

  // --- 목록 → 상세 (후보만. 행 클릭이 데이터를 바꾸는 화면이 있어 자동으로는 넣지 않는다) ---
  const dbl = body.match(/ondblClickRow\s*:/), sel1 = body.match(/onSelectRow\s*:/), tui = body.match(/\.on\(\s*['"]dblclick['"]/);
  if (grid && (dbl || sel1 || tui)) {
    out.detail = {
      selector: grid.kind === 'jqGrid' ? `${grid.sel} tr.jqgrow` : grid.kind === 'toastUI' ? `${grid.sel} .tui-grid-cell` : `${grid.sel} tbody tr`,
      dblclick: !!(dbl || tui), rows: 1,
      why: dbl ? 'ondblClickRow' : tui ? "on('dblclick')" : 'onSelectRow',
      line: lineAt(off, (dbl || sel1 || tui).index),
    };
  }
  return out;
}

// ---------- 메뉴 정리 ----------
function pathToName(url) {
  const s = String(url).replace(/\?.*$/, '').replace(/\.\w{2,5}$/, '').replace(/^\//, '');
  if (!s) return '메인';
  return s.split('/').filter(Boolean).map((x) => x.replace(/([a-z])([A-Z])/g, '$1 $2')).join(' > ');
}
const RANK = { 'menu-sql': 4, 'menu-jsp': 3, controller: 2, struts: 1, 'spring-xml': 1 };

// 화면ID → URL 규칙 추론: 소스에 "/screen/BCO0001.ub" 같은 리터럴이 있으면 그 모양을 쓴다
function inferPattern(hits) {
  const count = new Map();
  for (const h of hits) count.set(h, (count.get(h) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function finalizeMenus(ctx, { pattern, context, suffix, limit }) {
  const out = new Map();
  const push = (m) => {
    let url = m.url;
    if (!url && m.code) {
      if (!pattern) { ctx.skipped.push({ name: m.name, url: m.code, why: `화면ID 만 있고 URL 규칙을 몰라 변환 못 함 (--pattern "/screen/{}.ub")`, ...(m.evidence?.[0] || {}) }); return; }
      url = pattern.replace('{}', m.code);
    }
    if (!url) return;
    url = url.trim();
    if (/^https?:/i.test(url)) { ctx.skipped.push({ name: m.name, url, why: '외부 주소', ...(m.evidence?.[0] || {}) }); return; }
    if (!url.startsWith('/')) url = '/' + url;
    if (context && url.startsWith(context + '/')) url = url.slice(context.length);   // baseUrl 에 이미 컨텍스트가 있으면 뺀다
    if (m.needSuffix && suffix && !/\.\w{2,5}$/.test(url)) url += suffix;
    // 주소처럼 안 생긴 것 (상수 이어붙이기 등으로 잘못 뽑힌 값)
    if (!/^\/[\w\-./~%가-힣]*(\?[\w\-.=&%가-힣]*)?$/.test(url)) { ctx.skipped.push({ name: m.name, url, why: '주소 형식이 아님 (소스에서 문자열을 조립하는 코드)', ...(m.evidence?.[0] || {}) }); return; }
    const notScreen = notScreenUrl(url);
    if (notScreen) { ctx.skipped.push({ name: m.name || pathToName(url), url, why: notScreen, ...(m.evidence?.[0] || {}) }); return; }
    if (/\{|\$\{|\*/.test(url)) { ctx.skipped.push({ name: m.name, url, why: '변수(${}/{}) 가 든 주소', ...(m.evidence?.[0] || {}) }); return; }
    const key = url.toLowerCase();
    const prev = out.get(key);
    const cur = { ...m, url };
    if (!prev) { out.set(key, cur); return; }
    // 합치기: 이름은 더 좋은 출처에서, 근거는 모두
    if ((RANK[cur.source] || 0) > (RANK[prev.source] || 0) || (!prev.name && cur.name)) {
      out.set(key, { ...cur, name: cur.name || prev.name, view: cur.view || prev.view, evidence: [...(prev.evidence || []), ...(cur.evidence || [])] });
    } else {
      prev.evidence = [...(prev.evidence || []), ...(cur.evidence || [])];
      prev.view = prev.view || cur.view;
      prev.name = prev.name || cur.name;
    }
  };
  for (const m of ctx.menuCands) push(m);

  // 이름 정리 + 중복 이름 처리 (메뉴 이름 중복은 비교·재실행을 망가뜨린다 — lint 에서도 오류)
  const used = new Map();
  const list = [...out.values()].map((m) => {
    let name = clean(m.name) || pathToName(m.url);
    if (RISKY_MENU.test(`${name} ${m.url}`) && !/조회만/.test(name)) name += ' (조회만)';
    return { ...m, name };
  }).sort((a, b) => (RANK[b.source] || 0) - (RANK[a.source] || 0) || a.name.localeCompare(b.name));
  for (const m of list) {
    const n = (used.get(m.name) || 0) + 1;
    used.set(m.name, n);
    if (n > 1) m.name = `${m.name} (${n})`;
    m.risky = RISKY_MENU.test(`${m.name} ${m.url}`);
  }
  if (limit && list.length > limit) {
    ctx.warnings.push(`메뉴 후보가 ${list.length}개라 상위 ${limit}개만 남겼습니다 (--limit 로 조정)`);
    return list.slice(0, limit);
  }
  return list;
}

// ---------- 본체 ----------
/**
 * root: 프로젝트 소스 루트
 * opts: { log, name, baseUrl, user, pattern, limit, expect(기본 true), maxFiles }
 */
export function scanSource(root, opts = {}) {
  const t0 = Date.now();
  const log = opts.log || (() => {});
  const abs = path.resolve(root);
  const { files, skipped: skippedFiles, hitLimit } = walkSource(abs, { log, maxFiles: opts.maxFiles });
  const ctx = {
    ports: [], contexts: [], urlSuffix: [], view: {}, tiles: {},
    menuCands: [], apis: [], skipped: [], danger: new Map(), loginCands: [],
    patternHits: [], dynamicMenuFiles: [], sqlMenuFiles: [], warnings: [],
  };
  const stat = { java: 0, jsp: 0, xml: 0, sql: 0, etc: 0 };

  let n = 0;
  for (const f of files) {
    n++;
    if (n % 500 === 0) log(`  … ${n}/${files.length}`);
    let src;
    try { src = readText(f.abs); } catch { continue; }
    // 화면ID → URL 규칙 후보 (예: "/screen/BCO0001.ub")
    for (const m of src.matchAll(/["'](\/[\w-]+\/)[A-Z]{2,6}\d{3,6}(\.\w{2,5})["']/g)) ctx.patternHits.push(`${m[1]}{}${m[2]}`);
    if (f.ext === '.java') { stat.java++; scanController(f, src, ctx); }
    else if (/\.(jsp|jspf|jspx|html?)$/.test(f.ext)) {
      stat.jsp++;
      scanDangerWords(f, src, ctx);
      scanLoginCandidate(f, src, ctx);
      if (MENU_FILE_RE.test(f.rel) && !isLibPath(f.rel)) scanMenuMarkup(f, src, ctx);
    } else if (f.ext === '.xml') {
      stat.xml++;
      scanConfigFile(f, src, ctx);
      scanXmlScreens(f, src, ctx);
      scanScreenDef(f, src, ctx);
      if (MENU_TABLE_RE.test(src.slice(0, 4000)) || /insert\s+into/i.test(src)) scanMenuSql(f, src, ctx);
    } else if (f.ext === '.sql') { stat.sql++; scanMenuSql(f, src, ctx); }
    else { stat.etc++; scanConfigFile(f, src, ctx); }
  }

  const baseUrl = decideBaseUrl(ctx, opts.baseUrl);
  const pattern = opts.pattern || inferPattern(ctx.patternHits);
  // web.xml 의 *.do / *.ub 처럼 프론트 컨트롤러 확장자가 여러 개면 어느 것을 붙일지 알 수 없다 → 붙이지 않는다
  const suffixes = uniq(ctx.urlSuffix.map((x) => x.suffix)).filter((s) => !/\.(json|xml|rex|rss|css|js)$/i.test(s));
  const suffix = suffixes.length === 1 ? suffixes[0] : '';
  if (suffixes.length > 1) ctx.warnings.push(`web.xml 에 확장자 매핑이 여러 개입니다(${suffixes.join(', ')}) — 컨트롤러 주소에 확장자를 붙이지 않았습니다. 필요하면 직접 붙이세요`);
  log(`메뉴 후보 ${ctx.menuCands.length}건 · 컨트롤러 API ${ctx.apis.length}건 · 로그인 후보 ${ctx.loginCands.length}건`);
  const menus = finalizeMenus(ctx, { pattern, context: baseUrl.context, suffix, limit: opts.limit || 800 });

  // 뷰(JSP) 분석 → expect / 조회조건 / 상세 후보
  const jspFiles = files.filter((f) => /\.(jsp|jspx)$/.test(f.ext));
  const jspByPath = new Map(jspFiles.map((f) => [f.rel.toLowerCase(), f]));
  const jspByName = new Map();                                  // 파일명(확장자 제외) → 후보들
  for (const f of jspFiles) {
    const k = f.name.replace(/\.jspx?$/i, '').toLowerCase();
    jspByName.set(k, [...(jspByName.get(k) || []), f]);
  }
  const findJsp = (view) => {
    if (!view) return null;
    const cands = [];
    const tile = ctx.tiles[view];
    if (tile) cands.push(tile);
    if (ctx.view.prefix || ctx.view.suffix) cands.push(`${ctx.view.prefix || ''}${view}${ctx.view.suffix || '.jsp'}`);
    cands.push(`${view}.jsp`, view);
    for (const c of cands) {
      const want = String(c).replace(/^\//, '').toLowerCase();
      for (const [rel, f] of jspByPath) if (rel === want || rel.endsWith('/' + want)) return f;
    }
    return null;
  };
  // 뷰 이름을 못 읽는 컨트롤러(StringBuilder 로 조립 등)가 많다 → 주소 마지막 조각과 같은 이름의 JSP 가 딱 하나면 그것으로 본다
  const findJspByHint = (hint) => {
    const list = jspByName.get(String(hint || '').toLowerCase());
    return list && list.length === 1 ? list[0] : null;
  };
  const inputFreq = new Map();
  if (opts.expect !== false) {
    let done = 0;
    for (const m of menus) {
      // 화면 주소의 마지막 조각은 확장자를 떼고 찾는다 (/screen/VOC1001.ub → VOC1001.jsp)
      const hint = String(m.hint || m.url.split('/').pop() || '').replace(/\.\w{2,5}$/, '');
      const f = findJsp(m.view) || (m.url && jspByPath.get(String(m.url).replace(/^\//, '').toLowerCase())) || findJspByHint(hint);
      if (!f) continue;
      const a = analyzeView(f.abs, f.rel);
      if (!a) continue;
      done++;
      m.viewFile = f.rel;
      if (a.expect.length) m.expect = a.expect;
      if (a.detail) m.detailCandidate = a.detail;
      if (a.searchBtn?.sel) m.searchBtn = a.searchBtn.sel;
      m.inputs = a.inputs;
      if (a.buttons.length) m.buttons = a.buttons;
      for (const i of a.inputs) {
        const e = inputFreq.get(i.key) || { key: i.key, label: '', screens: 0, date: false, readonly: false };
        e.screens++; e.label = e.label || i.label; e.date = e.date || i.date; e.readonly = e.readonly || i.readonly;
        inputFreq.set(i.key, e);
      }
    }
    log(`화면 JSP 분석 ${done}개 (expect·조회조건·상세 후보)`);
  }

  const forbidden = [...ctx.danger.values()].sort((a, b) => b.count - a.count);
  const inputsCommon = [...inputFreq.values()].filter((x) => x.screens >= 2 && x.label).sort((a, b) => b.screens - a.screens).slice(0, 25);
  const searchBtns = new Map();
  const add = (sel) => searchBtns.set(sel, (searchBtns.get(sel) || 0) + 1);
  for (const m of menus) {
    if (m.searchBtn) add(m.searchBtn);
    // 메타 화면은 조회 버튼도 스크립트 id 로만 있다 — 이름이 딱 "조회" 뜻인 것만 (btnEmpSearch 같은 팝업 열기 버튼 제외)
    for (const b of m.buttons || []) if (/^(searchBtn|btnSearch|srchBtn|btnSrch|search|btnInquiry|inquiryBtn)$/i.test(b.label)) add(b.sel);
  }
  // id 로 잡히는 조회 버튼을 text= 보다 우선 (텍스트 셀렉터는 다른 요소와 겹치기 쉽다)
  const searchSel = [...searchBtns.entries()].sort((a, b) => b[1] - a[1] || (b[0].startsWith('#') ? 1 : 0) - (a[0].startsWith('#') ? 1 : 0))[0]?.[0] || '';

  // 경고 (사람이 꼭 봐야 하는 것)
  const warnings = [...ctx.warnings];
  if (!menus.length) warnings.push('메뉴를 하나도 못 찾았습니다. 화면 정의가 DB 에 있는 프레임워크(uBridge .ub 등)이거나 소스 구조가 다릅니다 → 🔍 화면에서 메뉴 수집(discover) 을 쓰세요');
  if (ctx.dynamicMenuFiles.length) warnings.push(`메뉴 JSP 가 DB 에서 동적으로 그려집니다(${ctx.dynamicMenuFiles.slice(0, 3).join(', ')}) — 메뉴 테이블 덤프나 discover 로 보완하세요`);
  if (!ctx.loginCands.length) warnings.push('로그인 화면을 못 찾았습니다 — 로그인 설정을 직접 채우세요');
  if (baseUrl.guessed && !ctx.ports.length) warnings.push('포트를 못 찾아 8080 으로 뒀습니다 — 접속 URL 을 확인하세요');
  if (hitLimit) warnings.push(`파일 수 상한(${opts.maxFiles || MAX_FILES})에 걸려 일부만 훑었습니다`);
  if (menus.some((m) => m.expect)) warnings.push('expect(핵심 요소)는 소스의 id 라 런타임과 다를 수 있습니다 — 첫 실행 보고서에서 "핵심 요소 없음" 이 나면 실제 화면 요소로 바꾸세요');

  const result = {
    version: SOURCE_SCAN_VERSION,
    root: abs, ranAt: new Date().toISOString(), ms: Date.now() - t0,
    name: opts.name || path.basename(abs),
    stats: { files: files.length, ...stat, menus: menus.length, apis: ctx.apis.length },
    baseUrl, pattern, urlSuffix: suffix,
    login: buildLogin(ctx, { ...opts, pattern, context: baseUrl.context }),
    menus, forbidden, inputsCommon, searchSel,
    apis: ctx.apis.slice(0, 200),
    skipped: ctx.skipped,
    skippedFiles,
    sqlMenuFiles: ctx.sqlMenuFiles,
    dynamicMenuFiles: ctx.dynamicMenuFiles,
    warnings,
  };
  log(`완료 — 메뉴 ${menus.length}개 · 금지 버튼 후보 ${forbidden.length}개 · ${(result.ms / 1000).toFixed(1)}초`);
  return result;
}

// ---------- 버튼 → 동작 검사(actions) 후보 ----------
// 눌러도 데이터가 바뀌지 않는 버튼만 고른다. 조금이라도 애매하면 넣지 않는다(실행하면 실제로 눌린다).
const SAFE_BTN = /(조회|검색|찾기|목록|새로고침|초기화|리셋|닫기|취소|더보기|접기|펼치기|search|srch|inquiry|find|list|refresh|reset|clear|close|cancel|more)/i;
const UNSAFE_BTN = /(등록|저장|수정|삭제|제거|발송|전송|결제|승인|반려|마감|상신|이관|전결|회수|반영|확정|발행|통보|일괄|업로드|다운로드|엑셀|출력|인쇄|실행|적용|복사|이동|추가|생성|변경|잠금|해제|초기화비번|save|insert|update|del|remove|send|submit|approve|reject|upload|download|excel|print|apply|exec|regist|create|copy|move|add)/i;

/** 화면의 버튼 목록 → 안전한 것만 actions 후보로 (name/click 만 채운 초안) */
export function safeActions(buttons = [], forbiddenWords = []) {
  const forb = forbiddenWords.map((w) => { try { return new RegExp(w, 'i'); } catch { return null; } }).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const b of buttons) {
    const label = String(b.label || '');
    if (b.danger) continue;                                   // 위험 단어가 든 버튼
    if (!SAFE_BTN.test(label) || UNSAFE_BTN.test(label)) continue;
    if (forb.some((re) => re.test(label) || re.test(b.sel))) continue;
    // 이름 다듬기: searchBtn → "조회", btnDeptSearch → "Dept Search" (결과표에 그대로 찍힌다)
    const name = /^(searchbtn|btnsearch|search|srchbtn|btnsrch|inquirybtn|btninquiry)$/i.test(label)
      ? '조회'
      : clean(label.replace(/^btn[_-]?/i, '').replace(/[_-]?btn$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')) || label;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, click: b.sel });
    if (out.length >= 6) break;                               // 화면당 6개까지
  }
  return out;
}

// ---------- 시나리오 초안 ----------
/** 스캔 결과 → 시나리오 JSON 초안. picked 를 주면 그 인덱스의 메뉴만 넣는다 */
export function toScenario(r, opts = {}) {
  const menus = (opts.picked ? opts.picked.map((i) => r.menus[i]).filter(Boolean) : r.menus).map((m) => {
    const o = { name: m.name, url: m.url };
    if (opts.expect !== false && m.expect?.length) o.expect = [m.expect[0].sel];
    o._출처 = `${SRC_LABEL[m.source] || m.source} — ${(m.evidence || []).slice(0, 2).map((e) => `${e.file}:${e.line}`).join(', ')}`;
    if (m.detailCandidate) o._상세후보 = `${m.detailCandidate.selector}${m.detailCandidate.dblclick ? ' (더블클릭)' : ''} — ${m.detailCandidate.why}. 행 클릭이 데이터를 바꾸지 않는지 확인한 뒤 detail 로 옮기세요`;
    // 화면의 버튼 목록 (⚠ 는 금지 버튼에 걸리는 것 — 실행 중 차단된다)
    if (m.buttons?.length) o._버튼 = m.buttons.map((b) => `${b.danger ? '⚠' : ''}${b.label}(${b.sel})`).join(' · ');
    // 버튼 동작 검사: opts.actions 면 실제 검사 항목(actions)으로, 아니면 후보 메모로만
    const acts = safeActions(m.buttons || [], r.forbidden.map((d) => d.word));
    if (acts.length) {
      if (opts.actions) o.actions = acts;
      else o._액션후보 = `누르면 데이터가 안 바뀌는 버튼: ${acts.map((a) => `${a.name}(${a.click})`).join(' · ')} → actions 로 옮기면 눌러서 동작까지 검사한다`;
    }
    return o;
  });
  const sc = {
    name: opts.name || r.name,
    _생성정보: `소스 스캔 ${new Date().toLocaleString()} — ${r.root} (초안입니다. 첫 실행 뒤 다듬으세요)`,
    baseUrl: r.baseUrl.value,
    browser: { channel: 'chrome' },
    timeout: 15000,
    evidence: { screenshotAll: true },
    forbidden: r.forbidden.map((d) => d.word),
  };
  if (r.login.found) {
    sc._comment_login = `로그인 화면: ${r.login.file}:${r.login.line}${r.login.todo.length ? ` — 확인 필요: ${r.login.todo.join(' / ')}` : ''}`;
    sc.login = { url: r.login.url, steps: r.login.steps };
    if (Object.keys(r.login.success || {}).length) sc.login.success = r.login.success;
    if (r.login.detect) sc.login.detect = r.login.detect;   // 이 요소가 아직 보이면 로그인 실패
  }
  const labels = {};
  for (const i of r.inputsCommon) labels[i.key] = i.label;
  if (Object.keys(labels).length || r.searchSel) {
    sc.inputs = {};
    if (r.searchSel) sc.inputs.search = r.searchSel;
    if (Object.keys(labels).length) sc.inputs.labels = labels;
    sc._todo_inputs = `조회 조건 후보(여러 화면에 반복): ${r.inputsCommon.slice(0, 8).map((i) => `${i.key}(${i.label})`).join(', ')}. 값은 직접 채워 inputs.common 에 넣으세요 — 날짜 형식·기간 제한을 확인할 것`;
  }
  sc._comment_menus = `소스 스캔으로 뽑은 초안 (${menus.length}개). 출처는 각 메뉴의 _출처, 제외된 항목·근거는 소스분석 보고서 참고. 팝업 전용·발송 화면은 지우고, expect 는 첫 실행 결과로 확인하세요`;
  const withActions = menus.filter((m) => m.actions).length;
  if (withActions) sc._comment_actions = `버튼 동작 검사(actions) ${withActions}개 화면 — 조회·검색·초기화처럼 데이터를 바꾸지 않는 버튼만 넣었습니다. 눌러서 "에러 없이 반응하는지"를 화면마다 별도 항목으로 검사합니다. 저장·삭제·발송 버튼은 forbidden 이 막습니다`;
  sc.menus = menus;
  return sc;
}

// ---------- 소스분석 보고서 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CONF = { high: '높음', mid: '중간', low: '낮음' };
const SRC_LABEL = { 'menu-sql': '메뉴 테이블', 'menu-jsp': '메뉴 화면', controller: '컨트롤러', struts: 'struts', 'spring-xml': 'Spring XML' };

export function renderSourceReport(r, opts = {}) {
  const ev = (m) => (m.evidence || []).slice(0, 3).map((e) => `${e.file}:${e.line}${e.what ? ` (${e.what})` : ''}`).join('<br>');
  const rows = r.menus.map((m, i) => `<tr class="${m.risky ? 'warn' : ''}">
    <td>${i + 1}</td><td>${esc(m.name)}</td><td class="url" title="${esc(m.url)}">${esc(m.url)}</td>
    <td>${esc(SRC_LABEL[m.source] || m.source)}</td><td class="c${m.confidence}">${CONF[m.confidence] || m.confidence}</td>
    <td class="mono">${m.expect?.length ? esc(m.expect[0].sel) : '<span class="muted">-</span>'}</td>
    <td class="mono small">${ev(m)}</td></tr>`).join('');
  const skipRows = r.skipped.slice(0, 200).map((s) => `<tr><td>${esc(s.name || '-')}</td><td class="url">${esc(s.url || '')}</td><td>${esc(s.why)}</td><td class="mono small">${s.file ? esc(`${s.file}:${s.line || ''}`) : ''}</td></tr>`).join('');
  const dangerRows = r.forbidden.map((d) => `<tr><td>${esc(d.word)}</td><td class="num">${d.count}</td><td class="mono small">${d.sample ? esc(`${d.sample.file}:${d.sample.line}`) : ''}</td><td>${esc(d.sample?.text || '')}</td></tr>`).join('');
  const inputRows = r.inputsCommon.map((i) => `<tr><td>${esc(i.label || '-')}</td><td class="mono">${esc(i.key)}</td><td class="num">${i.screens}</td><td>${i.date ? '날짜' : ''}${i.readonly ? ' readonly' : ''}</td></tr>`).join('');
  const detailRows = r.menus.filter((m) => m.detailCandidate).map((m) => `<tr><td>${esc(m.name)}</td><td class="mono">${esc(m.detailCandidate.selector)}</td><td>${m.detailCandidate.dblclick ? '더블클릭' : '클릭'}</td><td class="mono small">${esc(m.viewFile || '')}:${m.detailCandidate.line}</td></tr>`).join('');
  const btnRows = r.menus.filter((m) => m.buttons?.length).map((m) => `<tr><td>${esc(m.name)}</td><td>${m.buttons.map((b) => `<span class="tag${b.danger ? ' danger' : ''}" title="${esc(m.viewFile || '')}:${b.line}">${b.danger ? '⚠ ' : ''}${esc(b.label)}</span>`).join(' ')}</td><td class="mono small">${m.buttons.map((b) => esc(b.sel)).join(', ')}</td></tr>`).join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>소스 분석 — ${esc(r.name)}</title>
<style>
  body{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:24px;color:#222;background:#fafafa}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin-bottom:16px;font-size:13px}
  h2{font-size:17px;margin:26px 0 8px} h2 small{font-weight:normal;color:#888;font-size:12px}
  table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
  th{background:#f0f0f0;white-space:nowrap} tr.warn td{background:#fffbea}
  td.url{font-family:monospace;font-size:12px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  td.mono,.mono{font-family:Consolas,monospace} .small{font-size:11px;color:#666} td.num{text-align:right}
  .chigh{color:#197;font-weight:bold} .cmid{color:#a70} .clow{color:#999}
  .tag{display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;border:1px solid #ccc;background:#f4f4f4;color:#444;white-space:nowrap;margin:1px}
  .tag.danger{background:#fde8e8;border-color:#e2a0a0;color:#a11}
  .muted{color:#999}
  .sum{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 18px}
  .sum span{border:1px solid #ccc;background:#fff;border-radius:14px;padding:4px 12px;font-size:13px}
  .warnbox{background:#fff8e1;border:1px solid #e0c060;border-radius:6px;padding:10px 14px;margin:12px 0;font-size:13px}
  .warnbox li{margin:3px 0}
  .next{background:#eef4ff;border:1px solid #a9c0e8;border-radius:6px;padding:10px 14px;font-size:13px}
  code{background:#f0f0f0;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>📂 소스 분석 — ${esc(r.name)}</h1>
<div class="sub">${esc(r.root)} · ${new Date(r.ranAt).toLocaleString()} · ${(r.ms / 1000).toFixed(1)}초 · 파일 ${r.stats.files}개(java ${r.stats.java} / jsp ${r.stats.jsp} / xml ${r.stats.xml} / sql ${r.stats.sql})</div>
<div class="sum">
  <span>메뉴 후보 <b>${r.menus.length}</b></span>
  <span>제외 <b>${r.skipped.length}</b></span>
  <span>금지 버튼 후보 <b>${r.forbidden.length}</b></span>
  <span>조회 조건 후보 <b>${r.inputsCommon.length}</b></span>
  <span>접속 URL <b>${esc(r.baseUrl.value)}</b>${r.baseUrl.guessed ? ' <small>(추정)</small>' : ''}</span>
  <span>로그인 ${r.login.found ? `<b>${esc(r.login.url)}</b>` : '<b>못 찾음</b>'}</span>
</div>
${r.warnings.length ? `<div class="warnbox"><b>확인할 것</b><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

<h2>메뉴 후보 <small>확신도: 메뉴 테이블 &gt; 메뉴 화면 &gt; 컨트롤러 순. URL 은 baseUrl 기준 상대 경로</small></h2>
<table><thead><tr><th>#</th><th>이름</th><th>URL</th><th>출처</th><th>확신도</th><th>expect 후보</th><th>근거(파일:줄)</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" class="muted">없음</td></tr>'}</tbody></table>

<h2>접속 URL 근거</h2>
<table><thead><tr><th>값</th><th>근거</th></tr></thead><tbody>
${r.baseUrl.evidence.map((e) => `<tr><td>${esc(e.what)}</td><td class="mono small">${esc(e.file)}:${e.line} — ${esc(e.text)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">근거 없음 (기본값 8080)</td></tr>'}
</tbody></table>

<h2>로그인</h2>
${r.login.found ? `<table><tbody>
<tr><th>화면</th><td class="mono small">${esc(r.login.file)}:${r.login.line}</td></tr>
<tr><th>URL</th><td class="mono">${esc(r.login.url)}</td></tr>
<tr><th>아이디</th><td class="mono">${esc(r.login.fields.id || '못 찾음')}</td></tr>
<tr><th>비밀번호</th><td class="mono">${esc(r.login.fields.pw || '못 찾음')}</td></tr>
<tr><th>버튼</th><td class="mono">${esc(r.login.fields.button || '못 찾음')}</td></tr>
<tr><th>form action</th><td class="mono">${esc(r.login.fields.action || '-')}</td></tr>
${r.login.todo.length ? `<tr><th>확인</th><td>${r.login.todo.map(esc).join('<br>')}</td></tr>` : ''}
</tbody></table>` : `<p class="muted">${esc(r.login.why || '못 찾음')}</p>`}

<h2>금지 버튼 후보 <small>소스에서 발견된 위험 단어. 시나리오 forbidden 에 들어갑니다</small></h2>
<table><thead><tr><th>단어</th><th>횟수</th><th>예시 위치</th><th>예시 문구</th></tr></thead>
<tbody>${dangerRows || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table>

<h2>조회 조건 후보 <small>여러 화면에 반복되는 입력란. 값은 직접 채워 <code>inputs.common</code> 에 넣으세요</small></h2>
<table><thead><tr><th>설명</th><th>필드</th><th>화면 수</th><th>비고</th></tr></thead>
<tbody>${inputRows || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table>
${r.searchSel ? `<p class="small">조회 버튼 후보: <code>${esc(r.searchSel)}</code></p>` : ''}

${btnRows ? `<h2>화면별 버튼 <small>클릭 스텝은 만들지 않았습니다 — 누르면 데이터가 바뀌고, 성공 판정을 소스에서 정할 수 없기 때문입니다. CRUD 흐름(⏺ 녹화)을 만들 때 여기서 고르세요. ⚠ 는 금지 버튼(forbidden)에 걸려 실행 중 차단됩니다</small></h2>
<table><thead><tr><th style="width:26%">메뉴</th><th>버튼</th><th style="width:30%">셀렉터</th></tr></thead><tbody>${btnRows}</tbody></table>` : ''}

${detailRows ? `<h2>목록 → 상세 후보 <small>행 클릭이 데이터를 바꾸는 화면이 있어 자동으로 넣지 않았습니다. 확인 후 <code>detail</code> 로 옮기세요</small></h2>
<table><thead><tr><th>메뉴</th><th>행 셀렉터</th><th>여는 법</th><th>근거</th></tr></thead><tbody>${detailRows}</tbody></table>` : ''}

<h2>제외한 것 <small>${r.skipped.length}건${r.skipped.length > 200 ? ' 중 200건' : ''}</small></h2>
<table><thead><tr><th>이름</th><th>URL</th><th>이유</th><th>위치</th></tr></thead>
<tbody>${skipRows || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table>

<div class="next" style="margin-top:24px"><b>다음 단계</b>
<ol>
<li>위 표에서 아닌 메뉴(팝업 전용·발송·개발용 화면)를 지운다</li>
<li><code>run.bat lint &lt;시나리오&gt;</code> 로 검사 → <code>--only &lt;메뉴 하나&gt;</code> 로 로그인부터 확인</li>
<li>전체 실행 후 보고서의 ❌ 를 <b>서버 버그 / 시나리오 오류(셀렉터·expect) / 환경 노이즈</b> 로 나눈다</li>
<li>소스에 없는 메뉴(권한별·JS 로 그리는 메뉴)는 <b>🔍 화면에서 메뉴 수집(discover)</b> 로 보완한다</li>
</ol></div>
</body></html>`;
}

/** 보고서 + 원본 JSON 을 outDir 에 쓴다 → { html, json } */
export function writeSourceReport(r, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const html = path.join(outDir, 'source-scan.html');
  const json = path.join(outDir, 'source-scan.json');
  fs.writeFileSync(html, renderSourceReport(r), 'utf8');
  fs.writeFileSync(json, JSON.stringify(r, null, 2), 'utf8');
  return { html, json };
}
