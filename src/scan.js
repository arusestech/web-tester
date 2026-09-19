// 화면의 입력 필드 목록 수집: 로그인 → 해당 URL 열기 → 보이는 input/select/textarea 를 라벨과 함께 반환
// GUI "메뉴 입력값" 팝업의 [화면에서 필드 가져오기] 가 사용. 시나리오 실행과는 별개의 짧은 브라우저 세션.
// 로그인 헬퍼(loginWithRetry)는 discover 도 함께 쓴다.
import { chromium } from 'playwright';
import { onScreen } from './checks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(sc) {
  const base = { headless: true, chromiumSandbox: true };
  for (const channel of [...new Set([sc.browser?.channel, 'chrome', 'msedge', 'chromium'].filter(Boolean))]) {
    try { return await chromium.launch({ ...base, channel }); } catch { /* 다음 */ }
  }
  return chromium.launch(base);
}

// 로그인 스텝 중 필드 수집에 필요한 최소 액션만 지원 (폼 편집기가 만드는 표준형 + goto/press/wait)
export async function runLoginSteps(page, steps, abs, sub) {
  let target = page;
  for (const s of steps) {
    const loc = () => (s.selector ? target.locator(s.selector).first() : s.text ? target.getByText(s.text, { exact: !!s.exact }).first() : target.getByRole(s.role, { name: s.name }).first());
    switch (s.action) {
      case 'goto': await page.goto(abs(s.url), { waitUntil: 'domcontentloaded' }); target = page; break;
      case 'fill': await loc().fill(sub(s.value)); break;
      case 'type': await loc().pressSequentially(sub(s.value)); break;
      case 'click': await loc().click(); break;
      case 'dblclick': await loc().dblclick(); break;
      case 'select': await loc().selectOption(s.value); break;
      case 'check': await loc().setChecked(s.value !== false); break;
      case 'press': if (s.selector || s.text || s.role) await loc().press(s.key); else await page.keyboard.press(s.key); break;
      case 'frame': target = s.name ? page.frame({ name: s.name }) : await page.locator(s.selector).first().contentFrame(); if (!target) throw new Error(`프레임 없음: ${s.name ?? s.selector}`); break;
      case 'mainFrame': target = page; break;
      case 'wait': await sleep(s.ms ?? 1000); break;
      case 'waitFor': await loc().waitFor({ state: s.state ?? 'visible', timeout: s.timeout }); break;
      case 'waitForLoad': await page.waitForLoadState(s.state ?? 'networkidle').catch(() => {}); break;
      default: break; // expect*/screenshot/note 등은 수집에 불필요
    }
    await sleep(200);
  }
}

/**
 * 로그인 + 성공 판정 + 재시도. runner 와 같은 기준(success / login.detect / login.retries / login.after)을 쓴다.
 * AJAX 로그인은 세션 커밋과 화면 이동 사이 경합으로 간헐 실패하므로 재시도가 필요하다 (우리은행 VOC 에서 실제로 겪음).
 * 실패하면 예외 — 로그인도 안 된 화면을 긁어 봐야 의미가 없다.
 */
