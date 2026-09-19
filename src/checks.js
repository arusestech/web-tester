// 화면 하나에 대한 공통 점검: HTTP 상태, 톰캣/스프링 에러 페이지, 콘솔 에러, 빈 화면, 핵심 요소
const ERROR_PATTERNS = [
  /HTTP Status \d{3}/i,
  /HTTP 상태 \d{3}/,
  /Exception report/i,
  /Whitelabel Error Page/i,
  /java\.lang\.[A-Za-z]+Exception/,
  /org\.springframework\.[\w.]+Exception/,
  /at [\w.$]+\([\w.]+\.java:\d+\)/,   // 스택트레이스 라인
  /javax\.servlet\.ServletException|jakarta\.servlet\.ServletException/,
  /org\.apache\.jasper\.JasperException/,
  /SQLException|BadSqlGrammarException|MyBatisSystemException/,
];

// 5xx 를 "서버 오류"로 볼 요청 종류 (화면 문서·iframe·AJAX). 그 외(이미지·CSS·폰트 등)는 리소스 경고로 남긴다
const SERVER_TYPES = new Set(['document', 'xhr', 'fetch']);
const TRACE_RE = /(?:[\w.$]+Exception[^\n]*\n(?:\s+at [^\n]+\n?){1,8})/;

// 시나리오 "ignore" 블록 → 정규식 묶음. { console:[], resources:[], dialogs:[], text:[] }
export function compileIgnore(ig = {}) {
  const rx = (arr) => (arr || []).map((s) => new RegExp(s, 'i'));
  const c = { console: rx(ig.console), resources: rx(ig.resources), dialogs: rx(ig.dialogs), text: rx(ig.text) };
  c.test = (kind, s) => c[kind].some((re) => re.test(s));
  return c;
}

export function createCollector(page, ignore = compileIgnore()) {
  const state = { console: [], pageErrors: [], failedRequests: [], responses: [], serverErrors: [], errorBodies: [] };
  const noise = (u) => /favicon\.ico/i.test(u);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url || '';
    if (noise(url) || /favicon/i.test(m.text())) return;
    if (ignore.test('console', m.text()) || ignore.test('resources', url)) return;
    state.console.push(m.text());
  });
  page.on('pageerror', (e) => { const t = String(e?.message || e); if (!ignore.test('console', t)) state.pageErrors.push(t); });
  page.on('requestfailed', (r) => {
    if (noise(r.url()) || ignore.test('resources', r.url())) return;
    state.failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400 || noise(r.url()) || ignore.test('resources', r.url())) return;
    const line = `${s} ${r.request().method()} ${r.url()}`;
    // 화면·AJAX(document/xhr/fetch)의 5xx 는 서버가 죽은 것 → 리소스 경고와 분리해 실패로 올린다.
    // (jqGrid 목록 조회처럼 화면은 200 인데 데이터 요청만 500 인 경우가 주의로 묻히던 문제)
    // 이미지·CSS·폰트·스크립트의 4xx/5xx 는 지금처럼 경고.
    let type = '';
    try { type = r.request().resourceType(); } catch { /* ignore */ }
    if (s >= 500 && SERVER_TYPES.has(type)) {
      let mainNav = false;
      try { mainNav = r.request().isNavigationRequest() && r.frame() === page.mainFrame(); } catch { /* ignore */ }
      state.serverErrors.push({ line, code: s, mainNav });
      // 응답 본문 앞부분(스택트레이스)을 보관 → 서버 로그와 대조할 단서
      r.text().then((t) => { if (t) state.errorBodies.push(String(t).slice(0, 4000)); }).catch(() => {});
      return;
    }
    state.responses.push(line);
  });
  return {
    state,
    reset() { state.console = []; state.pageErrors = []; state.failedRequests = []; state.responses = []; state.serverErrors = []; state.errorBodies = []; },
  };
}

// 요소가 "실제로 화면에 보이는가": 뷰포트 안에 있고, 그 중심점에서 맨 위에 있는 요소가 자기 자신(또는 자식)일 것.
// Playwright 의 isVisible 은 화면 밖·다른 레이어 뒤에 깔린 요소도 true 라서 로그인 화면 감지 등에는 이 기준을 쓴다.
export async function onScreen(frame, selector, timeout = 500) {
  try {
    const l = frame.locator(selector).first();
    if (!(await l.isVisible({ timeout }))) return false;
    return await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      return !!top && (top === el || el.contains(top) || top.contains(el));
    });
  } catch { return false; }
}

