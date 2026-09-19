import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCollector, inspectPage, compileIgnore, onScreen } from './checks.js';
import { writeReport } from './report.js';
import { findPrevReport, buildCompare, compareLine, readReportJson } from './compare.js';
import { triage } from './triage.js';
import { withDefaults } from './config.js';
import { makeDynamic } from './vars.js';
import { startStub } from './stub-server.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 예상된 실패(expectFail): 이 항목은 "막혀야/실패해야 정상" 이라고 선언한 것. true=모든 실패, 문자열/배열=그 정규식에 맞는 실패만.
const expectFailPatterns = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x)
  .map((p) => { try { return new RegExp(p, 'i'); } catch { return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } });
const expectFailLabel = (v) => (v === true ? '모든 실패' : (Array.isArray(v) ? v.join(', ') : String(v)));

// 브라우저 기동 순서: 시나리오 channel → 시스템 Chrome → 시스템 Edge → 동봉 Chromium
// (Windows 는 Edge 가 기본 내장이라 브라우저를 동봉하지 않아도 동작)
async function launchBrowser(sc, headless, log) {
  // chromiumSandbox: Playwright 기본은 false 라 --no-sandbox 가 붙어 "지원되지 않는 명령줄 플래그" 경고가 뜸 → 켠다
  const base = { headless, slowMo: sc.browser?.slowMo ?? 0, chromiumSandbox: true };
  const order = [...new Set([sc.browser?.channel, 'chrome', 'msedge'].filter(Boolean))];
  const errors = [];
  for (const channel of order) {
    try { return await chromium.launch({ ...base, channel }); }
    catch (e) { errors.push(`${channel}: ${e.message.split('\n')[0]}`); }
  }
  // 동봉 Chromium: headless 는 새 헤드리스 모드(channel 'chromium') 로 → headless-shell 불필요
  try { return await chromium.launch({ ...base, channel: 'chromium' }); }
  catch (e) { errors.push(`chromium: ${e.message.split('\n')[0]}`); }
  try { return await chromium.launch(base); }
  catch (e) { errors.push(`bundled: ${e.message.split('\n')[0]}`); }
  log('브라우저를 찾지 못했습니다:\n  ' + errors.join('\n  '));
  throw new Error('실행할 브라우저 없음 — Chrome/Edge 를 설치하거나 브라우저 동봉 번들(bundle.mjs --browser)을 사용하세요');
}

/**
 * opt: { headless, only, onlyList(이름 배열 — 실패건만 재실행), skipMenus, skipCrawl, skipCrud,
 *        screenshot('all'|'fail'|'none'|undefined=시나리오 설정), outDir,
 *        compare(false 면 직전 실행 비교 안 함), compareWith(기준 증적 폴더 경로),
 *        log(msg), onResult(r), onProgress({done,total,pct,current}), isCancelled() }
 */
