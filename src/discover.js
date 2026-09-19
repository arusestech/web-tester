// 🔍 메뉴 자동 수집(discover): 로그인한 뒤 화면의 링크를 긁어 menus[] 초안을 만든다.
// 소스를 못 보는 환경(폐쇄망·소스 없는 운영 화면)에서 시나리오를 처음 만들 때 쓴다.
// crawl(실행 중 자동 순회) 과 달리 "시나리오 파일에 넣을 목록"을 뽑는 것이 목적이라, 실행은 하지 않고 링크만 모은다.
import { chromium } from 'playwright';
import { loginWithRetry } from './scan.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(sc) {
  const base = { headless: true, chromiumSandbox: true };
  for (const channel of [...new Set([sc.browser?.channel, 'chrome', 'msedge', 'chromium'].filter(Boolean))]) {
    try { return await chromium.launch({ ...base, channel }); } catch { /* 다음 후보 */ }
  }
  return chromium.launch(base);
}

// 브라우저 안에서 실행: 링크 후보 수집.
// href 가 없거나 javascript: 인 메뉴(<a href="#" onclick="goPage('/emp.do')">)도 많아 onclick 에서 경로를 뽑는다.
const COLLECT = (sel) => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const fromJs = (s) => {
    const m = String(s || '').match(/['"]([^'"]*\/[^'"]*\.(?:do|jsp|ub|action|html?|php|nhn)(?:\?[^'"]*)?)['"]/i)
      || String(s || '').match(/(?:location\.href|location\.replace|window\.open|goPage|goMenu|fnMove|fn_move|movePage)\s*[=(]\s*['"]([^'"]+)['"]/i);
    return m ? m[1] : '';
  };
  // href 도 onclick 도 없는 메뉴(<a href="#none" menuurl="VOC1001" menupath="VOC 업무>전체 VOC">)를 위해
  // 요소·부모의 사용자 정의 속성을 그대로 가져온다. 어떤 속성이 화면 주소인지는 Node 쪽에서 판단.
  const SKIP_ATTR = /^(class|style|href|target|onclick|alt|src|rel|role|tabindex|type|width|height|colspan|rowspan|aria-|data-toggle$)/i;
  const attrsOf = (el) => {
    const o = {};
    if (!el || !el.attributes) return o;
    for (const x of el.attributes) if (!SKIP_ATTR.test(x.name) && x.value && x.value.length < 120) o[x.name] = x.value;
    return o;
  };
  // 메뉴 트리(ul>li)에서 상위 메뉴 이름 모으기 → "VOC 관리 > MY VOC > 나의 관심VOC"
  const crumbs = (a) => {
    const parts = [];
    let el = a.closest('li');
    for (let i = 0; i < 3 && el; i++) {
      const ul = el.parentElement && el.parentElement.tagName === 'UL' ? el.parentElement : null;
      const host = ul ? ul.closest('li') : null;
      if (!host) break;
      const link = host.querySelector(':scope > a, :scope > span, :scope > div > a');
      const t = link ? clean(link.innerText || link.textContent) : '';
      if (t && t.length <= 20) parts.unshift(t);
      el = host;
    }
    return parts;
  };
  const out = [];
  for (const a of document.querySelectorAll(sel)) {
    const raw = a.getAttribute('href') || '';
    const js = /^(#|javascript:)/i.test(raw) || !raw;
    let href = js ? fromJs(a.getAttribute('onclick') || raw) : a.href;
    const item = { text: clean(a.innerText || a.textContent), title: clean(a.getAttribute('title')), js, path: crumbs(a), attrs: { ...attrsOf(a.parentElement), ...attrsOf(a) } };
    if (href) {
      if (js) { try { href = new URL(href, location.href).href; } catch { href = ''; } }
      if (href) { out.push({ ...item, href }); continue; }
    }
    if (Object.keys(item.attrs).length) out.push({ ...item, href: '' }); // 속성에서 주소를 만들 수 있는지는 뒤에서 판단
  }
  return out;
};

const CODE = /^([A-Za-z]{2,6})([0-9]{3,6})$/;     // 화면ID 형태 (VOC1001, POR0001)
const SLUG = /^[A-Za-z][\w-]{2,60}$/;             // 슬러그 형태 (vocInterestList)

/**
 * 기존 menus 의 URL 에서 "화면ID/슬러그 → URL" 규칙을 추론한다. 가장 많이 쓰인 모양을 고른다.
 *   /screen/VOC1001.ub (61개) → { pattern: '/screen/{}.ub', shape: /^[A-Za-z]{3}[0-9]{4}$/ }
 *   /vocInterestList  (109개) → { pattern: '/{}',           shape: SLUG }
 */
export function inferPattern(sc) {
  const tally = new Map(); // key → { pattern, shape, sample, n }
  for (const m of sc.menus || []) {
    const u = String(m.url || '');
    if (!u || /^https?:/i.test(u)) continue;
    const seg = u.split('?')[0].split('/').filter(Boolean);
    const last = seg[seg.length - 1] || '';
    const code = last.replace(/\.[a-z]+$/i, '');
    let cand = null;
    const c = code.match(CODE);
    if (c) cand = { pattern: u.replace(code, '{}'), shape: new RegExp(`^[A-Za-z]{${c[1].length}}[0-9]{${c[2].length}}$`), sample: code };
    else if (seg.length === 1 && SLUG.test(code)) cand = { pattern: u.replace(code, '{}'), shape: SLUG, sample: code };
    if (!cand) continue;
    const cur = tally.get(cand.pattern) || { ...cand, n: 0 };
    cur.n++; tally.set(cand.pattern, cur);
  }
  const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  return best || null;
}

const PATHY = /^\/?[\w\-./]+\.(do|jsp|ub|action|html?|php|nhn)(\?.*)?$/i;
// 속성 중 주소처럼 보이는 값 찾기. url/link/page 가 이름에 든 속성을 먼저 본다 (menuurl 이 menuid 보다 우선)
function urlFromAttrs(attrs, rule) {
  const pref = (k) => (/(url|link|page|href|screen|scrn|path)/i.test(k) ? 0 : 1);
  const keys = Object.keys(attrs).sort((a, b) => pref(a) - pref(b));
  for (const k of keys) {
    const v = String(attrs[k]).trim();
    if (!v || /\s/.test(v)) continue;                                  // 공백이 있으면 주소가 아니라 라벨
    if (v.startsWith('/') || PATHY.test(v)) return { url: v, from: k }; // 경로 그대로
    // 규칙 적용은 "이름에 url 이 든 속성" 이거나 "값이 화면ID 형태" 일 때만 (data-click="showThirdMenu" 같은 값에 속지 않게)
    const named = pref(k) === 0;
    if (rule && rule.shape.test(v) && (named || CODE.test(v))) return { url: rule.pattern.replace('{}', v), from: k, code: v };
    if (!rule && named && SLUG.test(v)) return { url: `/${v}`, from: k, code: v };
  }
  return null;
}
// 메뉴 이름: "대메뉴>소메뉴" 형태의 속성 > 트리 계층(ul>li) > name 계열 속성
function nameFromAttrs(attrs, crumbs = [], own = '') {
  for (const [k, v] of Object.entries(attrs)) {
    if (/(path|full|tree)/i.test(k) && String(v).includes('>')) return String(v).split('>').map((s) => s.trim()).filter(Boolean).join(' > ');
  }
  let label = own;
  if (!label) for (const [k, v] of Object.entries(attrs)) if (/(name|nm|label|text|title)/i.test(k) && v && !/^\d+$/.test(String(v))) { label = String(v).trim(); break; }
  if (!label) return '';
  return [...crumbs.filter((c) => c && c !== label), label].join(' > ');
}

// 제외 대상 URL: 로그아웃 / 파일 다운로드·인쇄 엔드포인트 / 파일 확장자 / mailto·tel.
// "마지막 경로 조각이 그 단어일 때"만 본다 — /excelLog(엑셀다운로드이력), /vocPopupList 처럼
// 단어가 이름 안에 들어 있을 뿐인 정상 화면을 놓치지 않기 위해서다.
const SKIP = new RegExp([
  '(?:^|/)(?:logout|logoff|signout|down|download|excel|exceldown|exceldownload|filedown|filedownload|fileview|print|preview|popup)(?:\\.\\w+)?(?:\\?|$)',
  '\\.(?:zip|csv|xlsx?|docx?|pptx?|hwp|pdf|jpe?g|png|gif)(?:\\?|$)',
  '^(?:mailto|tel|javascript):',
].join('|'), 'i');
const SKIP_TEXT = /^(로그아웃|logout|log\s?out|sign\s?out)$/i;

/**
 * sc: 시나리오(로그인 정보 포함), opt: { start, depth, pages, max, secrets, selector, exclude, log, onProgress, isCancelled }
 * 반환: { menus: [{ name, url, text, from, dup }], skipped: [{ url, text, why }], visited: [url], base }
 *   dup=true 면 이미 시나리오 menus 에 있는 URL
 */
export async function discoverMenus(sc, opt = {}) {
  const log = opt.log || (() => {});
  const secrets = opt.secrets || {};
  const sub = (v) => String(v ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => { if (secrets[k] === undefined) throw new Error(`실행 시 입력값 누락: {{${k}}}`); return secrets[k]; });
  const base = String(sc.baseUrl).replace(/\/+$/, '');
  const abs = (u) => (/^https?:/i.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u));
  const origin = new URL(base).origin;
  const depth = Math.max(1, Number(opt.depth ?? 1));
  const pages = Math.max(1, Number(opt.pages ?? 20));
  const max = Math.max(1, Number(opt.max ?? 200));
  const selector = opt.selector || 'a';
  const exclude = (opt.exclude || sc.crawl?.exclude || []).map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
  const forbidden = (sc.forbidden || []).map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
  // 이미 시나리오에 있는 URL (중복 표시용)
  const known = new Set((sc.menus || []).map((m) => (m.url ? abs(m.url) : '')).filter(Boolean));

  // 화면ID → URL 규칙: 옵션으로 직접 주거나(pattern), 시나리오의 기존 menus 에서 추론
  const rule = opt.pattern
    ? { pattern: String(opt.pattern).includes('{}') ? String(opt.pattern) : `${String(opt.pattern).replace(/\/+$/, '')}/{}`, shape: /^[A-Za-z0-9_-]{3,20}$/ }
    : inferPattern(sc);
  if (rule) log(`화면ID → URL 규칙: ${rule.pattern}${rule.sample ? ` (기존 메뉴 ${rule.sample} 에서 추론)` : ''}`);

  const browser = await launch(sc);
  const found = new Map(), skipped = [], visited = [];
  let noUrl = 0; // 주소를 못 만든 링크 수 (규칙이 없을 때)
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: sc.browser?.viewport ?? { width: 1400, height: 900 } });
    ctx.setDefaultTimeout(sc.timeout ?? 10000);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    if (sc.login) { log('▶ 로그인'); await loginWithRetry(page, sc, abs, sub, log); }
    const queue = [{ url: abs(opt.start || sc.login?.after || '/'), level: 1 }];
    const seenPage = new Set();
    while (queue.length && visited.length < pages && found.size < max) {
      if (opt.isCancelled?.()) { log('⏹ 중단'); break; }
      const { url, level } = queue.shift();
      if (seenPage.has(url)) continue;
      seenPage.add(url);
      log(`  ${visited.length + 1}/${pages} 수집 중: ${url}`);
      opt.onProgress?.({ done: visited.length, total: pages, current: url, found: found.size });
      try { await page.goto(url, { waitUntil: 'domcontentloaded' }); } catch (e) { skipped.push({ url, text: '', why: e.message.split('\n')[0] }); continue; }
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(sc.stepDelay ?? 300);
      visited.push(url);

      const links = [];
      for (const f of page.frames()) links.push(...(await f.evaluate(COLLECT, selector).catch(() => [])));
      for (const l of links) {
        if (found.size >= max) break;
        // href 가 없으면 속성에서 주소를 만든다 (menuurl="VOC1001" + 규칙 "/screen/{}.ub")
        let via = null;
        if (!l.href && l.attrs) {
          via = urlFromAttrs(l.attrs, rule);
          if (!via) { if (Object.keys(l.attrs).length) noUrl++; continue; }
          l.href = abs(via.url);
        }
        let u;
        try { u = new URL(l.href); } catch { continue; }
        u.hash = '';
        const full = u.href;
        if (!full.startsWith(origin)) { skipped.push({ url: full, text: l.text, why: '외부 사이트' }); continue; }
        if (SKIP.test(full) || SKIP_TEXT.test(l.text)) { skipped.push({ url: full, text: l.text, why: '로그아웃·파일 다운로드 등 제외 대상' }); continue; }
        if (exclude.some((re) => re.test(full) || re.test(l.text))) { skipped.push({ url: full, text: l.text, why: 'exclude 패턴' }); continue; }
        const name = nameFromAttrs(l.attrs || {}, l.path || [], l.text) || l.text || l.title || decodeURIComponent(full.split('/').pop().split('?')[0]) || full;
        // 금지 단어가 이름에 있으면 버리지 않고 "위험" 표시만 한다 — "결재 목록" 처럼 조회만 하면 되는 화면도 있기 때문.
        // (실제 위험은 화면 안의 버튼이고, 그건 실행할 때 forbidden 이 막는다)
        const hit = forbidden.find((re) => re.test(name));
        if (found.has(full)) continue;
        found.set(full, { name, text: l.text, title: l.title, url: full.startsWith(base) ? full.slice(base.length) || '/' : full, from: url, js: l.js, attr: via?.from, dup: known.has(full), danger: hit ? String(name.match(hit)?.[0] || hit.source) : '' });
        if (level < depth) queue.push({ url: full, level: level + 1 });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // 이름 중복이면 뒤에 번호 (메뉴 이름은 보고서·비교의 키라서 겹치면 헷갈린다)
  const menus = [...found.values()];
  const cnt = new Map();
  for (const m of menus) {
    const n = (cnt.get(m.name) || 0) + 1; cnt.set(m.name, n);
    if (n > 1) m.name = `${m.name} (${n})`;
  }
  const dangerN = menus.filter((m) => m.danger).length;
  log(`\n수집 완료: 메뉴 후보 ${menus.length}개 (새 것 ${menus.filter((m) => !m.dup).length}${dangerN ? `, 위험 단어 ${dangerN}` : ''}) · 방문 ${visited.length}쪽 · 제외 ${skipped.length}건`);
  if (noUrl && !rule) log(`※ 주소를 알 수 없는 링크 ${noUrl}개 — 화면ID가 속성에 있는 사이트 같습니다. "화면ID → URL 규칙"(예: /screen/{}.ub)을 주면 잡을 수 있습니다`);
  return { menus, skipped, visited, base, rule: rule?.pattern || '', noUrl };
}