// 화면이 깨졌는지: 이미지 로드 실패 / 가로 스크롤(레이아웃 넘침)
// opts.checks: { images: true, layout: false, layoutSlack: 50 }
async function inspectLayout(page, checks, ignore) {
  const issues = [];
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(({ images, layout, slack }) => {
        const out = { broken: [], overflow: null };
        if (images) {
          for (const img of document.images) {
            if (!img.currentSrc && !img.getAttribute('src')) continue;   // src 없는 자리표시자
            if (!img.complete || img.naturalWidth > 0) continue;          // 아직 로딩 중이거나 정상
            const box = img.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;            // 숨겨진 이미지는 제외
            out.broken.push(img.currentSrc || img.getAttribute('src'));
          }
        }
        if (layout) {
          const de = document.documentElement;
          const w = Math.max(de.scrollWidth, document.body?.scrollWidth || 0);
          if (w > de.clientWidth + slack) out.overflow = { content: w, view: de.clientWidth };
        }
        return out;
      }, { images: checks.images !== false, layout: !!checks.layout, slack: checks.layoutSlack ?? 50 });
      const broken = (r.broken || []).filter((u) => !ignore.test('resources', u));
      if (broken.length) issues.push({ level: 'warn', msg: `이미지 로드 실패 ${broken.length}개: ${broken.slice(0, 2).map((u) => String(u).split('/').pop()).join(', ')}${broken.length > 2 ? ' 외' : ''}` });
      if (r.overflow) issues.push({ level: 'warn', msg: `가로 스크롤 발생 (내용 ${r.overflow.content}px > 화면 ${r.overflow.view}px) — 레이아웃 깨짐 의심` });
    } catch { /* detached frame */ }
  }
  return issues;
}

const EMPTY_MIN = 20;      // 본문 텍스트가 이보다 짧으면 "빈 화면"
const EMPTY_WAIT = 1500;   // 비어 보일 때 다시 읽어 보는 시간 (ms)

// 모든 프레임의 본문 텍스트를 모아서 에러 패턴 검사.
// 화면을 다시 그리는 중이면 evaluate 가 "execution context destroyed" 로 실패하는데,
// 그걸 빈 문자열로 삼키면 멀쩡한 화면이 "빈 화면"으로 찍힌다 → 못 읽은 프레임 수를 같이 돌려준다.
async function collectText(page) {
  let frames;
  try { frames = page.frames(); } catch { return { text: '', failed: 1 }; }
  const texts = [];
  let failed = 0;
  for (const f of frames) {
    try { texts.push(await f.evaluate(() => document.body?.innerText || '')); }
    catch { failed++; }   // 내용 교체 중 또는 detached
  }
  return { text: texts.join('\n'), failed };
}

// 본문 텍스트 읽기. 비어 보이면 다 그려질 때까지 잠깐 다시 시도한다.
// 목록 자리에 상세를 다시 그리는 화면(URL 이 안 바뀌는 상세)은 검사 순간에만 잠깐 비어 있어서,
// 한 번만 읽으면 스크린샷에는 멀쩡히 나오는 화면이 "빈 화면"으로 남는다. (스타벅스 VOC 상세에서 실제로 겪음)
async function readText(page, waitMs = EMPTY_WAIT) {
  let best = await collectText(page);
  const until = Date.now() + waitMs;
  while (best.text.trim().length < EMPTY_MIN && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    const again = await collectText(page);
    if (again.text.length >= best.text.length) best = again;
  }
  return best;
}

/**
 * opts.errorPatterns: 시나리오 추가 에러 텍스트 정규식 배열 (예: '"errorCode"\\s*:\\s*48\\d')
 * opts.errorStatus:   업무오류로 쓰는 HTTP 상태코드 배열 (예: [486,487,488]) → 해당 응답은 ⚠️ 가 아니라 ❌
 * opts.loginDetect:   로그인 화면 요소 셀렉터 (예: '#loginId') → 보이면 "로그인 화면으로 돌아감" ❌ (302 없이 200 으로 로그인 폼을 주는 사이트용)
 */