export async function runScenario(sc, opt) {
  // 전역 설정(config.json)의 순회 속도 등 기본값을 채운다. 시나리오가 정한 값은 그대로 우선.
  sc = withDefaults(sc);
  const log = opt.log || ((m) => console.log(m));
  const cancelled = opt.isCancelled || (() => false);
  // {{이름}} 자리표시자 치환 우선순위: 실행 시 입력(secrets) > 시나리오 테스트 데이터(vars) > 동적 토큰(today/now/rand/seq…)
  //   secrets: 비밀번호 등 파일에 안 남기는 값 · vars: 재사용 목업 데이터 · 동적 토큰: 실행마다 달라지는 값(등록 중복키 방지)
  const secrets = opt.secrets || {};
  const vars = (sc.vars && typeof sc.vars === 'object') ? sc.vars : {};
  const dyn = makeDynamic();
  const sub = (v) => String(v ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => {
    if (secrets[k] !== undefined) return secrets[k];
    if (vars[k] !== undefined) return String(vars[k]);
    const dv = dyn.get(k); if (dv !== undefined) return dv;
    throw new Error(`실행 시 입력값 누락: {{${k}}}`);
  });

  // 실행마다 증적 폴더 하나: reports/<시나리오명>-<시각>/ { report.html, report.md, report.json, screenshots/ }
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const safe = (s) => String(s).replace(/[^\w가-힣-]+/g, '_');
  const outDir = path.join(opt.outDir, `${safe(sc.name || 'scenario')}-${stamp}`);
  const shotDir = path.join(outDir, 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  // 증적 캡처 모드: 실행 옵션(opt.screenshot) > 시나리오 evidence.screenshotAll(명시) > 전체 설정 기본(sc.screenshot) > 'all'
  //   all  : 모든 화면    fail : 실패한 화면만    none : 캡처 안 함
  // 항목별 "screenshot": true/false 가 있으면 그 항목은 전역 모드보다 우선 (true=항상, false=절대 안 찍음)
  const validShot = (v) => ['all', 'fail', 'none'].includes(v);
  const scHasEvidence = sc.evidence && 'screenshotAll' in sc.evidence;
  const shotMode = validShot(opt.screenshot) ? opt.screenshot
    : scHasEvidence ? (sc.evidence.screenshotAll === false ? 'fail' : 'all')
    : validShot(sc.screenshot) ? sc.screenshot
    : 'all';
  const wantShot = (item, failed) => {
    if (item?.screenshot === true) return true;
    if (item?.screenshot === false) return false;
    return shotMode === 'all' || (shotMode === 'fail' && failed);
  };
  let shotSeq = 0;

  const ignore = compileIgnore(sc.ignore);
  // 사이트별 추가 판정: errorPatterns(본문 정규식) / errorStatus(업무오류 상태코드) / login.detect(로그인 화면 요소)
  // checks: 깨진 화면 검사 (images 기본 켬 / layout=가로 스크롤 기본 끔 — 사이트에 따라 노이즈가 많아 선택 사항)
  // emptyWait: 화면이 비어 보일 때 다시 읽어 보는 시간(ms). 느린 화면이면 늘린다
  const inspectOpts = { errorPatterns: sc.errorPatterns || [], errorStatus: sc.errorStatus || [], loginDetect: sc.login?.detect || null, checks: sc.checks || {}, ...(sc.emptyWait !== undefined ? { emptyWait: sc.emptyWait } : {}) };
  const browser = await launchBrowser(sc, opt.headless || !!sc.browser?.headless, log);
  // ---------- 로그인 세션 재사용 (storageState) ----------
  // reuseSession: 켜면 최초 로그인 뒤 쿠키/스토리지를 .sessions/ 에 저장, 다음 실행/시나리오에서 재사용(만료면 자동 재로그인).
  //   같은 baseUrl + 로그인 아이디끼리 공유 → 일괄 실행 속도 ↑, 로그인 반복 ↓(계정 잠금·스캐닝 오인 감소).
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SESSION_DIR = path.join(ROOT, '.sessions');
  const reuseSession = !!sc.reuseSession;
  const loginId = sc.login ? (sc.login.steps || []).find((s) => (s.action === 'fill' || s.action === 'type') && (!sc.login.userField || s.selector === sc.login.userField))?.value : '';
  const sessionFile = reuseSession && sc.login ? path.join(SESSION_DIR, crypto.createHash('md5').update(`${sc.baseUrl}|${loginId || ''}`).digest('hex') + '.json') : null;
  const haveSession = !!(sessionFile && fs.existsSync(sessionFile));
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: sc.browser?.viewport ?? { width: 1400, height: 900 },
    ...(haveSession ? { storageState: sessionFile } : {}),
  });
  const saveSession = async () => { if (!sessionFile) return; try { fs.mkdirSync(SESSION_DIR, { recursive: true }); await context.storageState({ path: sessionFile }); } catch { /* 저장 실패 무시 */ } };
  context.setDefaultTimeout(sc.timeout ?? 10000);

  // ---------- 인터페이스 목업 (외부 호출 가로채기) ----------
  // sc.mocks: [{ url, method?, status?, json?, body?, contentType?, headers?, abort?, delayMs? }]
  //   연동이 안 되는 환경에서, 대상 시스템이 부르는 외부 서비스 호출을 실제로 타지 않고 지정한 값으로 바로 응답시킨다.
  //   url: 부분일치(그냥 문자열) · 글로벌 패턴(* ** 포함) · 정규식(`re:...`). body/json 안에서도 {{vars}}·동적 토큰 치환.
  const toMatcher = (u) => {
    if (typeof u !== 'string') return '**';
    if (u.startsWith('re:')) { try { return new RegExp(u.slice(3)); } catch { return u; } }
    return /[*?]/.test(u) ? u : `**${u}**`; // * 없으면 부분일치로
  };
  for (const m of (Array.isArray(sc.mocks) ? sc.mocks : [])) {
    if (!m || !m.url) continue;
    await context.route(toMatcher(m.url), async (route, req) => {
      try {
        // 교차 출처 목업도 브라우저가 받도록 CORS 허용 + 프리플라이트(OPTIONS) 응답
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*', ...(m.headers || {}) };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (m.method && req.method().toUpperCase() !== String(m.method).toUpperCase()) return route.continue();
        if (m.delayMs) await sleep(Number(m.delayMs) || 0);
        if (m.abort) return route.abort();
        const body = m.json !== undefined ? sub(JSON.stringify(m.json)) : sub(m.body ?? '');
        const contentType = m.contentType || (m.json !== undefined ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
        await route.fulfill({ status: Number(m.status) || 200, contentType, body, headers: cors });
      } catch { try { await route.continue(); } catch { /* 이미 처리됨 */ } }
    });
  }
  if (Array.isArray(sc.mocks) && sc.mocks.length) log(`인터페이스 목업 ${sc.mocks.length}건 가로채기 등록`);

  // ---------- 서버 stub (백엔드가 부르는 외부 연동 목업) ----------
  // sc.stubServer: { port, routes:[...] }. 실행 동안 실제 HTTP 서버로 떠서, 대상 앱이 그 주소로 부르면 지정 응답을 준다.
  // (대상 앱이 이 stub 을 보도록 설정/hosts 로 연결하는 건 환경 세팅 — 도구 밖)
  let stub = null;
  // enabled:false 면 끈다 (로컬=목업 ON / 개발·운영=실제 OFF 를 프로젝트 단위로 토글)
  if (sc.stubServer && sc.stubServer.enabled !== false && Array.isArray(sc.stubServer.routes) && sc.stubServer.routes.length) {
    try { stub = await startStub({ ...sc.stubServer, vars }, { log, vars }); }
    catch (e) { log(`(stub 서버 시작 실패: ${e.message.split('\n')[0]} — 포트 ${sc.stubServer.port || 9900} 사용 중일 수 있음)`); }
  }

  const page = await context.newPage();
  const collector = createCollector(page, ignore);
  const dialogs = [];
  const forbiddenAll = (sc.forbidden || []).map((s) => new RegExp(s, 'i'));
  // ---------- 다이얼로그(alert/confirm) 처리 ----------
  // 로그인·CRUD 흐름: 지금처럼 자동 확인(수락).
  // 메뉴 순회(화면·버튼 동작 검사·상세 진입·자동 수집): confirm/prompt 는 **취소**한다 — 행 클릭이나 아이콘 버튼이 띄운
  //   "삭제하시겠습니까?" 에 확인을 눌러 실데이터가 바뀌는 사고를 막는다. 메시지가 forbidden 에 걸리면 ❌ 로 남긴다.
  //   조회만 하는 confirm 이라 눌러야 하면 시나리오/메뉴/버튼/상세에 "confirm": "accept".
  let safeDialogs = false;
  const blockedDialogs = [];
  const safeOf = (...items) => { for (const i of items) if (i && typeof i === 'object' && i.confirm) return i.confirm !== 'accept'; return sc.confirm !== 'accept'; };
  const onDialog = async (d) => {
    const type = d.type(), text = d.message();
    const dismiss = safeDialogs && (type === 'confirm' || type === 'prompt');
    if (dismiss && forbiddenAll.some((re) => re.test(text))) blockedDialogs.push(`${type}: ${text}`);
    else if (!ignore.test('dialogs', text)) dialogs.push(`${type}: ${text}${dismiss ? ' [취소함]' : ''}`);
    // 처리 중 페이지가 이동/닫히면 무시 (미처리 예외로 프로세스가 죽지 않게)
    await (dismiss ? d.dismiss() : d.accept()).catch(() => {});
  };
  page.on('dialog', onDialog);
  // 취소한 금지 확인창 → 실패 이슈로 (꺼내면서 비운다)
  const blockedIssues = () => blockedDialogs.splice(0).map((b) => ({ level: 'fail', msg: `금지 동작 확인창 차단(취소함): "${b}"` }));
  // 이벤트 핸들러 등에서 새는 예외가 실행 전체를 죽이지 않도록
  const onRej = (e) => log(`(경고) 처리되지 않은 예외: ${String(e?.message || e).split('\n')[0]}`);
  process.on('unhandledRejection', onRej);

  const results = [];

  // ---------- 진행률 ----------
  // 전체 항목 수 = 로그인 + 메뉴(+상세 진입 예정 건수) + CRUD. 자동 수집 링크는 수집된 시점에 더해진다.
  const onlyRe = opt.only ? new RegExp(opt.only, 'i') : null;
  // onlyList: 이름 정확히 일치하는 항목만 (직전 실행의 실패건만 재실행할 때 사용)
  const onlySet = Array.isArray(opt.onlyList) && opt.onlyList.length ? new Set(opt.onlyList) : null;
  const pick = (name) => (!onlyRe || onlyRe.test(name)) && (!onlySet || onlySet.has(name));
  const detailRows = (m) => (m.detail ? Math.max(1, (typeof m.detail === 'string' ? 1 : m.detail.rows) ?? 1) : 0);
  const actionCount = (m) => (Array.isArray(m.actions) ? m.actions.filter((a) => a && !a.skip).length : 0);
  const menuList = !opt.skipMenus && Array.isArray(sc.menus) ? sc.menus.filter((m) => pick(m.name)) : [];
  const crudList = !opt.skipCrud && Array.isArray(sc.crud) ? sc.crud.filter((f) => pick(f.name)) : [];
  if (onlySet) log(`▶ 재실행 대상 ${menuList.length + crudList.length}개 (직전 실행 실패 ${onlySet.size}건 기준)`);
  const progress = { done: 0, total: (sc.login ? 1 : 0) + menuList.reduce((n, m) => n + 1 + detailRows(m) + actionCount(m), 0) + crudList.length, current: '' };
  const pct = () => (progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0);
  const report = (current) => { progress.current = current; opt.onProgress?.({ done: progress.done, total: progress.total, pct: pct(), current }); };
  let itemStart = Date.now();                 // 항목 소요시간 측정 시작점 (push 때마다 갱신)
  const begin = (name) => { itemStart = Date.now(); report(name); };
  const slowMs = Number(sc.slowMs ?? 0);      // 이 시간을 넘으면 ⚠️ 느린 화면
  // baseUrl 에 컨텍스트 경로(/voc 등)가 있어도 유지: '/screen/x' → baseUrl + '/screen/x'
  const base = String(sc.baseUrl).replace(/\/+$/, '');
  const abs = (u) => (/^https?:/i.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u));
  // ---------- 느린 화면(무거운 쿼리·늦게 그려지는 그리드) 대응 ----------
  // timeout: 항목별 > 시나리오 (기본 10초)
  // expectTimeout: 핵심 요소를 기다리는 시간 (기본 timeout 의 절반, 최소 3초)
  // loading: 로딩 표시 셀렉터 — 이게 사라질 때까지 기다린 뒤 화면을 판정한다
  // slowFactor: 재시도(2차 이후)에는 대기 시간을 배로 늘려 "느려서 실패한 것"을 구제한다
  const baseTimeout = Number(sc.timeout ?? 10000);
  let slowFactor = 1;
  const tmoOf = (item) => Number(item?.timeout ?? baseTimeout) * slowFactor;
  const expectTmoOf = (item) => Number(item?.expectTimeout ?? sc.expectTimeout ?? Math.max(3000, baseTimeout / 2)) * slowFactor;
  const loadingAll = [].concat(sc.loading || []).filter(Boolean);
  // 로딩 레이어가 사라지고, waitFor 로 지정한 요소가 나타날 때까지 대기 (없으면 그냥 지나감)
  const waitReady = async (item, target = page) => {
    const t = tmoOf(item);
    const frames = typeof target.frames === 'function' ? target.frames() : [target];
    for (const sel of [...loadingAll, ...[].concat(item?.loading || []).filter(Boolean)]) {
      for (const f of frames) {
        try { if (await f.locator(sel).first().isVisible({ timeout: 200 })) await f.locator(sel).first().waitFor({ state: 'hidden', timeout: t }).catch(() => {}); } catch { /* ignore */ }
      }
    }
    const wf = [].concat(item?.waitFor || []).filter(Boolean);
    for (const sel of wf) {
      const ok = (await Promise.all(frames.map((f) => f.locator(sel).first().waitFor({ state: 'visible', timeout: t }).then(() => true).catch(() => false)))).some(Boolean);
      if (!ok) log(`  (대기) ${sel} 이(가) ${Math.round(t / 1000)}초 안에 안 나타남 — 계속 진행`);
    }
  };

  // ---------- 개인정보 가림(마스킹) ----------
  // sc.mask (전 화면 공통) + 항목별 mask 의 셀렉터를, 캡처 직전에 모든 프레임에 스타일을 넣어 덮는다.
  // Playwright 의 screenshot({mask}) 는 iframe 안까지 못 가려서 CSS 주입 방식을 쓴다. 캡처 후 원상복구.
  const maskAll = (sc.mask || []).filter(Boolean);
  const maskOf = (item, extra) => [...new Set([...maskAll, ...(item?.mask || []), ...(extra || [])])].filter(Boolean);
  const maskColor = sc.maskColor || '#9aa3af';
  const applyMask = async (target, sels) => {
    if (!sels.length) return async () => {};
    const css = sels.map((s) => `${s}{color:transparent!important;text-shadow:none!important;background-image:none!important;background-color:${maskColor}!important;border-radius:2px!important}\n${s} *{visibility:hidden!important}`).join('\n');
    const frames = typeof target.frames === 'function' ? target.frames() : [target];
    const done = [];
    for (const f of frames) {
      try {
        await f.evaluate((c) => { const el = document.createElement('style'); el.id = '__wwt_mask'; el.textContent = c; (document.head || document.documentElement).appendChild(el); }, css);
        done.push(f);
      } catch { /* detached */ }
    }
    return async () => { for (const f of done) { try { await f.evaluate(() => document.getElementById('__wwt_mask')?.remove()); } catch { /* ignore */ } } };
  };
  // 스크린샷은 증적 폴더 기준 상대 경로로 반환 (보고서에서 그대로 링크)
  const shot = async (name, target = page, item, extraMask) => {
    const rel = path.join('screenshots', `${String(++shotSeq).padStart(3, '0')}-${safe(name)}.png`);
    const off = await applyMask(target, maskOf(item, extraMask));
    try { await target.screenshot({ path: path.join(outDir, rel), fullPage: true }); return rel; }
    catch { return null; }
    finally { await off(); }
  };
  // 결과 확정(소요시간·느린 화면·상태) → 기록. 재시도 중(capture)에는 모아 두었다가 확정된 시도만 기록한다.
  let capture = null;
  const finalize = (r) => {
    for (const i of r.issues) i.msg = String(i.msg).split('\n')[0].trim(); // Playwright 에러는 첫 줄만
    r.ms = Math.max(0, Date.now() - itemStart); itemStart = Date.now();
    if (slowMs && r.ms > slowMs && !r.error) r.issues.push({ level: 'warn', msg: `느린 화면: ${(r.ms / 1000).toFixed(1)}초 (기준 ${(slowMs / 1000).toFixed(1)}초)` });
    const hasFail = r.error || r.issues.some((i) => i.level === 'fail');
    // 예상된 실패 처리: "막혀야 정상"(expectFail)이라고 선언한 항목이 예상대로 실패했으면 ❌ 가 아니라 🔒(정상)로 본다.
    const ef = r.expectFail;
    if (ef != null && ef !== false) {
      if (hasFail) {
        const failMsgs = r.issues.filter((i) => i.level === 'fail').map((i) => i.msg);
        const pats = expectFailPatterns(ef);
        const matched = ef === true || pats.some((re) => failMsgs.some((m) => re.test(m)) || (r.error && re.test(String(r.step || ''))));
        if (matched) {
          for (const i of r.issues) if (i.level === 'fail') { i.level = 'expected'; i.msg = `예상된 실패(정상): ${i.msg}`; }
          r.error = false; r.expected = true; r.status = 'ok';
          return r;
        }
        r.issues.unshift({ level: 'warn', msg: `예상한 실패 사유(${expectFailLabel(ef)})와 다른 원인으로 실패 — 확인 필요` });
      } else {
        r.issues.push({ level: 'warn', msg: `예상과 달리 실패하지 않았습니다 (막혀야 정상 — expectFail: ${expectFailLabel(ef)})` });
        r.expectedMiss = true;
      }
    }
    const finalFail = r.error || r.issues.some((i) => i.level === 'fail');
    r.status = finalFail ? 'fail' : r.issues.length ? 'warn' : 'ok';
    return r;
  };
  const emit = (r) => {
    r.triage = triage(r) || undefined; // 규칙 기반 1차 분류 (서버 버그 / 시나리오 오류 의심 / 환경 노이즈 …)
    results.push(r);
    progress.done = Math.min(progress.total, progress.done + 1);
    log(`[${String(pct()).padStart(3)}%] ${r.expected ? '🔒' : r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'} ${r.name}${r.ms >= 1000 ? ` (${(r.ms / 1000).toFixed(1)}초)` : ''}${r.issues[0] ? ' — ' + r.issues[0].msg : ''}`);
    opt.onResult?.(r);
    report('');
  };
  const push = (r) => { finalize(r); if (capture) capture.push(r); else emit(r); };
  // 불안정(flaky) 대비 재시도: 실패하면 그 항목만 다시 실행하고, 나중 시도에서 정상이면 ❌ 가 아니라 ⚠️ 불안정으로 남긴다.
  // runOnce 는 스스로 push 까지 한다 (실패도 push). 중단(cancelled)은 그대로 위로 던진다.
  const withRetry = async (attempts, label, runOnce) => {
    let got = [], why = '', firstFail = []; // firstFail: 1차 실패 시도의 결과(증적 스크린샷을 물려주기 위해)
    for (let a = 1; a <= attempts; a++) {
      capture = [];
      slowFactor = a; // 재시도할수록 대기 시간을 늘린다 (느려서 실패한 화면 구제)
      try { await runOnce(); }
      catch (e) { const partial = capture || []; capture = null; partial.forEach(emit); throw e; } // 중단 등 — 지금까지의 결과는 남긴다
      got = capture; capture = null;
      const failed = got.filter((r) => r.status === 'fail');
      if (!failed.length) {
        if (a > 1) got.forEach((r, i) => {
          const shot = firstFail[i]?.screenshot;
          if (shot && !r.screenshot) r.screenshot = shot; // 성공 화면 대신 실패 시점 화면을 증적으로
          r.flaky = true; r.status = 'warn';
          r.issues.unshift({ level: 'warn', msg: `불안정(flaky): ${a - 1}차 시도 실패 → ${a}차 정상 — 1차 실패 사유 "${why}"${shot ? ' (증적은 실패 시점 화면)' : ''}` });
        });
        break;
      }
      if (!why) { why = failed[0].issues.find((i) => i.level === 'fail')?.msg || ''; firstFail = got; }
      if (a === attempts) { if (attempts > 1) for (const r of got) r.retried = attempts; break; }
      log(`  ↻ ${label} 재시도 ${a + 1}/${attempts} (실패: ${why.slice(0, 60)}) — 대기 시간 ${a + 1}배로`);
    }
    slowFactor = 1;
    got.forEach(emit);
    return got;
  };
  const stop = () => { const e = new Error('사용자 중단'); e.cancelled = true; throw e; };

  // ---------- 금지 버튼 판정 (스텝 click / 버튼 동작 검사 / 상세 행 클릭 공용) ----------
  // 글자가 없는 아이콘 버튼도 걸리도록 text·title·value·aria-label·alt(안쪽 img 포함)·id·name 을 모두 본다.
  // extra: 시나리오에 적은 text·셀렉터·이름.  allow: 이 흐름/버튼에서만 풀어 줄 패턴(allowForbidden)
  // 반환: 막아야 하면 화면에 보여 줄 라벨, 아니면 null
  const clickLabels = async (l) => (await l.evaluate((el) => {
    const out = [el.innerText || el.textContent || ''];
    for (const n of [el, ...el.querySelectorAll('img, [title], [aria-label]')]) {
      for (const a of ['title', 'value', 'aria-label', 'alt']) { const v = n.getAttribute && n.getAttribute(a); if (v) out.push(v); }
    }
    out.push(el.id || '', el.getAttribute('name') || '');
    return out;
  }).catch(() => [])).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const forbiddenHit = async (l, extra = [], allow = []) => {
    const allowRe = allow.map((s) => new RegExp(s, 'i'));
    const labels = [...(await clickLabels(l)), ...extra.map((x) => String(x || '')).filter(Boolean)];
    if (allowRe.some((a) => labels.some((t) => a.test(t)))) return null;
    const hit = forbiddenAll.filter((re) => !allowRe.some((a) => a.source === re.source)).find((re) => labels.some((t) => re.test(t)));
    return hit ? (labels[0] || hit.source) : null;
  };

  // ---------- 스텝 실행기 (login / crud 공용) ----------
  // allow: 이 흐름에서만 금지 해제할 버튼 텍스트 (flow.allowForbidden)
  const runSteps = async (steps, label, allow = []) => {
    let target = page;       // Page | Frame
    let curPage = page;      // 팝업 전환용
    const trail = [];
    for (const [idx, s] of steps.entries()) {
      if (cancelled()) stop();
      const desc = `${idx + 1}. ${s.action} ${s.selector ?? s.url ?? s.text ?? ''}`.trim();
      trail.push(desc);
      const loc = () => {
        if (s.selector) return target.locator(s.selector).first();
        if (s.text) return target.getByText(s.text, { exact: !!s.exact }).first();
        if (s.role) return target.getByRole(s.role, { name: s.name }).first();
        throw new Error('selector/text/role 중 하나 필요');
      };
      try { await runOne(); } catch (e) { if (!e.trail) e.trail = trail; throw e; } // 실패 시 어디까지 갔는지 보고서에 남김
      if (s.action !== 'wait' && s.action !== 'waitFor') await sleep(sc.stepDelay ?? 300);
      continue;
      async function runOne() { switch (s.action) {
        case 'goto': await curPage.goto(abs(sub(s.url)), { waitUntil: 'domcontentloaded' }); target = curPage; break;
        case 'click': {
          const l = loc();
          const hit = await forbiddenHit(l, [s.text, s.name], allow);
          if (hit) throw new Error(`금지 버튼 클릭 차단: "${hit}"`);
          if (s.popup) {
            const [pop] = await Promise.all([curPage.waitForEvent('popup'), l.click()]);
            await pop.waitForLoadState('domcontentloaded');
            // 팝업 안의 alert/confirm 도 기록·자동 수락 (리스너가 없으면 Playwright 가 confirm 을 취소해 저장이 무산됨) — 2026-08-25
            pop.on('dialog', onDialog);
            curPage = pop; target = pop;
          } else await l.click();
          break;
        }
        case 'dblclick': await loc().dblclick(); break;
        case 'fill': await loc().fill(sub(s.value)); break;
        case 'type': await loc().pressSequentially(sub(s.value)); break;
        case 'select': await loc().selectOption(s.value); break;
        case 'check': await loc().setChecked(s.value !== false); break;
        case 'press': if (s.selector || s.text || s.role) await loc().press(s.key); else await curPage.keyboard.press(s.key); break;
        case 'frame': {
          target = s.name ? curPage.frame({ name: s.name }) : s.selector ? await curPage.locator(s.selector).first().contentFrame() : curPage;
          if (!target) throw new Error(`프레임 없음: ${s.name ?? s.selector}`);
          break;
        }
        case 'mainFrame': target = curPage; break;
        case 'closePopup': if (curPage !== page) { await curPage.close(); curPage = page; target = page; } break;
        case 'wait': await sleep(s.ms ?? 1000); break;
        case 'waitFor': await loc().waitFor({ state: s.state ?? 'visible', timeout: s.timeout }); break;
        case 'waitForLoad': await curPage.waitForLoadState(s.state ?? 'networkidle').catch(() => {}); break;
        case 'expectVisible': if (!(await loc().isVisible())) throw new Error(`보이지 않음: ${s.selector ?? s.text}`); break;
        case 'expectText': {
          const body = await target.evaluate(() => document.body.innerText).catch(() => ''); const t = sub(s.text);
          if (!body.includes(t)) throw new Error(`텍스트 없음: "${t}"`);
          break;
        }
        case 'expectNotText': {
          const body = await target.evaluate(() => document.body.innerText).catch(() => ''); const t = sub(s.text);
          if (body.includes(t)) throw new Error(`있으면 안 되는 텍스트: "${t}"`);
          break;
        }
        case 'expectUrl': { const c = sub(s.contains); if (!curPage.url().includes(c)) throw new Error(`URL 불일치: ${curPage.url()} (기대: *${c}*)`); break; }
        case 'expectDialog': {
          const t = sub(s.text);
          if (!dialogs.some((d) => d.includes(t))) throw new Error(`다이얼로그 없음: "${t}" (수신: ${dialogs.join(' | ') || '없음'})`);
          break;
        }
        case 'screenshot': if (shotMode !== 'none') await shot(`${label}-${s.name ?? idx}`, curPage, s); break;
        case 'eval': await target.evaluate(s.script); break;
        // 흐름 중 계정 전환: 로그아웃(쿠키 정리) → 같은 로그인 스텝을 다른 아이디로 재실행.
        // 결재 상신 → 승인 → 회신처럼 여러 역할이 이어지는 업무 흐름을 한 시나리오로 검증할 때 쓴다.
        case 'switchUser': {
          if (!sc.login) throw new Error('switchUser: 시나리오에 login 설정이 없습니다');
          const who = sub(s.user);
          if (!who) throw new Error('switchUser: user(아이디)가 없습니다');
          const logoutUrl = s.logout || sc.login.logoutUrl;
          if (logoutUrl) await curPage.goto(abs(logoutUrl), { waitUntil: 'domcontentloaded' }).catch(() => {});
          await context.clearCookies();
          if (curPage !== page) { await curPage.close().catch(() => {}); curPage = page; } // 팝업이 열려 있으면 닫고 본 창으로
          target = page;
          const { why, attempt } = await doLogin({ user: who, password: s.password ? sub(s.password) : undefined }, `계정 전환(${who})`);
          if (why) throw new Error(`계정 전환 실패 (${who}): ${why}${attempt > 1 ? ` (${attempt}회 시도)` : ''}`);
          log(`  👤 계정 전환: ${who}`);
          trail[trail.length - 1] = `${idx + 1}. 계정 전환 → ${who}`;
          if (s.url) { await page.goto(abs(s.url), { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle').catch(() => {}); }
          break;
        }
        case 'note': break; // 주석용
        default: throw new Error(`알 수 없는 action: ${s.action}`);
      } }
    }
    return { trail, curPage };
  };

  // extra: { expect, status, path, item(증적 설정 참조용), target(검사할 Page, 기본 page), collector(팝업용), issues(추가 이슈) }
  const finishPage = async (name, url, extra = {}) => {
    const tp = extra.target || page;
    const col = extra.collector || collector;
    await tp.waitForLoadState('networkidle').catch(() => {});
    const { issues, trace } = await inspectPage(tp, col, { expect: extra.expect, expectTimeout: expectTmoOf(extra.item), mainStatus: extra.status, ignore, ...inspectOpts });
    if (extra.issues?.length) issues.push(...extra.issues);   // 버튼 동작 검사 등 호출한 쪽에서 판정한 것
    issues.push(...blockedIssues());
    if (dialogs.length) issues.push({ level: 'warn', msg: `다이얼로그: ${dialogs.join(' | ')}` });
    const r = { name, url, issues, trace, path: extra.path, expectFail: extra.item?.expectFail, at: new Date().toLocaleString() };
    if (wantShot(extra.item, issues.some((i) => i.level === 'fail'))) r.screenshot = await shot(name, tp, extra.item, extra.mask);
    push(r);
    dialogs.length = 0;
    col.reset();
  };

  // 실패 항목 증적 (item.screenshot === false 면 생략)
  const failShot = async (item, name, target = page, extraMask) => (wantShot(item, true) ? await shot(name, target, item, extraMask) : undefined);

  // ---------- 조회 조건 입력 ----------
  // sc.inputs: { common: { 필드: 값 }, search: "조회버튼 셀렉터" }  — 모든 메뉴에서 화면에 해당 필드가 있으면 채움
  // m.inputs: { 필드: 값 }  — 이 메뉴에서만 (공통값 덮어씀).  m.search: false(조회 안 누름) | "셀렉터"(이 메뉴용 조회 버튼)
  // 필드 키: CSS 셀렉터 그대로, 또는 이름만 쓰면 [name=이름] → #이름 순으로 찾음
  const fieldLoc = (scope, key) => (/[#.\[\]=>:\s]/.test(key) ? scope.locator(key) : scope.locator(`[name="${key}"], #${key.replace(/([^\w-])/g, '\\$1')}`)).first();
  const applyInputs = async (m) => {
    const merged = { ...(sc.inputs?.common || {}), ...(m.inputs || {}) };
    const keys = Object.keys(merged);
    if (!keys.length) return [];
    const filled = [];
    for (const key of keys) {
      const val = sub(merged[key]);
      let done = false;
      for (const f of page.frames()) {
        const l = fieldLoc(f, key);
        if (!(await l.isVisible().catch(() => false))) continue;
        try {
          const kind = await l.evaluate((el) => (el.tagName === 'SELECT' ? 'select' : el.type === 'checkbox' || el.type === 'radio' ? 'check' : el.readOnly || el.disabled ? 'readonly' : 'text'));
          if (kind === 'select') await l.selectOption(val).catch(async () => l.selectOption({ label: val }));
          else if (kind === 'check') await l.setChecked(val !== 'false' && val !== '0' && val !== '');
          else if (kind === 'readonly') {
            // 달력(datepicker) 등 readonly 입력란: fill 이 안 되므로 값을 직접 넣고 input/change 이벤트를 발생시킴
            await l.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, val);
          } else await l.fill(val);
          const lb = sc.inputs?.labels?.[key]; filled.push(`${lb ? lb.replace(/\s*\(.*\)$/, '') + ' ' : ''}${key}=${merged[key]}`); done = true;
        } catch (e) { throw new Error(`입력 실패 ${key}: ${e.message.split('\n')[0]}`); }
        break;
      }
      // 메뉴 전용 입력값인데 화면에 없으면 실패, 공통값은 화면에 없으면 그냥 건너뜀
      if (!done && m.inputs && key in m.inputs) throw new Error(`입력 필드 없음: ${key}`);
    }
    if (!filled.length || m.search === false) return filled;
    const searchSel = typeof m.search === 'string' ? m.search : sc.inputs?.search;
    if (searchSel) {
      let clicked = false;
      for (const f of page.frames()) {
        const b = f.locator(searchSel).first();
        if (await b.isVisible().catch(() => false)) { await b.click(); clicked = true; break; }
      }
      if (!clicked) throw new Error(`조회 버튼 없음: ${searchSel}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(sc.stepDelay ?? 300);
      filled.push('조회 클릭');
    }
    return filled;
  };

  // ---------- 버튼 동작 검사 ----------
  // m.actions: [{ name, click|text, frame, exact, dblclick, popup, expect, expectText, expectNotText, expectUrl,
  //               expectDialog, wait, waitFor, loading, close, back, screenshot, expectFail, skip, allowForbidden }]
  // 화면이 뜨는지만 보는 게 아니라 **버튼을 눌러 동작까지** 확인한다. 각 버튼이 결과표의 별도 행이 된다.
  // 판정: ① 버튼이 있는가 ② 눌러서 JS 에러·서버 5xx·에러 알림이 나지 않는가 ③ 실제로 반응이 있는가(죽은 버튼 탐지)
  //      ④ expect/expectText/expectUrl/expectDialog 를 적어 뒀으면 그것까지.
  // 안전: forbidden 에 걸리는 버튼은 누르지 않고 실패로 남긴다 (allowForbidden 으로만 허용).
  const MODAL_SEL = '.fancybox-container, .fancybox-wrap, .ui-dialog, .modal.in, .modal.show, .layer_popup, .ub-layer, [role=dialog]';
  const CLOSE_SEL = '.fancybox-button--close, .fancybox-close-small, .ui-dialog-titlebar-close, .modal .close, [data-fancybox-close], .btn_close, .close_btn';
  // 클릭 전후 DOM 변화량을 세는 관찰자 (반응 없는 버튼을 잡기 위해)
  const MUT_INIT = () => {
    try {
      window.__wwt_mut = 0;
      window.__wwt_obs?.disconnect();
      window.__wwt_obs = new MutationObserver((ms) => { window.__wwt_mut += ms.length; });
      window.__wwt_obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch { /* ignore */ }
  };
  const MUT_READ = () => { try { const n = window.__wwt_mut || 0; window.__wwt_obs?.disconnect(); return n; } catch { return 0; } };
  const eachFrame = async (target, fn) => {
    const frames = typeof target.frames === 'function' ? target.frames() : [target];
    const out = [];
    for (const f of frames) { try { out.push(await f.evaluate(fn)); } catch { /* detached */ } }
    return out;
  };
  const actionList = (m) => (Array.isArray(m.actions) ? m.actions.filter((a) => a && !a.skip) : []);

  // 버튼 찾기: 지정 프레임 → 모든 프레임 순으로 보이는 것
  const findClickable = async (a) => {
    const frames = a.frame
      ? [page.frame({ name: a.frame }) || page.frames().find((f) => f.name() === a.frame)].filter(Boolean)
      : page.frames();
    if (!frames.length) throw new Error(`프레임 없음: ${a.frame}`);
    for (const f of frames) {
      const loc = a.click ? f.locator(a.click).first() : f.getByText(a.text, { exact: !!a.exact }).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
  };
  const closeModal = async (sel) => {
    const selector = typeof sel === 'string' ? sel : CLOSE_SEL;
    for (const f of page.frames()) {
      const b = f.locator(selector).first();
      if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(sc.stepDelay ?? 300); return true; }
    }
    for (const f of page.frames()) {
      if (await f.locator(MODAL_SEL).first().isVisible().catch(() => false)) { await page.keyboard.press('Escape').catch(() => {}); await sleep(sc.stepDelay ?? 300); return true; }
    }
    return false;
  };

  const runActions = async (m) => {
    const menuUrl = m.url ? abs(m.url) : page.url();
    for (const a of actionList(m)) {
      if (cancelled()) stop();
      const label = a.name || a.click || a.text || '버튼';
      const name = `↳ ${m.name} · ${label}`;
      begin(name);
      let popup = null, popCol = null;
      try {
        safeDialogs = safeOf(a, m);
        const loc = await findClickable(a);
        if (!loc) throw new Error(`버튼 없음: ${a.click || a.text}`);
        // 금지 버튼(forbidden) 이면 누르지 않는다 — 실데이터를 바꾸는 사고를 막는 안전장치
        const hit = await forbiddenHit(loc, [label, a.click, a.text], a.allowForbidden || []);
        if (hit) throw new Error(`금지 버튼 클릭 차단: "${label}"${hit !== label ? ` (${hit})` : ''}`);

        collector.reset(); dialogs.length = 0; blockedDialogs.length = 0;
        const urlBefore = page.url();
        await eachFrame(page, MUT_INIT);
        let reqs = 0;
        const onReq = () => { reqs++; };
        page.on('request', onReq);
        const click = () => (a.dblclick ? loc.dblclick() : loc.click());
        try {
          if (a.popup) {
            [popup] = await Promise.all([page.waitForEvent('popup', { timeout: tmoOf(a) }), click()]);
            popup.on('dialog', onDialog);
            await popup.waitForLoadState('domcontentloaded');
            popCol = createCollector(popup, ignore);
            await popup.waitForLoadState('networkidle').catch(() => {});
          } else {
            await click();
            await page.waitForLoadState('networkidle').catch(() => {});
          }
          if (a.waitFor) await (popup || page).locator(a.waitFor).first().waitFor({ state: 'visible', timeout: tmoOf(a) }).catch(() => {});
          await waitReady({ ...a, waitFor: undefined }, popup || page);
          await sleep(Number(a.wait ?? sc.stepDelay ?? 300));
        } finally { page.off('request', onReq); }

        const mut = Math.max(0, ...(await eachFrame(page, MUT_READ)).map(Number).filter((n) => Number.isFinite(n)), 0);
        const tp = popup || page;
        const urlAfter = tp.url();
        const issues = [];
        // ③ 반응이 있었나 — 이동·팝업·요청·DOM 변화·알림이 전부 없으면 "죽은 버튼"
        // (변화 1건이라도 있으면 반응한 것으로 본다 — 레이어를 style 하나로 여는 화면이 흔하다)
        if (!popup && urlBefore === urlAfter && !reqs && mut < 1 && !dialogs.length && !blockedDialogs.length) {
          issues.push({ level: 'warn', msg: '버튼을 눌렀지만 아무 반응이 없습니다 (화면 변화·서버 요청·이동·알림 없음)' });
        }
        // 에러 알림(alert)은 경고가 아니라 실패로 본다
        for (const d of dialogs) if (/오류|에러|실패|Exception|Error/i.test(d)) issues.push({ level: 'fail', msg: `에러 알림: ${d}` });
        // ④ 적어 둔 기대값
        if (a.expectUrl && !urlAfter.includes(a.expectUrl)) issues.push({ level: 'fail', msg: `URL 에 "${a.expectUrl}" 없음 (${urlAfter})` });
        if (a.expectText || a.expectNotText) {
          const body = (await tp.evaluate(() => document.body?.innerText || '').catch(() => '')) || '';
          if (a.expectText && !body.includes(a.expectText)) issues.push({ level: 'fail', msg: `"${a.expectText}" 텍스트 없음` });
          if (a.expectNotText && body.includes(a.expectNotText)) issues.push({ level: 'fail', msg: `"${a.expectNotText}" 텍스트가 보입니다` });
        }
        if (a.expectDialog && !dialogs.some((d) => d.includes(a.expectDialog))) issues.push({ level: 'fail', msg: `알림 "${a.expectDialog}" 안 뜸${dialogs.length ? ` (실제: ${dialogs.join(' | ')})` : ''}` });

        await finishPage(name, urlAfter, {
          expect: a.expect, item: a.screenshot === undefined ? m : a, target: tp, collector: popCol || collector,
          mask: [...(m.mask || []), ...(a.mask || [])], issues,
          path: `${m.name} → ${a.click || a.text} 클릭${mut ? ` (변화 ${mut})` : ''}`,
        });
      } catch (e) {
        if (e.cancelled) throw e;
        push({ name, url: (popup || page).url(), issues: [{ level: 'fail', msg: e.message }, ...blockedIssues()], error: true, expectFail: a.expectFail, screenshot: await failShot(a.screenshot === undefined ? m : a, name, popup || page) });
      } finally {
        // 원래 화면으로 되돌린다 — 다음 버튼도 같은 화면에서 눌러야 하므로
        if (popup) await popup.close().catch(() => {});
        try {
          if (!popup && a.close !== false) await closeModal(a.close);
          const back = a.back || (page.url() !== menuUrl ? 'goto' : 'none');
          if (back === 'back') await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          else if (back === 'goto' && menuUrl) {
            await page.goto(menuUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            try { await applyInputs(m); } catch (e) { log(`  (경고) 버튼 검사 후 조회 조건 재입력 실패: ${e.message.split('\n')[0]}`); }
            await waitReady(m);
          }
        } catch { /* 복귀 실패는 다음 항목에서 드러난다 */ }
      }
    }
  };

  // ---------- 목록 → 상세 진입 ----------
  // m.detail: { selector | text, rows=1, dblclick, popup, frame, expect, back='goto'|'back'|'none', waitFor }
  // 목록 화면 검사 뒤 행(링크)을 위에서부터 rows 개 클릭해 상세 화면을 각각 별도 항목으로 검사한다.
  const runDetail = async (m) => {
    const d = typeof m.detail === 'string' ? { selector: m.detail } : m.detail;
    const rows = Math.max(1, d.rows ?? 1);
    const listUrl = m.url ? abs(m.url) : page.url();
    const label = (i, txt) => `↳ ${m.name} 상세 #${i + 1}${txt ? ` (${txt})` : ''}`;
    const scope = () => {
      if (d.frame) { const f = page.frame({ name: d.frame }) || page.frames().find((x) => x.name() === d.frame); if (!f) throw new Error(`프레임 없음: ${d.frame}`); return f; }
      return page;
    };
    const rowsLoc = () => (d.selector ? scope().locator(d.selector) : scope().getByText(d.text, { exact: !!d.exact }));
    // 행이 안 보이면 잠깐 기다림 (AJAX 목록)
    await rowsLoc().first().waitFor({ state: 'visible', timeout: d.timeout ?? 5000 }).catch(() => {});
    const count = await rowsLoc().count();
    if (count === 0) {
      push({ name: label(0), url: listUrl, issues: [{ level: 'warn', msg: `목록에 데이터가 없어 상세 조회 생략 (${d.selector ?? d.text})` }], at: new Date().toLocaleString() });
      return;
    }
    const n = Math.min(rows, count);
    for (let i = 0; i < n; i++) {
      if (cancelled()) stop();
      let popup = null, popCol = null;
      safeDialogs = safeOf(d, m);
      try {
        // 목록으로 복귀 (첫 번째는 이미 목록 화면)
        if (i > 0 && d.back !== 'none') {
          if (d.back === 'back') await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => page.goto(listUrl, { waitUntil: 'domcontentloaded' }));
          else await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
          if (m.steps && d.back !== 'back') await runSteps(m.steps, m.name); // 검색 등 목록을 만드는 스텝 재실행
          await page.waitForLoadState('networkidle').catch(() => {});
          if (d.back !== 'back') await applyInputs(m); // 조회 조건 재입력 + 조회
          await rowsLoc().first().waitFor({ state: 'visible', timeout: d.timeout ?? 5000 }).catch(() => {});
        }
        const row = rowsLoc().nth(i);
        const txt = ((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        if (await forbiddenHit(row)) throw new Error(`금지 버튼 클릭 차단: "${txt}"`);
        collector.reset(); dialogs.length = 0; blockedDialogs.length = 0;
        const click = () => (d.dblclick ? row.dblclick() : row.click());
        if (d.popup) {
          [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
          popup.on('dialog', onDialog);
          await popup.waitForLoadState('domcontentloaded');
          popCol = createCollector(popup, ignore);
          await popup.waitForLoadState('networkidle').catch(() => {});
        } else {
          await click();
          await page.waitForLoadState('networkidle').catch(() => {});
        }
        if (d.waitFor) await (popup || page).locator(d.waitFor).first().waitFor({ state: 'visible', timeout: tmoOf(d) }).catch(() => {});
        await waitReady({ ...d, waitFor: undefined }, popup || page); // 상세도 로딩 레이어가 걷힐 때까지
        await sleep(sc.stepDelay ?? 300);
        const tp = popup || page;
        await finishPage(label(i, txt), tp.url(), { expect: d.expect, item: d.screenshot === undefined ? m : d, mask: [...(m.mask || []), ...(d.mask || [])], target: tp, collector: popCol || collector, path: `${listUrl} → ${d.selector ?? d.text}[${i}] 클릭` });
        // 모달/레이어형 상세: 닫기 버튼(d.close) 또는 Esc 로 닫고 목록으로 (back:'none' 일 때)
        if (!popup && d.back === 'none') {
          const closeSel = d.close || '.fancybox-button--close, .fancybox-close-small, .ui-dialog-titlebar-close, .modal .close, [data-fancybox-close]';
          let closed = false;
          for (const f of page.frames()) { const b = f.locator(closeSel).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); closed = true; break; } }
          if (!closed) await page.keyboard.press('Escape').catch(() => {});
          await sleep(sc.stepDelay ?? 300);
        }
      } catch (e) {
        if (e.cancelled) throw e;
        push({ name: label(i), url: (popup || page).url(), issues: [{ level: 'fail', msg: e.message }, ...blockedIssues()], error: true, screenshot: await failShot(m, `${m.name}-detail${i + 1}`, popup || page) });
      } finally {
        if (popup) await popup.close().catch(() => {});
      }
    }
  };

  // ---------- 로그인 실행기 (최초 로그인 / 흐름 중 계정 전환 switchUser 공용) ----------
  // over: { user, password } → 로그인 스텝의 아이디·비밀번호 입력값만 바꿔서 실행한다.
  //   아이디 칸 = login.userField 셀렉터의 스텝, 없으면 첫 번째 fill
  //   비번 칸  = 셀렉터에 pw/pass 가 든 스텝, 없으면 두 번째 fill
  const loginSteps = (over = {}) => {
    const steps = (sc.login.steps || []).map((s) => ({ ...s }));
    if (!over.user && !over.password) return steps;
    const fills = steps.filter((s) => s.action === 'fill' || s.action === 'type');
    if (over.user) {
      const t = (sc.login.userField && fills.find((s) => s.selector === sc.login.userField)) || fills[0];
      if (!t) throw new Error('로그인 스텝에 아이디 입력이 없어 계정을 바꿀 수 없습니다');
      t.value = over.user;
    }
    if (over.password) {
      const t = fills.find((s) => /pw|pass|비밀/i.test(String(s.selector || ''))) || fills[1];
      if (t) t.value = over.password;
    }
    return steps;
  };
  // 반환: { why(''이면 성공), lastResp, attempt }. AJAX 로그인의 세션 커밋 경합 때문에 최대 login.retries 회 재시도
  const doLogin = async (over = {}, label = '로그인') => {
    const attempts = Math.max(1, sc.login.retries ?? 3);
    const chk = sc.login.success || {};
    const urlWait = Math.min(sc.timeout ?? 10000, 10000);
    const checkLogin = async () => {
      const url = page.url();
      const body = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (chk.urlContains && !url.includes(chk.urlContains)) return `URL에 "${chk.urlContains}" 없음 (${url})`;
      if (chk.urlNotContains && url.includes(chk.urlNotContains)) return `아직 로그인 페이지 (${url})`;
      if (chk.text && !body.includes(chk.text)) return `"${chk.text}" 텍스트 없음`;
      if (chk.selector && !(await page.locator(chk.selector).first().isVisible().catch(() => false))) return `${chk.selector} 안 보임`;
      if (sc.login.detect && (await onScreen(page, sc.login.detect))) return `아직 로그인 화면 (${sc.login.detect} 표시)`;
      return '';
    };
    const steps = loginSteps(over);
    let lastResp = null, why = '__init', attempt = 0;
    const wasSafe = safeDialogs; safeDialogs = false; // 로그인 중 확인창(중복 로그인 등)은 수락해야 넘어간다
    try { await loop(); } finally { safeDialogs = wasSafe; }
    return { why, lastResp, attempt };
    async function loop() { while (why && attempt < attempts) {
      attempt++;
      collector.reset();
      if (attempt > 1) log(`  ${label} 재시도 ${attempt}/${attempts} (이전 실패: ${why})`);
      lastResp = await page.goto(abs(sc.login.url), { waitUntil: 'domcontentloaded' });
      await runSteps(steps, 'login');
      await page.waitForLoadState('networkidle').catch(() => {});
      if (chk.urlNotContains) await page.waitForURL((u) => !String(u).includes(chk.urlNotContains), { timeout: urlWait }).catch(() => {});
      if (chk.urlContains) await page.waitForURL((u) => String(u).includes(chk.urlContains), { timeout: urlWait }).catch(() => {});
      if (chk.selector) await page.locator(chk.selector).first().waitFor({ state: 'visible', timeout: urlWait }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      why = await checkLogin();
      // 세션 경합: 성공 판정이 URL 기반인데 아직 로그인 폼이 보이면, 대상 URL 재접속으로 한 번 더 확인
      if (why && sc.login.detect) { await page.goto(abs(sc.login.after || '/'), { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); why = await checkLogin(); }
    } }
  };

  // 저장된 세션이 아직 유효한지: 로그인 뒤 도착 화면(포털)으로 가서 success/detect 로 판정 (''=유효)
  const portalUrl = () => { const g = [...(sc.login?.steps || [])].reverse().find((s) => s.action === 'goto'); return g?.url || sc.login?.after || sc.menus?.[0]?.url || '/'; };
  const sessionValid = async () => {
    const chk = sc.login.success || {};
    await page.goto(abs(portalUrl()), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const url = page.url();
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (chk.urlContains && !url.includes(chk.urlContains)) return false;
    if (chk.urlNotContains && url.includes(chk.urlNotContains)) return false;
    if (chk.text && !body.includes(chk.text)) return false;
    if (chk.selector && !(await page.locator(chk.selector).first().isVisible().catch(() => false))) return false;
    if (sc.login.detect && (await onScreen(page, sc.login.detect))) return false;
    return true;
  };

  let aborted = false;

  try {
    // ---------- 1. 로그인 ----------
    if (sc.login) {
      log('▶ 로그인'); begin('로그인');
      let lastResp = null, why = '', attempt = 0;
      try {
        // 저장된 세션이 있으면 먼저 재사용 시도 (유효하면 로그인 스텝 생략)
        if (haveSession && await sessionValid()) {
          log('  세션 재사용 — 로그인 생략'); reuseSession && log('  (.sessions 저장 세션)');
          await finishPage('로그인 (세션 재사용)', portalUrl());
        } else {
          if (haveSession) log('  저장 세션 만료 — 다시 로그인');
          ({ why, lastResp, attempt } = await doLogin());
          if (why) throw Object.assign(new Error(`로그인 실패: ${why}${attempt > 1 ? ` (${attempt}회 시도)` : ''}`), { loginFail: true });
          await saveSession(); // 성공한 세션을 저장해 다음 실행에서 재사용
          await finishPage('로그인', sc.login.url, { status: lastResp?.status() });
        }
      } catch (e) {
        if (e.cancelled) throw e;
        push({ name: '로그인', url: sc.login.url, issues: [{ level: 'fail', msg: e.message }], error: true, screenshot: await failShot(sc.login, 'login') });
        log('로그인 실패 — 중단');
        aborted = true;
        progress.total = progress.done; report(''); // 나머지는 실행 안 함 → 100%
      }
    }

    // ---------- 2. 메뉴 조회 ----------
    if (!aborted && !opt.skipMenus && Array.isArray(sc.menus)) {
      log(`▶ 메뉴 조회 (${menuList.length}개)`);
      for (const m of menuList) {
        if (cancelled()) stop();
        const doneBefore = progress.done;
        // retry: 메뉴별 > 시나리오 기본. 실패하면 그 메뉴만 다시 (불안정한 화면 대비)
        const attempts = 1 + Math.max(0, Number(m.retry ?? sc.retry ?? 0));
        await withRetry(attempts, m.name, async () => {
          collector.reset();
          begin(m.name);
          safeDialogs = safeOf(m); // 메뉴 순회 중에는 confirm 을 취소한다 (데이터 변경 방지)
          page.setDefaultTimeout(tmoOf(m)); // 이 메뉴에만 다른 대기 시간을 줄 수 있다 (무거운 통계 화면 등)
          try {
            let status = null;
            if (m.url) {
              const resp = await page.goto(abs(m.url), { waitUntil: 'domcontentloaded' });
              status = resp?.status() ?? null;
            }
            if (m.steps) await runSteps(m.steps, m.name); // 클릭으로 진입하는 메뉴
            await page.waitForLoadState('networkidle').catch(() => {});
            const filled = await applyInputs(m); // 조회 조건 입력 + 조회 버튼
            await waitReady(m);                  // 로딩 레이어가 걷히고 목록이 그려질 때까지 (느린 화면 대응)
            await finishPage(m.name, m.url || page.url(), { expect: m.expect, status, item: m, path: filled.length ? `입력: ${filled.join(', ')}` : undefined });
            if (m.actions) await runActions(m); // 버튼을 눌러 동작까지 검사
            if (m.detail) await runDetail(m); // 목록 → 상세 진입
          } catch (e) {
            if (e.cancelled) throw e;
            push({ name: m.name, url: m.url, issues: [{ level: 'fail', msg: e.message }, ...blockedIssues()], error: true, step: e.message, expectFail: m.expectFail, screenshot: await failShot(m, m.name) });
          }
        });
        // 상세 진입이 예정보다 적게 실행됐으면(데이터 부족/실패) 그만큼 전체 수에서 뺀다
        const expected = 1 + detailRows(m) + actionCount(m), actual = progress.done - doneBefore;
        if (actual < expected) { progress.total -= expected - actual; report(''); }
      }
    }

    // ---------- 3. 자동 링크 수집 (사이드바/탑메뉴) ----------
    if (!aborted && !opt.skipCrawl && !onlySet && sc.crawl?.enabled) {
      const c = sc.crawl;
      safeDialogs = safeOf();
      await page.goto(abs(c.startUrl || '/'), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      const origin = new URL(sc.baseUrl).origin;
      const links = new Map();
      for (const f of page.frames()) {
        const found = await f.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((a) => ({ href: a.href, text: (a.innerText || a.title || '').trim() })), c.selector || 'nav a, #sidebar a, .menu a, .gnb a, .lnb a').catch(() => []);
        for (const l of found) {
          if (!l.href || !l.href.startsWith(origin)) continue;
          if (/^javascript:|#$|logout|logoff/i.test(l.href)) continue;
          if ((c.exclude || []).some((x) => new RegExp(x, 'i').test(l.href) || new RegExp(x, 'i').test(l.text))) continue;
          if (!links.has(l.href)) links.set(l.href, l.text || l.href);
        }
      }
      const already = new Set((sc.menus || []).map((m) => m.url && abs(m.url)));
      const targets = [...links].filter(([h]) => !already.has(h)).slice(0, c.maxPages ?? 100).filter(([, text]) => !onlyRe || onlyRe.test(`[auto] ${text}`));
      log(`▶ 자동 수집 링크 ${targets.length}개 순회`);
      progress.total += targets.length; report('');
      for (const [href, text] of targets) {
        if (cancelled()) stop();
        const name = `[auto] ${text}`;
        collector.reset();
        begin(name);
        try {
          const resp = await page.goto(href, { waitUntil: 'domcontentloaded' });
          await finishPage(name, href, { status: resp?.status() ?? null });
        } catch (e) {
          if (e.cancelled) throw e;
          push({ name, url: href, issues: [{ level: 'fail', msg: e.message }], error: true, screenshot: await failShot(null, name) });
        }
      }
    }

    // ---------- 4. CRUD 시나리오 ----------
    if (!aborted && !opt.skipCrud && Array.isArray(sc.crud)) {
      log(`▶ CRUD 시나리오 (${crudList.length}개)`);
      safeDialogs = false; // CRUD 흐름은 확인창을 눌러야 저장이 되므로 자동 수락
      for (const flow of crudList) {
        if (cancelled()) stop();
        // CRUD 는 데이터를 만들 수 있으므로 재시도는 흐름에 "retry" 를 직접 넣은 경우에만 (시나리오 기본값 무시)
        await withRetry(1 + Math.max(0, Number(flow.retry ?? 0)), flow.name, async () => {
          collector.reset(); dialogs.length = 0; blockedDialogs.length = 0;
          begin(flow.name);
          page.setDefaultTimeout(tmoOf(flow));
          let trail = [];
          try {
            const r = await runSteps(flow.steps, flow.name, flow.allowForbidden || []);
            trail = r.trail;
            const { issues, trace } = await inspectPage(page, collector, { ignore, ...inspectOpts });
            // 흐름이 expectDialog 로 다이얼로그를 이미 검증했으면 경고로 올리지 않음
            if (dialogs.length && !flow.steps.some((s) => s.action === 'expectDialog')) issues.push({ level: 'warn', msg: `다이얼로그: ${dialogs.join(' | ')}` });
            const screenshot = wantShot(flow, issues.some((i) => i.level === 'fail')) ? await shot(flow.name, r.curPage, flow) : undefined;
            if (r.curPage !== page) await r.curPage.close().catch(() => {});
            push({ name: flow.name, url: page.url(), issues, trace, path: trail.join(' → '), expectFail: flow.expectFail, screenshot, at: new Date().toLocaleString() });
          } catch (e) {
            if (e.cancelled) throw e;
            if (e.trail) trail = e.trail;
            const { issues, trace } = await inspectPage(page, collector, { ignore, ...inspectOpts }).catch(() => ({ issues: [], trace: null }));
            issues.unshift({ level: 'fail', msg: e.message.split('\n')[0] });
            push({ name: flow.name, url: page.url(), issues, trace, error: true, step: trail[trail.length - 1] || e.message.split('\n')[0], path: trail.join(' → '), expectFail: flow.expectFail, screenshot: await failShot(flow, flow.name) });
          }
        });
      }
    }
  } catch (e) {
    if (e.cancelled) { log('⏹ 사용자 중단 — 지금까지의 결과로 보고서 생성'); progress.total = progress.done; report(''); } else throw e;
  } finally {
    progress.total = progress.done; report(''); // 완료 → 100%
    process.off('unhandledRejection', onRej);
    await browser.close().catch(() => {});
    if (stub) await stub.stop().catch(() => {});
  }

  // 직전 실행(같은 증적 폴더 안의 같은 시나리오)과 비교 → 신규 실패 / 해결 / 그대로
  let compare = null;
  if (opt.compare !== false) {
    try {
      const prev = opt.compareWith
        ? { dir: path.resolve(opt.compareWith), rel: path.basename(path.resolve(opt.compareWith)), json: readReportJson(path.resolve(opt.compareWith)) }
        : findPrevReport(outDir, { file: sc._file, name: sc.name });
      compare = buildCompare(prev, results);
    } catch (e) { log(`(직전 실행 비교 건너뜀: ${e.message.split('\n')[0]})`); }
  }

  // partial: 일부만 돌린 실행 → 다음 실행의 비교 기준에서 제외 (나머지가 전부 "신규"로 보이지 않게)
  const rep = writeReport(results, outDir, sc, { compare, partial: !!(onlySet || onlyRe) });
  log('\n' + rep.summary.join('\n'));
  log(`증적 폴더: ${outDir}`);
  return rep;
}
