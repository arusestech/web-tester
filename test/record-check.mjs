// ⏺ 녹화 자체 검증 — mock /rec 화면을 헤드리스로 조작해 기록된 스텝을 확인하고, 그 스텝을 그대로 재생해 본다.
// 실행: node test/record-check.mjs   (mock 서버가 안 떠 있으면 직접 띄웠다가 내린다)
//   녹화기는 "기록은 되는데 재생하면 깨지는" 문제가 생기기 쉬워서, 기록 결과뿐 아니라 재생 성공까지 본다.
process.env.WWT_NO_CONFIG = '1';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startRecorder, tidySteps } from '../src/recorder.js';
import { runScenario } from '../src/runner.js';
import { lintScenario } from '../src/lint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3999';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0, fail = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra ? `  — ${extra}` : ''}`); }
};

// ---------- mock 서버 ----------
const up = async () => { try { return (await fetch(`${BASE}/login`)).ok; } catch { return false; } };
let mock = null;
if (!(await up())) {
  mock = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], { stdio: 'ignore' });
  for (let i = 0; i < 30 && !(await up()); i++) await sleep(200);
  if (!(await up())) { console.error('mock 서버를 띄우지 못했습니다 (:3999)'); process.exit(3); }
}

const SC = {
  name: '녹화 자체검증',
  baseUrl: BASE,
  browser: { headless: true },
  timeout: 8000,
  forbidden: ['삭제'],
  login: {
    url: '/login',
    steps: [
      { action: 'fill', selector: 'input[name=userId]', value: 'tester' },
      { action: 'fill', selector: 'input[name=password]', value: '{{password}}' },
      { action: 'click', selector: 'button[type=submit]' },
    ],
    success: { urlNotContains: 'login' },
  },
};
const secrets = { password: '1234' };

// 녹화 1회: drive(page) 로 조작 → 기록된 스텝 반환
async function record(drive, opt = {}) {
  const rec = await startRecorder(SC, { url: '/rec', login: true, secrets, headless: true, log: () => {}, ...opt });
  const page = rec.page;
  const result = () => page.locator('#result').innerText();
  let out;
  try { out = await drive(page, result); await sleep(400); } finally { rec.stop(); }
  return { steps: tidySteps(await rec.done), out };
}
const find = (steps, fn) => steps.find(fn);
const idx = (steps, fn) => steps.findIndex(fn);
const show = (steps) => steps.map((s) => `${s.action} ${s.selector ?? s.url ?? s.text ?? ''}`).join(' | ');

const tmpFile = path.join(os.tmpdir(), `wwt-rec-upload-${Date.now()}.txt`);
fs.writeFileSync(tmpFile, 'upload test', 'utf8');

try {
  // ======================================================================
  console.log('\n■ 기본 기록 (입력·선택·체크·이동)');
  const main = await record(async (page) => {
    await page.fill('#title', '녹화 테스트');
    await page.selectOption('#kind', 'B');
    await page.check('#agree');
    // 달력: 입력란 클릭 → 이전달 → 16일
    await page.click('#fromDt');
    await page.click('#cal a.prev');
    await page.click('#cal a.day >> nth=1');
    await sleep(500);
    // 마우스를 올려야 펼쳐지는 메뉴
    await page.hover('#gnb li.top > span');
    await page.click('#subItem');
    await sleep(300);
    await page.mouse.move(600, 500);
    // 파일 첨부
    await page.setInputFiles('#attach', tmpFile);
    await sleep(300);
    // 목록 행: 다른 행에도 있는 글자("접수") 칸을 누른다
    await page.click('#list tr:has-text("C-0002") td >> nth=1');
    await sleep(300);
    // 등록 → 1.5초 뒤 알림
    await page.click('#btnSave');
    await sleep(2300);
  });
  const st = main.steps;
  check(st[0]?.action === 'goto' && st[0].url === '/rec', '시작 화면이 goto 로 기록됨', show(st.slice(0, 1)));
  check(!!find(st, (s) => s.action === 'fill' && s.selector === '#title' && s.value === '녹화 테스트'), '입력값이 fill 로 기록됨');
  check(!!find(st, (s) => s.action === 'select' && s.selector === '#kind' && s.value === 'B'), 'select 기록됨');
  check(!!find(st, (s) => s.action === 'check' && s.selector === '#agree' && s.value === true), '체크박스 기록됨');
  check(!st.some((s) => s.action === 'fill' && /password/i.test(s.selector || '')), '자동 로그인 과정은 기록되지 않음');

  console.log('\n■ 달력 (값을 스크립트로 넣는 입력란)');
  check(!st.some((s) => s.action === 'click' && /#cal|ui-datepicker|이전달|has-text\("1[56]"\)/.test(s.selector || '')), '달력 안의 클릭은 기록하지 않음', show(st.filter((s) => s.action === 'click')));
  check(!!find(st, (s) => s.action === 'fill' && s.selector === '#fromDt' && s.value === '2026-09-16'), '달력으로 고른 날짜가 fill 로 기록됨', show(st.filter((s) => s.action === 'fill')));

  console.log('\n■ 마우스를 올려야 펼쳐지는 메뉴 / 파일 첨부');
  const iSub = idx(st, (s) => s.action === 'click' && s.selector === '#subItem');
  check(iSub > 0 && st[iSub - 1].action === 'hover', '하위 메뉴 클릭 앞에 hover 스텝이 들어감', iSub > 0 ? show(st.slice(iSub - 1, iSub + 1)) : '클릭 없음');
  const upStep = find(st, (s) => s.action === 'upload');
  check(!!upStep && upStep.selector === '#attach' && /wwt-rec-upload/.test(String(upStep.files?.[0])), '파일 첨부가 upload 스텝으로 기록됨', JSON.stringify(upStep || null));

  console.log('\n■ 목록 행 (행 id 가 숫자, 순서가 바뀌는 목록)');
  const rowStep = find(st, (s) => s.action === 'click' && /#list/.test(s.selector || ''));
  check(!!rowStep && /has-text\("C-0002"\)/.test(rowStep.selector) && !/tr:nth-of-type/.test(rowStep.selector), '행을 순번이 아니라 행 안의 고유 글자로 찾음', rowStep?.selector);

  console.log('\n■ 늦게 뜨는 알림');
  const iSave = idx(st, (s) => s.action === 'click' && s.selector === '#btnSave');
  check(iSave > 0 && st.slice(iSave + 1).some((s) => s.action === 'expectDialog' && /저장되었습니다/.test(s.text)), '등록 뒤 알림이 expectDialog 로 기록됨', show(st.slice(iSave)));

  // ======================================================================
  console.log('\n■ 안전장치 (금지 문구 확인창 / 글자 없는 금지 버튼)');
  const safe = await record(async (page, result) => {
    await page.click('#btnConfirmDel'); await sleep(400);
    const r1 = await result();
    await page.click('a.ico'); await sleep(300);
    return r1;
  });
  check(safe.out === '취소됨', '녹화 중 금지 문구 확인창은 취소됨(데이터 변경 없음)', safe.out);
  check(safe.steps.some((s) => s._warn && /확인창/.test(s._warn)), '취소한 확인창이 경고와 함께 남음', show(safe.steps));
  const ico = find(safe.steps, (s) => s.action === 'click' && /ico/.test(s.selector || ''));
  check(!!ico && !!ico._warn, '글자 없는 아이콘 버튼(img alt=삭제)에도 금지 경고가 붙음', JSON.stringify(ico || null));

  const allow = await record(async (page, result) => { await page.click('#btnConfirmDel'); await sleep(400); return result(); }, { allowForbidden: true });
  check(allow.out === '지웠습니다', 'allowForbidden 으로 녹화하면 확인창을 수락함', allow.out);
  check(allow.steps.some((s) => s.action === 'expectDialog' && /삭제/.test(s.text)), '수락한 확인창이 expectDialog 로 기록됨', show(allow.steps));

  // ======================================================================
  console.log('\n■ 기록한 스텝을 그대로 재생');
  // 사람이 하듯: 첨부 파일 경로를 실제 경로로 바꾸고, 중간 결과 확인 스텝을 끼운다
  const replay = [];
  for (const s of st) {
    replay.push(s.action === 'upload' ? { ...s, files: [tmpFile] } : s);
    if (s.action === 'click' && s.selector === '#subItem') replay.push({ action: 'expectText', text: '하위메뉴 열림' });
    if (s.action === 'upload') replay.push({ action: 'expectText', text: '첨부: wwt-rec-upload' });
    if (s === rowStep) replay.push({ action: 'expectText', text: '선택: C-0002' });
  }
  replay.push({ action: 'expectText', text: '저장됨: 녹화 테스트 / 2026-09-16' });
  const sc = { ...SC, evidence: { screenshotAll: false }, crud: [{ name: '녹화 재생', steps: replay }] };
  const lintErr = lintScenario(sc).filter((i) => i.level === 'error');
  check(lintErr.length === 0, '기록한 스텝이 lint 를 통과함', lintErr.map((i) => i.msg).join(' / '));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwt-rec-'));
  const rep = await runScenario(sc, { headless: true, secrets, outDir, compare: false, screenshot: 'none', log: () => {} });
  const flow = JSON.parse(fs.readFileSync(rep.jsonPath, 'utf8')).results.find((r) => r.name === '녹화 재생');
  check(flow?.status === 'ok', '재생 성공 (목록 순서가 바뀌어도 같은 건 선택, 늦은 알림 대기, 달력 값, hover 메뉴, 첨부)', flow ? `${flow.status}: ${flow.issues.map((i) => i.msg).join(' / ')} @ ${flow.step || ''}` : '결과 없음');

  // 같은 알림 문구를 두 번 검사하면 두 번째는 새로 뜬 알림이어야 한다 (한 번 뜬 알림을 재사용하지 않음)
  const twice = { ...SC, evidence: { screenshotAll: false }, crud: [{ name: '알림 재사용 금지', steps: [
    { action: 'goto', url: '/rec' }, { action: 'click', selector: '#btnSave' }, { action: 'expectDialog', text: '저장되었습니다' },
    { action: 'expectDialog', text: '저장되었습니다', timeout: 1500 },
  ] }] };
  const rep2 = await runScenario(twice, { headless: true, secrets, outDir, compare: false, screenshot: 'none', log: () => {} });
  const f2 = JSON.parse(fs.readFileSync(rep2.jsonPath, 'utf8')).results.find((r) => r.name === '알림 재사용 금지');
  check(f2?.status === 'fail' && f2.issues.some((i) => /다이얼로그 없음/.test(i.msg)), '이미 검사한 알림은 다음 expectDialog 에 재사용되지 않음', f2 ? `${f2.status}: ${f2.issues.map((i) => i.msg).join(' / ')}` : '결과 없음');
  fs.rmSync(outDir, { recursive: true, force: true });
} finally {
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  if (mock) mock.kill();
}

console.log(`\n${ok} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
