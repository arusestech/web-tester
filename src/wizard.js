// 대화형 시나리오 JSON 작성기 (Claude 없이 터미널 질문/답변만으로 생성)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function createPrompt() {
  // 터미널/파이프 입력 모두 지원: line 이벤트를 버퍼링해서 순서대로 소비
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const lines = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (l) => { if (waiters.length) waiters.shift()(l); else lines.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
  const nextLine = () => {
    if (lines.length) return Promise.resolve(lines.shift());
    if (closed) return Promise.resolve('');
    return new Promise((res) => waiters.push(res));
  };
  const ask = async (q, def) => {
    process.stdout.write(def !== undefined && def !== '' ? `${q} [${def}]: ` : `${q}: `);
    const a = (await nextLine()).trim();
    if (!process.stdin.isTTY) process.stdout.write(a + '\n');
    return a === '' ? (def ?? '') : a;
  };
  const yes = async (q, def = true) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));
  const list = async (q, def) => (await ask(q, def)).split(',').map((s) => s.trim()).filter(Boolean);
  return { ask, yes, list, close: () => rl.close() };
}

export async function runWizard(p, scenarioDir) {
  console.log('\n=== 새 시나리오 작성 ===  (Enter = 기본값 사용)\n');
  const sc = {};
  sc.name = await p.ask('프로젝트/시나리오 이름', '내프로젝트');
  sc.baseUrl = (await p.ask('접속 URL (baseUrl)', 'http://localhost:8080')).replace(/\/$/, '');
  const headless = !(await p.yes('브라우저 창을 보면서 실행할까요?', true));
  sc.browser = { channel: 'chrome', headless };
  sc.timeout = 10000;
  sc.stepDelay = 300;
  sc.evidence = { screenshotAll: await p.yes('모든 화면을 스크린샷으로 증적 남길까요?', true) };
  sc.forbidden = await p.list('절대 누르면 안 되는 버튼 텍스트 (쉼표 구분)', '삭제, 발송, 결제, 일괄');

  // ----- 로그인 -----
  if (await p.yes('\n로그인이 필요한가요?', true)) {
    const url = await p.ask('로그인 페이지 URL (baseUrl 기준 상대경로 가능)', '/login.do');
    const idSel = await p.ask('아이디 입력란 셀렉터', 'input[name=userId]');
    const pwSel = await p.ask('비밀번호 입력란 셀렉터', 'input[name=password]');
    const btnSel = await p.ask('로그인 버튼 셀렉터', 'button[type=submit]');
    const id = await p.ask('테스트 계정 ID', 'tester');
    const pw = await p.ask('테스트 계정 비밀번호', '1234');
    console.log('로그인 성공 판단 기준: 1) URL에 특정 문자열 없음  2) URL에 특정 문자열 있음  3) 화면에 특정 텍스트  4) 특정 요소 보임');
    const mode = await p.ask('선택', '1');
    const success = {};
    if (mode === '2') success.urlContains = await p.ask('URL에 포함되어야 할 문자열', '/main');
    else if (mode === '3') success.text = await p.ask('화면에 있어야 할 텍스트', '로그아웃');
    else if (mode === '4') success.selector = await p.ask('보여야 할 요소 셀렉터', '#logoutBtn');
    else success.urlNotContains = await p.ask('URL에 없어야 할 문자열', 'login');
    sc.login = {
      url,
      steps: [
        { action: 'fill', selector: idSel, value: id },
        { action: 'fill', selector: pwSel, value: pw },
        { action: 'click', selector: btnSel },
      ],
      success,
    };
  }

  // ----- 메뉴 -----
  sc.menus = [];
  console.log('\n--- 메뉴 목록 --- (이름을 비워두면 종료)');
  for (let i = 1; ; i++) {
    const name = await p.ask(`메뉴 ${i} 이름`);
    if (!name) break;
    const url = await p.ask(`  ${name} URL`, '/');
    const expect = await p.list('  꼭 보여야 하는 요소 셀렉터 (쉼표 구분, 없으면 Enter)', '');
    const m = { name, url };
    if (expect.length) m.expect = expect;
    sc.menus.push(m);
  }

  // ----- 자동 수집 -----
  const crawl = await p.yes('\n사이드바/탑메뉴 링크를 자동으로 수집해서 전부 방문할까요?', sc.menus.length === 0);
  sc.crawl = {
    enabled: crawl,
    startUrl: crawl ? await p.ask('수집 시작 페이지 URL', '/') : '/',
    selector: crawl ? await p.ask('메뉴 링크 셀렉터', 'nav a, #sidebar a, .menu a, .gnb a, .lnb a') : 'nav a, #sidebar a, .menu a, .gnb a, .lnb a',
    exclude: ['logout', 'download'],
    maxPages: 100,
  };

  // ----- CRUD -----
  sc.crud = [];
  if (await p.yes('\nCRUD(등록/수정) 흐름도 추가할까요? (셀렉터를 알아야 합니다)', false)) {
    console.log('스텝 형식: action selector [value]  예) goto /emp/list.do | click text=등록 | fill input[name=empName] 홍길동 | expectText 저장되었습니다 | 빈 줄=종료');
    for (let i = 1; ; i++) {
      const name = await p.ask(`흐름 ${i} 이름`);
      if (!name) break;
      const steps = [];
      for (;;) {
        const line = await p.ask('  스텝');
        if (!line) break;
        const [action, ...rest] = line.split(/\s+/);
        const s = { action };
        if (action === 'goto') s.url = rest.join(' ');
        else if (/^expect(Text|NotText|Dialog)$/.test(action)) s.text = rest.join(' ');
        else if (action === 'expectUrl') s.contains = rest.join(' ');
        else if (action === 'wait') s.ms = Number(rest[0] || 1000);
        else if (action === 'press') { s.key = rest.pop(); if (rest.length) s.selector = rest.join(' '); }
        else {
          const target = rest.shift() || '';
          if (target.startsWith('text=')) s.text = target.slice(5); else s.selector = target;
          if (rest.length) s.value = rest.join(' ');
        }
        steps.push(s);
      }
      if (steps.length) sc.crud.push({ name, steps });
    }
  }

  // ----- 저장 -----
  fs.mkdirSync(scenarioDir, { recursive: true });
  const fileDef = path.join(scenarioDir, `${sc.name.replace(/[^\w가-힣-]+/g, '_')}.json`);
  let file = await p.ask('\n저장할 파일 경로', fileDef);
  file = path.resolve(file);
  if (fs.existsSync(file) && !(await p.yes(`이미 있습니다. 덮어쓸까요? ${file}`, false))) {
    file = path.resolve(await p.ask('다른 파일 경로'));
  }
  fs.writeFileSync(file, JSON.stringify(sc, null, 2), 'utf8'); // BOM 없이 저장
  console.log(`\n저장됨: ${file}\n(세부 조정은 파일을 직접 편집하세요 — README.md 참고)`);
  return file;
}

// 시나리오 폴더에서 JSON 고르기. 반환: 파일 경로 | 'new' | null
export async function pickScenario(p, scenarioDir) {
  const files = fs.existsSync(scenarioDir)
    ? fs.readdirSync(scenarioDir).filter((f) => f.endsWith('.json')).sort()
    : [];
  console.log('\n=== wigo-web-tester ===');
  files.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
  console.log(`  n) 새 시나리오 JSON 작성`);
  console.log(`  p) 다른 경로의 JSON 파일 지정`);
  console.log(`  q) 종료`);
  const a = await p.ask('선택', files.length ? '1' : 'n');
  if (/^q/i.test(a)) return null;
  if (/^n/i.test(a)) return 'new';
  if (/^p/i.test(a)) { const f = await p.ask('JSON 파일 경로'); return f ? path.resolve(f) : null; }
  const idx = Number(a) - 1;
  if (files[idx]) return path.join(scenarioDir, files[idx]);
  console.log('잘못된 선택');
  return pickScenario(p, scenarioDir);
}