export async function loginWithRetry(page, sc, abs, sub, log = () => {}) {
  if (!sc.login) return true;
  const chk = sc.login.success || {};
  const attempts = Math.max(1, Number(sc.login.retries ?? 3));
  const failReason = async () => {
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (chk.urlContains && !url.includes(chk.urlContains)) return `URL에 "${chk.urlContains}" 없음 (${url})`;
    if (chk.urlNotContains && url.includes(chk.urlNotContains)) return `아직 로그인 페이지 (${url})`;
    if (chk.text && !body.includes(chk.text)) return `"${chk.text}" 텍스트 없음`;
    if (chk.selector && !(await page.locator(chk.selector).first().isVisible().catch(() => false))) return `${chk.selector} 안 보임`;
    if (sc.login.detect && (await onScreen(page, sc.login.detect))) return `아직 로그인 화면 (${sc.login.detect} 표시)`;
    return '';
  };
  let why = '';
  for (let a = 1; a <= attempts; a++) {
    if (a > 1) log(`  로그인 재시도 ${a}/${attempts} (이전 실패: ${why})`);
    await page.goto(abs(sc.login.url), { waitUntil: 'domcontentloaded' });
    await runLoginSteps(page, sc.login.steps || [], abs, sub);
    await page.waitForLoadState('networkidle').catch(() => {});
    if (sc.login.after) { await page.goto(abs(sc.login.after), { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); }
    why = await failReason();
    if (!why) return true;
  }
  throw new Error(`로그인 실패: ${why}${attempts > 1 ? ` (${attempts}회 시도)` : ''}`);
}

// 브라우저 안에서 실행: 보이는 입력 요소 → { key, name, id, type, label, options, readonly, value }
const COLLECT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/[*:：]+$/, '').trim();
  // 라디오/체크박스 자체의 라벨: 바로 뒤에 오는 <label> (ub-control 마크업)
  const nextLabel = (el) => { const nx = el.nextElementSibling; return nx && nx.tagName === 'LABEL' ? clean(nx.textContent) : ''; };
  // group=true 면 라디오 그룹의 이름(th 등)을 찾고, 선택지 라벨(뒤 label)은 쓰지 않음
  const labelOf = (el, group = false) => {
    if (!group && el.id && el.type !== 'radio') { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && clean(l.textContent)) return clean(l.textContent); }
    const wrap = el.closest('label'); if (wrap && !group) { const t = clean(wrap.textContent.replace(el.value || '', '')); if (t) return t; }
    if (el.getAttribute('title')) return clean(el.getAttribute('title'));
    if (el.getAttribute('placeholder')) return clean(el.getAttribute('placeholder'));
    if (!group && (el.type === 'radio' || el.type === 'checkbox')) { const t = nextLabel(el); if (t) return t; }
    // 표 형식 폼(<th>라벨</th><td>입력</td>): 같은 행에서 앞쪽으로 가장 가까운 th. td 는 건너뜀 (다른 입력란의 셀)
    const cell = el.closest('td, dd, li');
    if (cell) {
      for (let prev = cell.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (/^(TH|DT)$/.test(prev.tagName)) { const t = clean(prev.textContent); if (t && t.length <= 30) return t; if (!t) continue; break; }
      }
    }
    // div 레이아웃: 바로 앞 형제 label/span
    const box = el.closest('div, p');
    if (box && box !== cell) { const prev = box.previousElementSibling; if (prev && /^(LABEL|SPAN|DIV|DT)$/.test(prev.tagName)) { const t = clean(prev.textContent); if (t && t.length <= 30) return t; } }
    // 바로 앞 텍스트 노드
    let n = el.previousSibling; while (n && !(n.nodeType === 3 && clean(n.textContent))) n = n.previousSibling;
    if (n) { const t = clean(n.textContent); if (t.length <= 30) return t; }
    return '';
  };
  const out = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
    if (!vis(el)) continue;
    if (type === 'radio' && el.name && out.some((o) => o.type === 'radio' && o.name === el.name)) {
      const o = out.find((x) => x.type === 'radio' && x.name === el.name); o.options.push({ value: el.value, text: nextLabel(el) || el.value }); continue;
    }
    const key = el.name || el.id; if (!key) continue;
    const item = { key, name: el.name || '', id: el.id || '', type, label: labelOf(el, type === 'radio'), readonly: !!(el.readOnly || el.disabled), value: type === 'checkbox' ? String(el.checked) : el.value || '', className: el.className || '' };
    if (type === 'select') item.options = Array.from(el.options).map((o) => ({ value: o.value, text: clean(o.textContent) })).slice(0, 200);
    if (type === 'radio') item.options = [{ value: el.value, text: nextLabel(el) || el.value }];
    if (!item.label && /calendar|date/i.test(item.className + ' ' + key)) item.label = /START|BEGIN|FROM|_S$/i.test(key) ? '날짜(시작)' : /END|TO$|_E$/i.test(key) ? '날짜(종료)' : '날짜';
    out.push(item);
  }
  return out;
};

/** sc: 시나리오, url: 화면 URL, secrets: {{}} 값 → fields[] */
export async function scanFields(sc, url, secrets = {}) {
  const sub = (v) => String(v ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => { if (secrets[k] === undefined) throw new Error(`실행 시 입력값 누락: {{${k}}}`); return secrets[k]; });
  const base = String(sc.baseUrl).replace(/\/+$/, '');
  const abs = (u) => (/^https?:/i.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u));
  const browser = await launch(sc);
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: sc.browser?.viewport ?? { width: 1400, height: 900 } });
    ctx.setDefaultTimeout(sc.timeout ?? 10000);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await loginWithRetry(page, sc, abs, sub);
    await page.goto(abs(url), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(sc.stepDelay ?? 300);
    const fields = [];
    const seen = new Set();
    for (const f of page.frames()) {
      const list = await f.evaluate(COLLECT).catch(() => []);
      for (const it of list) { if (seen.has(it.key)) continue; seen.add(it.key); if (f !== page.mainFrame()) it.frame = f.name() || f.url(); fields.push(it); }
    }
    return { url: page.url(), title: await page.title().catch(() => ''), fields };
  } finally {
    await browser.close().catch(() => {});
  }
}