export async function inspectPage(page, collector, { expect = [], expectTimeout = 5000, mainStatus = null, ignore = compileIgnore(), errorPatterns = [], errorStatus = [], loginDetect = null, checks = {}, emptyWait = EMPTY_WAIT } = {}) {
  const issues = []; // { level: 'fail'|'warn', msg }
  const { text, failed: unreadFrames } = await readText(page, emptyWait);

  if (mainStatus !== null && mainStatus >= 400) issues.push({ level: 'fail', msg: `HTTP ${mainStatus}` });

  for (const re of [...ERROR_PATTERNS, ...errorPatterns.map((s) => (s instanceof RegExp ? s : new RegExp(s, 'i')))]) {
    const m = text.match(re);
    if (m && !ignore.test('text', m[0])) { issues.push({ level: 'fail', msg: `에러 페이지 감지: "${m[0].slice(0, 120)}"` }); break; }
  }

  if (loginDetect) {
    let seen = false;
    for (const f of page.frames()) { if (await onScreen(f, loginDetect)) { seen = true; break; } }
    if (seen) issues.push({ level: 'fail', msg: `로그인 화면으로 돌아감 (세션 없음 또는 권한 없음): ${loginDetect} 표시` });
  }

  if (text.trim().length < EMPTY_MIN) issues.push({ level: 'warn', msg: `빈 화면(본문 텍스트 거의 없음)${unreadFrames ? ` — 프레임 ${unreadFrames}개를 읽지 못함` : ''}` });

  // 깨진 화면(이미지 로드 실패 / 가로 스크롤). 에러 페이지에서는 의미가 없으니 건너뜀
  if (!issues.some((i) => i.level === 'fail')) issues.push(...(await inspectLayout(page, checks, ignore)));

  // 핵심 요소는 "느리게 그려지는 화면"을 감안해 expectTimeout 까지 기다린다.
  // 먼저 전 프레임을 빠르게 훑고(이미 떠 있으면 즉시 통과), 없으면 각 프레임에서 나타날 때까지 기다린다.
  for (const sel of expect) {
    let found = false;
    for (const f of page.frames()) {
      try { if (await f.locator(sel).first().isVisible({ timeout: 300 })) { found = true; break; } } catch { /* ignore */ }
    }
    if (!found && expectTimeout > 300) {
      const waits = page.frames().map((f) => f.locator(sel).first().waitFor({ state: 'visible', timeout: expectTimeout }).then(() => true).catch(() => false));
      found = (await Promise.all(waits)).some(Boolean);
    }
    if (!found) issues.push({ level: 'fail', msg: `핵심 요소 없음: ${sel} (${Math.round(expectTimeout / 1000)}초 대기)` });
  }

  // 같은 메시지 반복은 한 번만 (횟수 표기)
  const dedupe = (arr) => { const m = new Map(); for (const a of arr) m.set(a, (m.get(a) || 0) + 1); return [...m].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)); };
  for (const e of dedupe(collector.state.pageErrors)) issues.push({ level: 'fail', msg: `JS 예외: ${e}` });
  for (const e of dedupe(collector.state.console)) issues.push({ level: 'warn', msg: `콘솔 에러: ${e}` });
  const errSet = new Set((errorStatus || []).map(Number));
  // 화면 자체의 5xx 는 위에서 `HTTP 5xx` 로 이미 올렸으므로 같은 응답을 두 번 올리지 않는다
  const srvErrs = (collector.state.serverErrors || []).filter((e) => !(e.mainNav && mainStatus === e.code)).map((e) => e.line);
  for (const e of dedupe(srvErrs)) issues.push({ level: 'fail', msg: `서버 오류 응답 ${e}` });
  for (const e of dedupe(collector.state.responses)) {
    const code = Number(e.split(' ')[0]);
    if (errSet.has(code)) issues.push({ level: 'fail', msg: `업무오류 응답 ${e}` });
    else issues.push({ level: 'warn', msg: `리소스 응답 ${e}` });
  }
  for (const e of dedupe(collector.state.failedRequests)) issues.push({ level: 'warn', msg: `요청 실패 ${e}` });

  // 스택트레이스 일부를 상세로 보관
  // 화면에 없으면 5xx 응답 본문에서 찾는다 (AJAX 에러는 화면에 안 그려진다). JSON 으로 온 것은 \n·\t 가 글자로 들어 있어 풀어서 본다
  let trace = text.match(TRACE_RE);
  if (!trace) {
    for (const b of collector.state.errorBodies || []) {
      const plain = String(b).replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/<[^>]+>/g, '');
      trace = plain.match(TRACE_RE);
      if (trace) { trace = [trace[0].replace(/["}\]\s]+$/, '')]; break; } // JSON 꼬리("}) 제거
    }
  }
  return { issues, trace: trace ? trace[0] : null };
}
