// GUI 자동 검증: 서버를 띄우고 Playwright 로 화면을 조작한다.
//   1) npm run mock  (가짜 사이트 :3999) 를 먼저 띄울 것
//   2) node test/gui-check.mjs
// 임시 프로젝트 "자동검증" 을 API 로 만들고, 검사 후 프로젝트와 증적을 지운다.
// 주의: 브라우저에 dialog 핸들러를 달지 않는다 — 실제 앱 창(네이티브 dialog 자동 닫힘)과 같은 조건에서 검증해야 한다.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.WWT_TEST_PORT || 8766);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token'; // 서버를 WWT_TOKEN=test-token 으로 띄우고 이 값으로 접속 (토큰 검사 경로까지 검증)
const PROJECT = '자동검증';
const ok = [], bad = [];
const check = (c, m) => (c ? ok.push(m) : bad.push(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'x-wwt-token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json();
  if (j.error) throw new Error(`${p}: ${j.error}`);
  return j;
};

const common = {
  name: '자동검증 공통', baseUrl: 'http://localhost:3999',
  browser: { channel: 'chrome', headless: true }, evidence: { screenshotAll: false },
  forbidden: ['삭제'], blocked: ['핵심 요소 없음'],
  login: { url: '/login', steps: [
    { action: 'fill', selector: 'input[name=userId]', value: 'tester' },
    { action: 'fill', selector: 'input[name=password]', value: '1234' },
    { action: 'click', selector: 'button[type=submit]' },
  ], success: { urlNotContains: 'login' } },
  menus: [
    { name: '메인', url: '/main', expect: ['#content'] },
    { name: '사원관리', url: '/emp', expect: ['table'] },
    { name: '에러메뉴', url: '/err' },
  ],
};

const srv = spawn(process.execPath, ['cli.js', 'gui', '--no-open', '--port', String(PORT)], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, WWT_TOKEN: TOKEN, WWT_NO_CONFIG: '1' } });
await sleep(2500);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
let allowErr = false; // 일부러 오류를 내는 검사(없는 파일 열기 등) 동안에는 콘솔 오류를 세지 않는다
let scanReportDir = '';  // 📂 소스 스캔이 만든 보고서 폴더 (정리에서 지운다)
page.on('console', (m) => { if (m.type() === 'error' && !allowErr) errors.push('console: ' + m.text()); });

