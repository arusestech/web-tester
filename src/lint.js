// 시나리오 사전 검사(lint): 실행 20분 버리고 나서 알게 되는 실수를 저장/실행 전에 잡는다.
// error = 그대로 두면 실행이 깨지거나 결과를 못 믿는 것 / warn = 확인해 보라는 것
// (화면을 열어 봐야 아는 것 — 셀렉터가 맞는지 등 — 은 여기서 판단하지 않는다)

const ACTIONS = new Set(['goto', 'click', 'dblclick', 'fill', 'type', 'select', 'check', 'press', 'frame', 'mainFrame',
  'closePopup', 'wait', 'waitFor', 'waitForLoad', 'expectVisible', 'expectText', 'expectNotText', 'expectUrl',
  'expectDialog', 'screenshot', 'note', 'eval', 'switchUser', 'hover', 'upload']);
const NEEDS_TARGET = new Set(['click', 'dblclick', 'fill', 'type', 'select', 'check', 'expectVisible', 'hover', 'upload']);

// expectFail: true | 정규식 문자열 | 문자열 배열. 그 외/깨진 정규식은 잡는다.
function lintExpectFail(v, where, add) {
  if (v == null || v === true || v === false) return;
  const arr = Array.isArray(v) ? v : [v];
  for (const p of arr) {
    if (typeof p !== 'string') { add('error', 'expectFail 은 true 또는 정규식 문자열(또는 그 배열)이어야 합니다', where); continue; }
    try { new RegExp(p); } catch { add('error', `expectFail 정규식이 잘못됐습니다: ${p}`, where); }
  }
}

const dup = (arr) => {
  const seen = new Map(), out = [];
  for (const v of arr) { const n = (seen.get(v) || 0) + 1; seen.set(v, n); if (n === 2) out.push(v); }
  return out;
};

