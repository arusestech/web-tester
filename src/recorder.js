// 녹화(레코더): 브라우저를 띄워 사람이 직접 조작하면 그 동작을 시나리오 스텝(JSON)으로 기록한다.
// GUI 편집 탭 [⏺ 녹화] 또는 `cli.js record` 가 사용. 로그인은 시나리오의 login 설정으로 먼저 처리하고(기록 안 함) 그 다음부터 기록.
//
// 기록되는 것: 페이지 이동(goto) · 클릭/더블클릭 · 입력(fill, 비밀번호는 {{password}}) · select · 체크박스 · Enter/Escape ·
//              iframe 진입/이탈(frame/mainFrame) · 새 창(popup:true / closePopup) · alert/confirm(expectDialog, 자동 확인)
// 녹화 화면 상단 툴바: [요소 확인](다음 클릭 요소를 expectVisible 로) · [선택 텍스트 확인](드래그한 글자를 expectText 로) · [📸 캡처] · [■ 종료]
import { chromium } from 'playwright';
import { runLoginSteps } from './scan.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(sc, headless) {
  const base = { headless, chromiumSandbox: true };
  for (const channel of [...new Set([sc.browser?.channel, 'chrome', 'msedge', 'chromium'].filter(Boolean))]) {
    try { return await chromium.launch({ ...base, channel }); } catch { /* 다음 */ }
  }
  return chromium.launch(base);
}