try {
  // 임시 프로젝트 + 상속 시나리오 3개
  await api('/api/folder', { dir: PROJECT });
  await api('/api/scenario', { file: `${PROJECT}/_공통.json`, content: JSON.stringify(common) });
  await api('/api/scenario', { file: `${PROJECT}/A-역할1.json`, content: JSON.stringify({ extends: '_공통.json', name: '자동검증 역할1' }) });
  await api('/api/scenario', { file: `${PROJECT}/B-역할2.json`, content: JSON.stringify({ extends: '_공통.json', name: '자동검증 역할2', menusExclude: ['에러메뉴'], menusAdd: [{ name: '요소누락', url: '/main', expect: ['table'] }] }) });

  // 토큰 없이 /api/* 를 부르면 403 (CSRF·DNS 리바인딩 방지)
  const noTok = await fetch(BASE + '/api/scenarios');
  check(noTok.status === 403, `토큰 없는 /api 요청 차단 (403) — 실제 ${noTok.status}`);

  await page.goto(BASE + '/?t=' + TOKEN, { waitUntil: 'networkidle' });
  check(errors.length === 0, `페이지 JS 에러 없음 ${errors.length ? '→ ' + errors.join(' | ') : ''}`);
  // ⚙ 전체 설정: GET 은 객체를 주고, 버튼을 누르면 순회 속도 다이얼로그가 뜬다 (저장은 안 눌러 config.json 을 건드리지 않는다)
  const cfg = await api('/api/config');
  check(cfg && typeof cfg.config === 'object', '/api/config 가 설정 객체를 반환');
  await page.click('header button[onclick="settingsDialog()"]');
  await sleep(300);
  check(await page.locator('#cfgSpeed').count() > 0, '⚙ 설정 다이얼로그에 순회 속도 선택 표시');
  await page.click('#cfgNo'); // 취소로 닫기
  await sleep(150);

  await page.selectOption('#proj', PROJECT);
  await sleep(500);
  const tree = await page.locator('#list').innerText();
  check(/자동검증 역할1/.test(tree), '사이드바에 시나리오 표시');
  check(/🔗상속/.test(tree), '상속 시나리오에 🔗상속 표시');
  check(!/공통/.test(tree), '_ 로 시작하는 공통 파일은 목록에서 제외');

  // 편집 탭: 상속 배너 + 상속받은 메뉴가 폼에 보이는지 + 저장 시 상속 유지
  await page.locator('.sc').first().click();
  await sleep(800);
  await page.click('nav button[data-tab=edit]');
  check(/상속 중/.test(await page.locator('#inheritBox').innerText()), '편집 탭 🔗 상속 배너');
  check((await page.locator('#menuRows tr').count()) === 3, '상속받은 메뉴 3개가 폼에 표시');
  const j = JSON.parse(await page.evaluate(() => JSON.stringify(formToJson())));
  check(j.extends === '_공통.json', 'formToJson 이 extends 유지');
  check(!('menus' in j) && !('login' in j) && !('forbidden' in j), '부모와 같은 값은 파일에 쓰지 않음');

  // 새 시나리오는 빈 폼으로 시작 (이전 값이 따라오지 않음)
  await page.evaluate(() => newScenario());
  await sleep(200);
  check((await page.locator('#f_name').inputValue()) === '' && (await page.locator('#f_baseUrl').inputValue()) === '' && (await page.locator('#f_forbidden').inputValue()) === '', '새 시나리오는 빈 폼으로 시작');
  // 다른 시나리오에서 접속 URL·로그인만 가져오기 (이름·메뉴는 그대로)
  await page.fill('#f_name', '가져오기테스트');
  await page.click('button[onclick="importConnLogin()"]');
  await sleep(200);
  await page.locator('.overlay [data-i]').first().click();
  await sleep(300);
  check((await page.locator('#f_baseUrl').inputValue()).length > 0, '가져오기: 접속 URL 이 채워짐');
  check((await page.locator('#f_name').inputValue()) === '가져오기테스트', '가져오기: 이름은 그대로 유지');
  // 원래 시나리오를 다시 열어 이후 검사(메뉴 수집 등)의 상태를 복원
  await page.locator('.sc').first().click();
  await sleep(700);
  await page.click('nav button[data-tab=edit]');
  await sleep(200);

  // 실행 탭 옵션
  await page.click('nav button[data-tab=run]');
  check(await page.locator('#cmpPrev').isChecked(), '이전 결과와 비교 기본 켬');
  check(!(await page.locator('#failOnly').isChecked()), '실패건만 재실행 기본 끔');

  // 프로젝트 일괄 실행 (전체) → 매트릭스
  await page.evaluate((p) => selectDir(p), PROJECT);
  await page.check('#headless');
  await page.click('#btnRun');
  const waitDone = async () => { for (let i = 0; i < 180; i++) { await sleep(1000); if ((await page.locator('#runState').innerText()) === '대기' && /증적 폴더/.test(await page.locator('#log').innerText())) return true; } return false; };
  check(await waitDone(), '일괄 실행 완료');
  let log = await page.locator('#log').innerText();
  check(/시나리오별 매트릭스/.test(log), '일괄 보고서에 매트릭스 생성');
  check(/증상 분류/.test(log), '규칙 기반 증상 분류 출력');
  const resTable = await page.locator('#results').innerText();
  check(/서버 버그/.test(resTable), '결과 표에 분류 태그 표시');
  check(/\d+\.\d/.test(resTable), '결과 표에 소요시간(초) 표시');
  check(/결함 CSV/.test(await page.locator('#reportLink').innerHTML()), '실행 후 결함 CSV 링크');

  // 보고서: 요약 칸(전체/정상/실패/주의)을 누르면 그 항목만 보이는지
  const repHref = await page.locator('#reportLink a').first().getAttribute('href');
  const rep = await browser.newPage();
  await rep.goto(BASE + repHref, { waitUntil: 'domcontentloaded' });
  const visible = () => rep.locator('#tbl tbody tr:not(.hide)').count();
  const total = await visible();
  await rep.click('.sum .f[data-f="fail"]');
  const onlyFail = await rep.locator('#tbl tbody tr:not(.hide)').count();
  const allFail = await rep.locator('#tbl tbody tr:not(.hide).fail').count();
  check(onlyFail > 0 && onlyFail < total && onlyFail === allFail, `보고서 요약 "실패" 클릭 → 실패만 표시 (${total} → ${onlyFail})`);
  const shotsShown = await rep.locator('section.shot:not(.hide)').count();
  const shotsFail = await rep.locator('section.shot:not(.hide).fail').count();
  check(shotsShown === shotsFail, '스크린샷 영역도 같이 걸러짐');
  await rep.click('.sum .f[data-f="all"]');
  check((await visible()) === total, '"전체" 로 되돌리기');
  await rep.close();

  // 실패건만 재실행 + 직전 실행 비교
  await page.check('#failOnly');
  await page.click('#btnRun');
  await sleep(1500);
  check(await waitDone(), '실패건만 재실행 완료');
  log = await page.locator('#log').innerText();
  check(/실패건만 재실행/.test(log), 'GUI 실패건만 재실행 동작');
  check(/직전 실행 대비/.test(log), '직전 실행 비교 출력');

  // 증적 탭
  await page.click('nav button[data-tab=reports]');
  await sleep(1200);
  // 결함 CSV 는 브라우저 다운로드가 아니라 OS 기본 프로그램으로 연다 (앱 창에서 다운로드가 안 되는 문제)
  // 실제로 엑셀을 띄우면 곤란하니 없는 파일로 오류 경로만 확인한다
  allowErr = true;
  const csvErr = await page.evaluate(async () => { try { await api('/api/open', { what: 'file', dir: '없는폴더', name: 'defects.csv' }); return ''; } catch (e) { return e.message; } });
  await sleep(300); allowErr = false;
  check(/파일이 없습니다/.test(csvErr), '결함 CSV 열기: 없는 파일이면 안내 메시지');

  const repRows = await page.locator('#reportRows').innerText();
  check(/실패만 재실행/.test(repRows), '증적 탭에 ↻ 실패만 재실행 링크');
  check(/CSV/.test(repRows), '증적 탭에 결함 CSV 링크');
  // 일괄 증적 행을 펼치면 그 일괄의 시나리오별 하위 행이 나타난다 (일괄 실행이 여러 번 있을 수 있어 첫 행 것만 본다)
  const firstBatch = page.locator('#reportRows tr[data-bx]').first();
  check(await firstBatch.count() > 0, '증적 탭에 일괄(🗂️) 행 펼치기 버튼');
  const bx = await firstBatch.getAttribute('data-bx');
  const kidState = () => page.locator(`#reportRows tr.child-${bx}`).evaluateAll((els) => els.map((e) => ({ disp: e.style.display, txt: (e.querySelector('.cname')?.textContent || '') })));
  const kidsBefore = await kidState();
  check(kidsBefore.length > 0 && kidsBefore.every((k) => k.disp === 'none'), '펼치기 전 시나리오별 하위 행은 숨김');
  await firstBatch.locator('.exp').click(); await sleep(300);
  const kidsAfter = await kidState();
  check(kidsAfter.length > 0 && kidsAfter.every((k) => k.disp !== 'none'), '펼치면 시나리오별 하위 행이 보임');
  const kidNames = await page.locator('#reportRows tr.childrow .cname').allTextContents();
  check(kidNames.some((t) => /↳\s*자동검증 역할/.test(t)), '하위 행에 시나리오명 표시');
  // 편집 탭 안정성·성능 설정이 JSON 으로 왕복되는지
  await page.click('nav button[data-tab=edit]');
  await page.fill('#f_retry', '1'); await page.fill('#f_slow', '3'); await page.check('#f_ckLayout');
  await page.selectOption('#f_reuse', 'on');   // 기본(프로젝트 상속) / 사용 / 사용 안 함 3단
  const j2 = JSON.parse(await page.evaluate(() => JSON.stringify(formToJson())));
  check(j2.retry === 1 && j2.slowMs === 3000 && j2.checks?.layout === true, '재시도·느린화면 기준·가로스크롤 검사 저장');
  check(j2.reuseSession === true, '로그인 세션 재사용이 reuseSession 으로 저장');
  // 테스트 데이터(변수) 라운드트립
  await page.evaluate(() => addVarRow({ key: 'custName', value: '목업고객' }));
  const j3 = JSON.parse(await page.evaluate(() => JSON.stringify(formToJson())));
  check(j3.vars?.custName === '목업고객', '테스트 데이터(변수) 가 vars 로 저장됨');
  // 인터페이스 목업 라운드트립
  await page.fill('#f_mocks', JSON.stringify([{ url: '/api/ext', json: { code: '0000' } }]));
  const j4 = JSON.parse(await page.evaluate(() => JSON.stringify(formToJson())));
  check(Array.isArray(j4.mocks) && j4.mocks[0]?.url === '/api/ext', '인터페이스 목업이 mocks 로 저장됨');

  // 🔍 메뉴 자동 수집 (로그인 → 링크 수집 → 선택 추가)
  await page.click('button:has-text("화면에서 메뉴 수집")');
  await page.fill('#dcUrl', '/main');
  await page.click('#dcStart');
  await page.waitForSelector('#dcRows tr', { timeout: 90000 });
  const dc = await page.locator('#dcRows').innerText();
  check(/사원관리/.test(dc), '메뉴 수집 결과 표시');
  check(/이미 있음/.test(dc), '이미 있는 메뉴는 중복 표시');
  check(!/로그아웃/.test(dc), '로그아웃 링크는 제외');
  const before = await page.locator('#menuRows tr').count();
  await page.click('#dcAdd');
  check((await page.locator('#menuRows tr').count()) > before, '고른 메뉴가 메뉴 표에 추가됨');

  // 📂 소스에서 만들기 (test/source-fixture 를 정적 분석 → 접속·로그인·금지버튼·메뉴 적용)
  await page.click('button:has-text("소스에서 만들기")');
  await page.fill('#ssRoot', path.join(ROOT, 'test', 'source-fixture'));
  await page.click('#ssStart');
  await page.waitForSelector('#ssRows tr', { timeout: 60000 });
  const ss = await page.locator('#ssRows').innerText();
  check(/사원관리/.test(ss), '소스 스캔 결과에 메뉴 표시');
  check(/menu-sql|controller/.test(ss), '메뉴마다 출처 표시');
  check(/source-scan\.html/.test(await page.locator('#ssStatus').innerHTML()), '소스분석 보고서 링크 표시');
  // 🖱 버튼 동작 검사 옵션: 체크하고 다시 분석하면 안전한 버튼이 actions 로 온다
  await page.check('#ssActions');
  await page.click('#ssStart');
  await page.waitForFunction(() => document.querySelector('#ssRows')?.innerText.includes('🖱'), null, { timeout: 60000 }).catch(() => {});
  check((await page.locator('#ssRows').innerText()).includes('🖱'), '버튼 동작 검사 옵션을 켜면 결과에 🖱 표시');
  // 보고서 폴더는 다이얼로그가 닫히기 전에 받아 둔다 (닫으면 #ssStatus 가 사라진다)
  scanReportDir = await page.evaluate(() => decodeURI((document.querySelector('#ssStatus a')?.getAttribute('href') || '').replace('/reports/', '').replace('/source-scan.html', '')));
  const before2 = await page.locator('#menuRows tr').count();
  await page.click('#ssAdd');
  check((await page.locator('#menuRows tr').count()) > before2, '소스에서 찾은 메뉴가 메뉴 표에 추가됨');
  check((await page.inputValue('#f_baseUrl')) === 'http://localhost:9090/demo', '소스의 접속 URL 이 폼에 적용됨');
  // 폼에는 칸이 없는 actions 가 저장 왕복에서 살아남아야 한다 (없으면 GUI 로 저장하는 순간 버튼 검사가 사라진다)
  const jAct = JSON.parse(await page.evaluate(() => JSON.stringify(formToJson())));
  check(jAct.menus.some((m) => m.actions?.some((a) => a.click === '#btnSearch')), '버튼 동작(actions)이 폼 저장에서 보존됨');
  // 폼에 칸이 없는 메뉴 키(timeout·waitFor·mask·retry·expectFail·confirm …)도 저장 왕복에서 살아남아야 한다
  const jRest = JSON.parse(await page.evaluate(() => {
    addMenuRow({ name: '보존검사', url: '/keep', expect: ['#a'], timeout: 30000, waitFor: '#grid', loading: '.loading', mask: ['#custNm'], retry: 1, expectFail: 'HTTP 403', confirm: 'accept', _comment: '메모' });
    const j = JSON.stringify(formToJson());
    document.querySelector('#menuRows').lastElementChild.remove();
    return j;
  }));
  const kept = jRest.menus.find((m) => m.name === '보존검사') || {};
  check(kept.timeout === 30000 && kept.waitFor === '#grid' && kept.loading === '.loading' && kept.mask?.[0] === '#custNm' && kept.retry === 1 && kept.expectFail === 'HTTP 403' && kept.confirm === 'accept' && kept._comment === '메모',
    '폼에 칸이 없는 메뉴 키(timeout·waitFor·loading·mask·retry·expectFail·confirm)가 폼 저장에서 보존됨', JSON.stringify(kept));
  check(Object.keys(kept)[0] === 'name' && kept.expect?.[0] === '#a', '보존한 키가 있어도 name 이 맨 앞, 폼 값은 그대로');
  check((await page.inputValue('#f_pwSel')) === '#userPw', '소스의 로그인 셀렉터가 폼에 적용됨');
  check(/삭제/.test(await page.inputValue('#f_forbidden')), '소스에서 찾은 금지 버튼이 폼에 적용됨');
  // 이 시나리오는 이후 검사에 쓰이지 않도록 원래 값으로 되돌린다
  await page.evaluate(() => select(current));
  await sleep(400);

  // 사이드바 숨기기 / 폭 조절
  const asideW = () => page.evaluate(() => document.querySelector('aside').getBoundingClientRect().width);
  const w0 = await asideW();
  await page.click('#asideTgl');
  check(await page.locator('aside').isHidden(), '☰ 로 왼쪽 목록 숨기기');
  await page.click('#asideTgl');
  check(await page.locator('aside').isVisible(), '☰ 로 다시 열기');
  const box = await page.locator('#drag').boundingBox();
  await page.mouse.move(box.x + 3, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 203, box.y + 100, { steps: 8 }); await page.mouse.up();
  const w1 = await asideW();
  check(w1 > w0 + 100, `드래그로 폭 넓히기 (${Math.round(w0)} → ${Math.round(w1)}px)`);
  await page.mouse.move(box.x + 203, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 3000, box.y + 100, { steps: 8 }); await page.mouse.up();
  const w2 = await asideW(), half = await page.evaluate(() => window.innerWidth / 2);
  check(w2 <= half + 1, `폭은 화면 절반까지만 (${Math.round(w2)} ≤ ${Math.round(half)})`);
  await page.dblclick('#drag');
  check(Math.abs((await asideW()) - 300) < 2, '더블클릭하면 기본 폭으로');

  // 시나리오 검사(lint)
  await page.click('nav button[data-tab=edit]');
  const lintOk = JSON.parse(await page.evaluate(async () => JSON.stringify(await api('/api/lint', { scenario: { name: 'x', baseUrl: 'http://localhost:3999', menus: [{ name: 'A', url: '/a' }, { name: 'A', url: '/b' }] } }))));
  check((lintOk.issues || []).some((i) => i.level === 'error' && /중복/.test(i.msg)), '검사: 메뉴 이름 중복을 오류로 잡음');
  const lintOk2 = JSON.parse(await page.evaluate(async () => JSON.stringify(await api('/api/lint', { scenario: { name: 'x', menus: [] } }))));
  check((lintOk2.issues || []).some((i) => /baseUrl/.test(i.msg)), '검사: baseUrl 누락을 잡음');

  // 증적 탭을 보는 중에 시나리오를 바꾸면 목록이 다시 그려지는지 (예전 버그)
  await page.click('nav button[data-tab=reports]');
  await sleep(800);
  const t1 = await page.locator('#repTitle').innerText();
  await page.locator('.sc').nth(1).click();
  await sleep(1200);
  const t2 = await page.locator('#repTitle').innerText();
  check(t1 !== t2, `증적 탭에서 시나리오 전환 시 자동 새로고침 (${t1.slice(0, 28)} → ${t2.slice(0, 28)})`);

  // 프로젝트 공통 설정(_project.json) 상속: 설정을 두면 새 시나리오가 그 값을 기본 상속(잠금·저장 시 생략)
  await page.click('nav button[data-tab=edit]');
  await api('/api/project', { dir: PROJECT, config: { browser: { channel: 'msedge' } } });
  await page.evaluate(() => newScenario());
  await sleep(300);
  const inhB = await page.evaluate(() => ({ on: document.querySelector('#inh_browser').checked, dis: document.querySelector('#f_channel').disabled, ch: document.querySelector('#f_channel').value, omit: !('browser' in formToJson()) }));
  check(inhB.on && inhB.dis && inhB.ch === 'msedge' && inhB.omit, '프로젝트 공통 설정을 새 시나리오가 기본 상속(잠금·저장 시 생략)');

  // 로그인 세션 재사용(reuseSession): 프로젝트 설정 → 시나리오가 기본 상속 (자기 파일에는 안 쓴다)
  await api('/api/project', { dir: PROJECT, config: { browser: { channel: 'msedge' }, reuseSession: true } });
  const pj = await api('/api/project?dir=' + encodeURIComponent(PROJECT));
  check(pj.config?.reuseSession === true, '프로젝트 설정에 로그인 세션 재사용이 저장됨');
  const resolvedReuse = await api('/api/scenario?file=' + encodeURIComponent(`${PROJECT}/A-역할1.json`));
  check(resolvedReuse.resolved?.reuseSession === true || resolvedReuse.project?.reuseSession === true, '시나리오가 프로젝트의 세션 재사용을 상속');
  await page.evaluate(() => newScenario());
  await sleep(300);
  const rs = await page.evaluate(() => ({ v: document.querySelector('#f_reuse').value, hint: document.querySelector('#f_reuseHint').textContent, omit: !('reuseSession' in formToJson()) }));
  check(rs.v === '' && rs.omit, '편집 폼 기본값 = "기본(프로젝트 상속)" 이고 저장 JSON 에 키를 안 쓴다');
  check(/프로젝트: 사용/.test(rs.hint), '상속 중인 값이 폼에 안내로 표시됨');
  await page.selectOption('#f_reuse', 'off');
  const rsOff = await page.evaluate(() => formToJson().reuseSession);
  check(rsOff === false, '"사용 안 함"을 고르면 이 시나리오만 false 로 저장');
  await api('/api/project', { dir: PROJECT, config: {} }); // _project.json 정리

  check(errors.length === 0, `전체 흐름 후 JS 에러 없음 ${errors.length ? '→ ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  bad.push('예외: ' + e.message.split('\n')[0]);
} finally {
  // 정리: 임시 프로젝트와 그 증적 (브라우저를 먼저 닫아야 빈 폴더가 남지 않는다)
  try { for (const r of await api('/api/reports')) if (r.dir.startsWith(PROJECT + '/') || r.dir === PROJECT) await api('/api/report/delete', { dir: r.dir }); } catch { /* ignore */ }
  // 소스 스캔 검증이 만든 소스분석 보고서 폴더도 지운다 (사용자 증적과 섞이지 않게)
  if (scanReportDir) { try { await api('/api/report/delete', { dir: scanReportDir }); } catch { /* ignore */ } }
  await browser.close();
  await sleep(300);
  for (let i = 0; i < 3; i++) { try { await api('/api/folder/delete', { dir: PROJECT }); } catch { /* ignore */ } await sleep(200); }
  srv.kill();
  console.log('\n===== GUI 검증 =====');
  ok.forEach((m) => console.log('  ✅ ' + m));
  bad.forEach((m) => console.log('  ❌ ' + m));
  console.log(`${ok.length} ok / ${bad.length} fail`);
  process.exit(bad.length ? 1 : 0);
}