/** sc: 상속(extends)까지 해석된 시나리오 → [{ level, msg, where }] */
export function lintScenario(sc) {
  const out = [];
  const add = (level, msg, where = '') => out.push({ level, msg, where });
  if (!sc || typeof sc !== 'object') { add('error', '시나리오가 비어 있습니다'); return out; }

  // ---- 기본 ----
  if (!sc.name) add('warn', '이름(name)이 없습니다 — 증적 폴더 이름과 보고서 제목에 쓰입니다');
  if (!sc.baseUrl) add('error', '접속 URL(baseUrl)이 없습니다');
  else if (!/^https?:\/\//i.test(sc.baseUrl)) add('error', `baseUrl 은 http:// 또는 https:// 로 시작해야 합니다: ${sc.baseUrl}`);
  else if (/\/$/.test(sc.baseUrl)) add('warn', 'baseUrl 끝의 / 는 없어도 됩니다 (자동으로 정리됩니다)');
  if (!(sc.forbidden || []).length) add('warn', '금지 버튼(forbidden)이 비어 있습니다 — 삭제·발송 같은 버튼을 눌러 실데이터를 바꿀 수 있습니다');

  // ---- 로그인 ----
  if (sc.login) {
    if (!sc.login.url) add('error', '로그인 URL 이 없습니다', 'login');
    const steps = sc.login.steps || [];
    if (!steps.length) add('error', '로그인 스텝이 없습니다', 'login');
    if (!Object.keys(sc.login.success || {}).length && !sc.login.detect) add('warn', '로그인 성공 판정(success)이 없습니다 — 실패해도 계속 진행합니다', 'login');
    for (const s of steps) {
      const v = String(s.value ?? '');
      const pw = /pw|pass|비밀|비번/i.test(String(s.selector || '') + String(s.name || ''));
      if (s.action === 'fill' && pw && v && !/\{\{\s*\w+\s*\}\}/.test(v)) add('warn', '비밀번호가 시나리오 파일에 그대로 저장됩니다 — {{password}} 로 바꾸고 실행할 때 입력하세요', 'login');
    }
  } else if (JSON.stringify(sc).includes('switchUser')) add('error', 'switchUser 를 쓰려면 login 설정이 필요합니다');

  // ---- 메뉴 ----
  const menus = sc.menus || [];
  if (!menus.length && !(sc.crud || []).length) add('error', '메뉴도 CRUD 흐름도 없습니다 — 실행할 항목이 없습니다');
  const names = menus.map((m) => String(m?.name ?? '').trim());
  for (const d of dup(names.filter(Boolean))) add('error', `메뉴 이름이 중복입니다: "${d}" — 직전 실행 비교·실패건 재실행이 엉킵니다`, 'menus');
  for (const d of dup(menus.map((m) => String(m?.url ?? '').trim()).filter(Boolean))) add('warn', `같은 URL 이 여러 번 있습니다: ${d}`, 'menus');
  menus.forEach((m, i) => {
    const where = `menus[${i}]${m?.name ? ` ${m.name}` : ''}`;
    if (!m || typeof m !== 'object') return add('error', '메뉴 형식이 잘못됐습니다', where);
    if (!String(m.name || '').trim()) add('error', '메뉴 이름이 비어 있습니다', where);
    if (!m.url && !(m.steps || []).length) add('error', 'URL 도 스텝도 없습니다', where);
    if (m.url && /^https?:\/\//i.test(m.url) && sc.baseUrl && !String(m.url).startsWith(sc.baseUrl)) add('warn', '다른 사이트 주소입니다 — 의도한 것인지 확인하세요', where);
    if (m.detail) {
      const d = typeof m.detail === 'string' ? { selector: m.detail } : m.detail;
      if (!d.selector && !d.text) add('error', '상세 진입(detail)에 행 셀렉터도 텍스트도 없습니다', where);
      if (d.rows && (!Number.isInteger(d.rows) || d.rows < 1)) add('error', 'detail.rows 는 1 이상의 정수여야 합니다', where);
    }
    lintExpectFail(m.expectFail, where, add);
    // confirm: 메뉴 순회 중 확인창 처리 ('accept' 면 수락, 기본은 취소). 메뉴·detail·actions 공통
    const lintConfirm = (v, w) => { if (v !== undefined && v !== 'accept' && v !== 'dismiss') add('error', 'confirm 은 "accept" 또는 "dismiss" 여야 합니다', w); };
    lintConfirm(m.confirm, where);
    if (m.detail && typeof m.detail === 'object') lintConfirm(m.detail.confirm, where);
    // 버튼 동작 검사(actions)
    if (m.actions !== undefined) {
      if (!Array.isArray(m.actions)) add('error', 'actions 는 배열이어야 합니다', where);
      else {
        const anames = m.actions.map((a) => String(a?.name ?? '').trim());
        for (const d of dup(anames.filter(Boolean))) add('error', `버튼 동작 이름이 중복입니다: "${d}" — 결과 비교·재실행이 엉킵니다`, where);
        const forb = (sc.forbidden || []).map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
        m.actions.forEach((a, j) => {
          const aw = `${where} actions[${j}]${a?.name ? ` ${a.name}` : ''}`;
          if (!a || typeof a !== 'object') return add('error', '버튼 동작 형식이 잘못됐습니다', aw);
          if (!String(a.name || '').trim()) add('error', '버튼 동작 이름이 비어 있습니다', aw);
          if (!a.click && !a.text) add('error', '누를 버튼(click 셀렉터 또는 text)이 없습니다', aw);
          const t = `${a.name || ''} ${a.click || ''} ${a.text || ''}`;
          if (forb.some((re) => re.test(t)) && !(a.allowForbidden || []).some((x) => new RegExp(x, 'i').test(t))) {
            add('warn', `금지 버튼을 누르는 동작입니다: "${a.name || a.click || a.text}" — 실행하면 차단되어 실패로 남습니다 (의도한 것이면 allowForbidden)`, aw);
          }
          lintExpectFail(a.expectFail, aw, add);
          lintConfirm(a.confirm, aw);
        });
      }
    }
    for (const s of m.steps || []) lintStep(s, where, add, sc);
  });
  const noExpect = menus.filter((m) => m && !(m.expect || []).length).length;
  if (menus.length >= 5 && noExpect / menus.length > 0.6) add('warn', `필수 요소(expect)가 없는 메뉴가 ${noExpect}/${menus.length} 개입니다 — "떴는데 텅 빈 화면"을 놓칩니다`, 'menus');

  // ---- CRUD ----
  (sc.crud || []).forEach((f, i) => {
    const where = `crud[${i}]${f?.name ? ` ${f.name}` : ''}`;
    if (!f || typeof f !== 'object') return add('error', 'CRUD 흐름 형식이 잘못됐습니다', where);
    if (!String(f.name || '').trim()) add('error', '흐름 이름이 비어 있습니다', where);
    if (!(f.steps || []).length) add('error', '스텝이 없습니다', where);
    lintExpectFail(f.expectFail, where, add);
    const forb = (sc.forbidden || []).map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
    for (const s of f.steps || []) {
      lintStep(s, where, add, sc);
      const t = String(s.text || s.selector || '');
      if (s.action === 'click' && forb.some((re) => re.test(t)) && !(f.allowForbidden || []).some((a) => new RegExp(a, 'i').test(t))) {
        add('warn', `금지 버튼을 누르는 스텝이 있습니다: "${t}" — 실행하면 차단되어 실패로 남습니다 (의도한 것이면 allowForbidden 에 추가)`, where);
      }
    }
  });
  for (const d of dup((sc.crud || []).map((f) => String(f?.name ?? '').trim()).filter(Boolean))) add('error', `CRUD 흐름 이름이 중복입니다: "${d}"`, 'crud');

  // ---- 기타 설정 ----
  for (const key of ['ignore.console', 'ignore.resources', 'ignore.dialogs', 'ignore.text', 'errorPatterns', 'blocked', 'mask']) {
    const [a, b] = key.split('.');
    const arr = b ? sc[a]?.[b] : sc[a];
    for (const p of arr || []) { if (key === 'mask') continue; try { new RegExp(p); } catch { add('error', `${key} 의 정규식이 잘못됐습니다: ${p}`); } }
  }
  if (sc.slowMs && (!Number.isFinite(sc.slowMs) || sc.slowMs < 500)) add('warn', 'slowMs 가 너무 작습니다 — 대부분의 화면이 "느림" 으로 잡힙니다');
  if (sc.retry && sc.retry > 3) add('warn', 'retry 가 3 회를 넘습니다 — 실행 시간이 크게 늘어납니다');

  // ---- 자리표시자 ----
  const ph = [...JSON.stringify(sc).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  if (ph.length && !sc.login) add('warn', `자리표시자 {{${[...new Set(ph)].join('}}, {{')}}} 가 있는데 로그인 설정이 없습니다`);
  return out;
}

function lintStep(s, where, add, sc) {
  if (!s || typeof s !== 'object' || !s.action) return add('error', '스텝에 action 이 없습니다', where);
  if (!ACTIONS.has(s.action)) return add('error', `모르는 동작입니다: ${s.action}`, where);
  if (NEEDS_TARGET.has(s.action) && !s.selector && !s.text && !s.role) add('error', `${s.action} 스텝에 대상(selector/text/role)이 없습니다`, where);
  if (s.action === 'goto' && !s.url) add('error', 'goto 스텝에 url 이 없습니다', where);
  if (s.action === 'press' && !s.key) add('error', 'press 스텝에 key 가 없습니다', where);
  if (s.action === 'upload' && ![].concat(s.files ?? s.file ?? []).filter(Boolean).length) add('error', 'upload 스텝에 files(첨부할 파일 경로)가 없습니다', where);
  if (s.action === 'switchUser') {
    if (!s.user) add('error', 'switchUser 스텝에 user(아이디)가 없습니다', where);
    if (!sc?.login) add('error', 'switchUser 는 login 설정이 있어야 합니다', where);
  }
  if (s.action === 'frame' && !s.name && !s.selector) add('error', 'frame 스텝에 name 도 selector 도 없습니다', where);
}

/** 사람이 읽는 한 줄 요약 */
export function lintSummary(issues) {
  const e = issues.filter((i) => i.level === 'error').length;
  const w = issues.length - e;
  return e || w ? `검사 결과: 오류 ${e} / 주의 ${w}` : '검사 결과: 문제 없음';
}