// ---------- 브라우저 안에 심는 스크립트 (모든 프레임, 모든 페이지) ----------
// 클로저 없이 독립 실행되어야 함 (addInitScript 로 문자열화됨)
const INJECT = () => {
  if (window.__wwtInstalled) return; window.__wwtInstalled = true;
  const send = (ev) => { try { window.__wwtRec(ev); } catch { /* 바인딩 없음 */ } };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'));
  const q = (s) => { try { return document.querySelectorAll(s).length; } catch { return 0; } };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isBar = (el) => !!(el && el.closest && el.closest('#__wwt_bar'));
  const dynamicId = (id) => /^\d|\d{4,}|^(jqg|gbox_|gview_|ui-id-|tui-|ext-|ember|react|__)/i.test(id);
  // 요소 → 재생 시 다시 찾을 수 있는 셀렉터. id → name → 속성 → 짧은 텍스트 → CSS 경로 순
  const sel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !dynamicId(el.id) && q('#' + esc(el.id)) === 1) return '#' + esc(el.id);
    const name = el.getAttribute('name');
    if (name && q(`${tag}[name="${name}"]`) === 1) return `${tag}[name="${name}"]`;
    for (const a of ['data-testid', 'data-id', 'title', 'aria-label', 'placeholder', 'alt', 'value']) {
      if (a === 'value' && !/^(button|submit|reset)$/i.test(el.type || '')) continue;
      const v = el.getAttribute(a);
      if (v && v.length <= 40 && !/["\n]/.test(v) && q(`${tag}[${a}="${v}"]`) === 1) return `${tag}[${a}="${v}"]`;
    }
    if (/^(a|button|label|span|div|li|th|td|p|h[1-6])$/.test(tag)) {
      const t = clean(el.textContent);
      if (t && t.length <= 20 && !/["\n]/.test(t)) {
        const same = Array.from(document.querySelectorAll(tag)).filter((x) => clean(x.textContent).includes(t));
        if (same.length === 1) return `${tag}:has-text("${t}")`;
      }
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      if (cur.id && !dynamicId(cur.id) && q('#' + esc(cur.id)) === 1) { parts.unshift('#' + esc(cur.id)); break; }
      let part = cur.tagName.toLowerCase();
      const cls = Array.from(cur.classList).filter((c) => !/^(ui-|jq|hover|active|selected|focus|ng-|is-|has-|tui-|on$)/.test(c) && !/\d/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(esc).join('.');
      const par = cur.parentElement;
      if (par) { const sib = Array.from(par.children).filter((x) => x.tagName === cur.tagName); if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(cur) + 1})`; }
      parts.unshift(part); cur = par;
    }
    return parts.join(' > ');
  };
  window.__wwtSel = sel;

  // ----- 입력값: input 이벤트로 대상만 기억해 두고, blur/Enter/다른 클릭 시점에 최종값을 fill 로 기록
  let pending = null;
  const lastVal = new WeakMap();
  const isText = (el) => !!el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|image|hidden)$/i.test(el.type)) || el.tagName === 'TEXTAREA');
  const flush = () => {
    if (!pending) return; const el = pending; pending = null;
    if (lastVal.get(el) === el.value) return; lastVal.set(el, el.value);
    send({ type: 'fill', selector: sel(el), value: el.value, inputType: (el.type || 'text').toLowerCase() });
  };
  let mode = '';
  const setMode = (m) => { mode = m; document.body && (document.body.style.cursor = m === 'assert' ? 'crosshair' : ''); const b = document.getElementById('__wwt_bar'); if (b) b.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.m === m)); };
  let hi = null;
  const unhi = () => { if (hi) { hi.style.outline = hi.__wwtO || ''; hi = null; } };

  document.addEventListener('input', (e) => { if (isText(e.target) && !isBar(e.target)) pending = e.target; }, true);
  document.addEventListener('change', (e) => {
    const el = e.target; if (isBar(el)) return;
    if (el.tagName === 'SELECT') { send({ type: 'select', selector: sel(el), value: el.value, text: el.options[el.selectedIndex] ? clean(el.options[el.selectedIndex].text) : '' }); return; }
    if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type)) { send({ type: 'check', selector: sel(el), value: el.checked, text: clean((el.labels && el.labels[0] && el.labels[0].textContent) || (el.nextElementSibling && el.nextElementSibling.tagName === 'LABEL' ? el.nextElementSibling.textContent : '')) }); return; }
    if (isText(el)) { pending = el; flush(); }
  }, true);
  document.addEventListener('focusout', (e) => { if (pending === e.target) flush(); }, true);
  // Enter/Escape 는 입력란에서 누른 것만 기록 (버튼 위 Enter 는 브라우저가 click 을 만들어 주므로 click 으로 기록됨)
  let enterAt = 0;
  document.addEventListener('keydown', (e) => {
    if (isBar(e.target) || !isText(e.target)) return;
    if (e.key === 'Enter' || e.key === 'Escape') { flush(); enterAt = Date.now(); send({ type: 'press', key: e.key, selector: sel(e.target) }); }
  }, true);
  document.addEventListener('mouseover', (e) => { if (mode !== 'assert' || isBar(e.target)) return; unhi(); hi = e.target; hi.__wwtO = hi.style.outline; hi.style.outline = '2px solid #e53'; }, true);
  document.addEventListener('click', (e) => {
    const t = e.target; if (isBar(t)) return;
    if (mode === 'assert') { e.preventDefault(); e.stopPropagation(); unhi(); send({ type: 'expectVisible', selector: sel(t), text: clean(t.textContent).slice(0, 30) }); setMode(''); return; }
    flush();
    if (e.detail > 1) return; // 더블클릭의 두 번째 클릭
    if (e.detail === 0 && Date.now() - enterAt < 500) return; // 입력란 Enter 의 폼 자동 제출이 만든 클릭 (press 로 이미 기록)
    if (isText(t) || t.tagName === 'SELECT' || t.tagName === 'OPTION') return; // 포커스용 클릭
    if (t.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(t.type)) return; // change 에서 기록
    if (t.tagName === 'LABEL' && t.control && /^(checkbox|radio)$/i.test(t.control.type)) return;
    const el = t.closest('a, button, [role=button], [onclick], input[type=button], input[type=submit], input[type=image], label, li, td, th') || t;
    send({ type: 'click', selector: sel(el), text: clean(el.innerText || el.textContent || el.value || el.title || el.alt).slice(0, 40) });
  }, true);
  document.addEventListener('dblclick', (e) => {
    const t = e.target; if (isBar(t) || mode) return;
    const el = t.closest('tr, li, a, td, div') || t;
    send({ type: 'dblclick', selector: sel(el), text: clean(el.innerText || el.textContent).slice(0, 40) });
  }, true);

  // ----- 툴바 (최상위 프레임에만)
  const bar = () => {
    if (window.top !== window || !document.body || document.getElementById('__wwt_bar')) return;
    const d = document.createElement('div'); d.id = '__wwt_bar';
    d.innerHTML = '<style>#__wwt_bar{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1f2937;color:#fff;font:12px/1 "Malgun Gothic",sans-serif;padding:6px 10px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;gap:6px;align-items:center;white-space:nowrap}#__wwt_bar button{font:inherit;background:#374151;color:#fff;border:1px solid #4b5563;border-radius:4px;padding:4px 8px;cursor:pointer}#__wwt_bar button:hover{background:#4b5563}#__wwt_bar button.on{background:#e53;border-color:#e53}#__wwt_bar button[data-m=stop]{background:#b91c1c}#__wwt_bar i{color:#fbbf24;font-style:normal}#__wwt_bar em{font-style:normal;opacity:.75;margin-left:4px}</style>'
      + '<span>⏺ <b>녹화 중</b> <em id="__wwt_cnt">0</em></span><button data-m="assert" title="다음에 클릭하는 요소가 보여야 함(expectVisible)을 검사 스텝으로 추가">☑ 요소 확인</button><button data-m="text" title="드래그로 선택한 글자가 있어야 함(expectText)을 검사 스텝으로 추가">"" 선택 텍스트 확인</button><button data-m="shot" title="이 시점 화면을 증적으로 캡처">📸 캡처</button><button data-m="stop">■ 종료</button><i id="__wwt_msg"></i>';
    document.body.appendChild(d);
    const msg = (m) => { const el = document.getElementById('__wwt_msg'); if (!el) return; el.textContent = m; setTimeout(() => { if (el.textContent === m) el.textContent = ''; }, 2500); };
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const m = b.dataset.m;
      if (m === 'assert') { setMode(mode === 'assert' ? '' : 'assert'); if (mode) msg('검사할 요소를 클릭하세요'); }
      else if (m === 'text') {
        let s = '';
        try { s = String(window.getSelection()); } catch { /* */ }
        if (!s.trim()) for (let i = 0; i < window.frames.length && !s.trim(); i++) { try { s = String(window.frames[i].getSelection()); } catch { /* cross-origin */ } }
        s = clean(s);
        if (!s) return msg('먼저 화면의 글자를 드래그로 선택하세요');
        send({ type: 'expectText', text: s.slice(0, 80) }); msg('텍스트 확인 추가: ' + s.slice(0, 20));
      } else if (m === 'shot') { send({ type: 'screenshot' }); msg('캡처 스텝 추가'); }
      else if (m === 'stop') { flush(); send({ type: 'stop' }); }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode) { setMode(''); unhi(); } }, true);
  };
  window.__wwtCount = (n) => { const el = document.getElementById('__wwt_cnt'); if (el) el.textContent = n; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
  window.addEventListener('beforeunload', flush);
};

/**
 * sc: 시나리오, opt: { url='/', login=true, secrets, headless=false, onStep(index, step), onState({recording, reason}), log }
 * 반환: { steps, stop(), remove(i), add(step), page, done: Promise }
 */
export async function startRecorder(sc, opt = {}) {
  const log = opt.log || (() => {});
  const secrets = opt.secrets || {};
  const sub = (v) => String(v ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => { if (secrets[k] === undefined) throw new Error(`실행 시 입력값 누락: {{${k}}}`); return secrets[k]; });
  const base = String(sc.baseUrl).replace(/\/+$/, '');
  const abs = (u) => (/^https?:/i.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u));
  const rel = (u) => (u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const forbidden = (sc.forbidden || []).map((s) => new RegExp(s, 'i'));

  const browser = await launch(sc, opt.headless ?? !!process.env.WWT_REC_HEADLESS); // 환경변수는 자동 테스트용
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: sc.browser?.viewport ?? { width: 1400, height: 900 } });
  context.setDefaultTimeout(sc.timeout ?? 10000);

  const steps = [];
  let armed = false, closed = false, shotSeq = 0;
  let curPage = null, curFrame = null, lastAt = 0;
  let resolveDone; const done = new Promise((r) => (resolveDone = r));
  const now = () => Date.now();
  const last = () => steps[steps.length - 1];
  const updateCount = () => { curPage?.mainFrame().evaluate((n) => window.__wwtCount && window.__wwtCount(n), steps.length).catch(() => {}); };
  const emit = (s) => { steps.push(s); lastAt = now(); if (/^(click|dblclick|press|select|check|goto)$/.test(s.action)) actionAt = lastAt; log(`  + ${s.action} ${s.selector ?? s.url ?? s.text ?? s.key ?? ''}`); opt.onStep?.(steps.length - 1, s, steps); updateCount(); };
  const finish = (reason) => {
    if (closed) return; closed = true; armed = false;
    opt.onState?.({ recording: false, reason, steps });
    browser.close().catch(() => {});
    resolveDone(steps);
  };

  // ----- 프레임/페이지 동기화: 이벤트가 현재 기록 중인 프레임과 다른 곳에서 오면 frame/mainFrame/closePopup 스텝을 끼워 넣음
  const frameStep = async (f) => {
    const name = f.name();
    if (name) return { action: 'frame', name };
    try {
      const h = await f.frameElement();
      const parent = f.parentFrame();
      const s = await parent.evaluate((el) => window.__wwtSel ? window.__wwtSel(el) : (el.id ? '#' + el.id : 'iframe'), h);
      return { action: 'frame', selector: s };
    } catch { return { action: 'frame', selector: 'iframe' }; }
  };
  const sync = async (p, f) => {
    if (p !== curPage) {
      if (curPage && p === mainPage && !curPage.isClosed()) { emit({ action: 'closePopup', _note: '팝업이 열린 채 원래 창으로 돌아옴 → 재생 시 팝업을 닫음' }); }
      curPage = p; curFrame = p.mainFrame();
    }
    if (f === curFrame) return;
    if (f === p.mainFrame()) { emit({ action: 'mainFrame' }); curFrame = f; return; }
    // 중첩 프레임: 메인에서부터 경로대로 진입 (runner 는 name 은 깊이 무관, selector 는 현재 페이지 기준)
    const chain = []; for (let x = f; x && x !== p.mainFrame(); x = x.parentFrame()) chain.unshift(x);
    if (curFrame !== p.mainFrame()) emit({ action: 'mainFrame' });
    for (const x of chain) emit(await frameStep(x));
    curFrame = f;
  };

  // 바인딩 호출은 순서를 보장하기 위해 직렬 처리
  let chain = Promise.resolve();
  await context.exposeBinding('__wwtRec', (source, ev) => {
    if (!armed || closed) return;
    chain = chain.then(() => handle(source, ev)).catch((e) => log(`(녹화 경고) ${e.message.split('\n')[0]}`));
  });
  const handle = async (source, ev) => {
    if (ev.type === 'stop') return finish('user');
    await sync(source.page, source.frame);
    switch (ev.type) {
      case 'click': {
        const s = { action: 'click', selector: ev.selector };
        if (ev.text) s._text = ev.text;
        if (ev.text && forbidden.some((re) => re.test(ev.text))) s._warn = '금지 버튼 — 재생 시 차단됨 (allowForbidden 필요)';
        emit(s); break;
      }
      case 'dblclick': {
        const l = last(); if (l && l.action === 'click' && l.selector === ev.selector) steps.pop();
        const s = { action: 'dblclick', selector: ev.selector }; if (ev.text) s._text = ev.text; emit(s); break;
      }
      case 'fill': {
        const s = { action: 'fill', selector: ev.selector, value: ev.inputType === 'password' ? '{{password}}' : ev.value };
        const l = last(); if (l && l.action === 'fill' && l.selector === ev.selector) steps.pop(); // 같은 칸 재입력 → 최종값만
        emit(s); break;
      }
      case 'select': { const s = { action: 'select', selector: ev.selector, value: ev.value }; if (ev.text) s._text = ev.text; emit(s); break; }
      case 'check': { const s = { action: 'check', selector: ev.selector, value: !!ev.value }; if (ev.text) s._text = ev.text; emit(s); break; }
      case 'press': { const s = { action: 'press', key: ev.key }; if (ev.selector) s.selector = ev.selector; emit(s); break; }
      case 'expectVisible': { const s = { action: 'expectVisible', selector: ev.selector }; if (ev.text) s._text = ev.text; emit(s); break; }
      case 'expectText': emit({ action: 'expectText', text: ev.text }); break;
      case 'screenshot': emit({ action: 'screenshot', name: `capture${++shotSeq}` }); break;
      default: break;
    }
  };

  // ----- 페이지 이벤트: 이동 / 다이얼로그 / 팝업 / 닫힘
  // 사용자 동작(클릭 등) 직후 3초 안의 이동은 그 동작이 일으킨 것 → waitForLoad. 그 외(주소 입력, JS 리다이렉트)는 goto
  let actionAt = 0;
  const attached = new WeakSet();
  const attach = (p) => {
    if (attached.has(p)) return; attached.add(p);
    p.on('framenavigated', (f) => {
      if (!armed || closed || f !== p.mainFrame()) return;
      const u = f.url(); if (!u || u === 'about:blank') return;
      chain = chain.then(() => {
        if (p !== curPage) return; // 팝업 초기 로드 등은 popup 처리에서
        const l = last();
        if (now() - actionAt < 3000) { if (l?.action !== 'waitForLoad') emit({ action: 'waitForLoad' }); }
        else if (l?.action === 'goto' && now() - lastAt < 1500) { l.url = rel(u); }
        else emit({ action: 'goto', url: rel(u) });
        curFrame = p.mainFrame();
      });
    });
    p.on('dialog', async (d) => {
      const m = d.message();
      await d.accept().catch(() => {});
      if (!armed || closed) return;
      chain = chain.then(() => { emit({ action: 'expectDialog', text: m.replace(/\s+/g, ' ').trim().slice(0, 40), _dialog: d.type() }); });
    });
    p.on('close', () => {
      if (closed) return;
      if (p === mainPage) return finish('closed');
      chain = chain.then(() => { if (curPage === p) { emit({ action: 'closePopup' }); curPage = mainPage; curFrame = mainPage.mainFrame(); } });
    });
  };
  context.on('page', (np) => {
    attach(np);
    if (!armed || closed) return;
    chain = chain.then(async () => {
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      const l = last();
      if (l && /^(click|dblclick|press)$/.test(l.action) && now() - actionAt < 5000) l.popup = true;
      else emit({ action: 'note', _note: `새 창이 열렸으나 직전 클릭을 찾지 못함: ${np.url()}` });
      curPage = np; curFrame = np.mainFrame(); lastAt = now();
    });
  });
  context.on('close', () => finish('closed'));

  const mainPage = await context.newPage();
  attach(mainPage);
  curPage = mainPage; curFrame = mainPage.mainFrame();
  await context.addInitScript(INJECT);

  try {
    if (opt.login !== false && sc.login) {
      log('▶ 로그인 (기록 안 함)');
      await mainPage.goto(abs(sc.login.url), { waitUntil: 'domcontentloaded' });
      await runLoginSteps(mainPage, sc.login.steps || [], abs, sub);
      await mainPage.waitForLoadState('networkidle').catch(() => {});
    }
    armed = true;
    const start = opt.url || '/';
    await mainPage.goto(abs(start), { waitUntil: 'domcontentloaded' });
    await sleep(300);
    if (!steps.length) emit({ action: 'goto', url: rel(mainPage.url()) });
    // 프레임 안에 툴바가 없어도 메인 툴바는 항상 보이게 재확인
    await mainPage.evaluate(() => document.getElementById('__wwt_bar') || (window.__wwtInstalled = false)).catch(() => {});
    log('⏺ 녹화 시작 — 브라우저에서 조작하세요. 상단 툴바 [■ 종료] 로 마칩니다');
    opt.onState?.({ recording: true, url: mainPage.url() });
  } catch (e) {
    finish('error: ' + e.message.split('\n')[0]);
    throw e;
  }

  return {
    steps, done, page: mainPage,
    stop: () => finish('user'),
    remove: (i) => { if (i >= 0 && i < steps.length) { steps.splice(i, 1); updateCount(); } },
    add: (s) => { steps.push(s); updateCount(); },
  };
}

// 기록 스텝 정리: 연속 waitForLoad 합치기, 마지막 press Enter 뒤 waitForLoad 등 — 저장 직전 GUI/CLI 가 호출
export function tidySteps(steps) {
  const out = [];
  for (const s of steps) {
    const l = out[out.length - 1];
    if (s.action === 'waitForLoad' && l?.action === 'waitForLoad') continue;
    if (s.action === 'note' && !s._note) continue;
    out.push(s);
  }
  return out;
}
