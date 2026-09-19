// 📂 소스 스캔 자체 검증 — test/source-fixture (작은 가짜 Java/JSP 프로젝트) 를 분석해 결과를 확인한다.
// 실행: node test/source-scan-check.mjs   (브라우저·서버 불필요)
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanSource, toScenario, renderSourceReport } from '../src/source-scan.js';
import { lintScenario } from '../src/lint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'source-fixture');

let ok = 0, fail = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra ? `  — ${extra}` : ''}`); }
};

const r = scanSource(ROOT, { log: () => {} });
const menu = (url) => r.menus.find((m) => m.url === url);
const skipWhy = (url) => r.skipped.find((s) => String(s.url).includes(url))?.why || '';

console.log('\n■ 접속 URL / 로그인');
check(r.baseUrl.value === 'http://localhost:9090/demo', '포트·컨텍스트를 application-local.yml 에서 읽음', r.baseUrl.value);
check(r.login.found && r.login.url === '/login', '로그인 URL (컨텍스트 제외)', r.login.url);
check(r.login.fields.id === '#userId', '아이디 칸 셀렉터', r.login.fields.id);
check(r.login.fields.pw === '#userPw', '비밀번호 칸 셀렉터', r.login.fields.pw);
check(r.login.fields.button === '#btnLogin', '로그인 버튼 (아이디저장 체크박스가 아니라)', r.login.fields.button);
check(r.login.detect === '#userPw', 'detect = 비밀번호 칸 (로그인 실패 판정)', r.login.detect);

console.log('\n■ 메뉴');
check(menu('/emp')?.name === '인사 > 사원관리', '메뉴 테이블 INSERT 의 이름·상위메뉴 (컨텍스트 /demo 는 제거)', menu('/emp')?.name);
check(menu('/dept/list')?.source === 'menu-sql', '메뉴 테이블이 컨트롤러보다 우선', menu('/dept/list')?.source);
check(!!menu('/pay/list.do'), '소스에 컨트롤러가 없는 메뉴도 메뉴 테이블에서 나옴');
check(!!menu('/board/notice.do'), '메뉴 JSP 의 onclick 경로도 잡음');
check(menu('/emp/form')?.name === '사원 등록 화면', '메서드 바로 위 한 줄 주석이 메뉴 이름', menu('/emp/form')?.name);
check(!r.menus.some((m) => m.name.includes('<pre>') || m.name.includes('com.demo')), '클래스 javadoc 을 이름으로 쓰지 않음');
check(/조회만/.test(menu('/dept/deleteReady')?.name || ''), '위험 화면 이름에 (조회만) 표시', menu('/dept/deleteReady')?.name);
check(!r.menus.some((m) => m.url.includes('oldScreen')), '_backup 파일의 주석 처리된 매핑은 안 잡음');
check(!r.menus.some((m) => m.url === '/comment/only'), '주석 안의 매핑은 안 잡음');

console.log('\n■ 메뉴에서 뺀 것 (이유가 남아야 한다)');
check(/POST/.test(skipWhy('/emp/save')), 'POST 전용은 제외', skipWhy('/emp/save'));
check(!menu('/emp/selectList'), '@ResponseBody API 는 제외');
check(/모달|팝업/.test(skipWhy('/emp/empPickModal')), '모달은 제외', skipWhy('/emp/empPickModal'));
check(/경로 변수/.test(skipWhy('/emp/{empNo}')), '경로 변수는 제외', skipWhy('/emp/{empNo}'));
check(!menu('/emp/excel'), '엑셀 다운로드는 제외');
check(!r.menus.some((m) => /logout/i.test(m.url)), '로그아웃은 제외');
check(/화면ID/.test(skipWhy('deptStat')), '규칙을 모르는 화면ID 는 이유와 함께 제외', skipWhy('deptStat'));

console.log('\n■ 화면 분석 (expect / 조회조건 / 상세)');
check(menu('/emp')?.expect?.[0]?.sel === '#list', 'jqGrid 컨테이너를 expect 후보로', menu('/emp')?.expect?.[0]?.sel);
check(menu('/emp')?.detailCandidate?.dblclick === true, 'ondblClickRow → 상세 후보(더블클릭)');
check(String(menu('/emp')?.detailCandidate?.selector).includes('tr.jqgrow'), '상세 행 셀렉터', menu('/emp')?.detailCandidate?.selector);
check(r.inputsCommon.some((i) => i.key === 'fromDate') && r.inputsCommon.some((i) => i.key === 'toDate'), '두 화면에 반복되는 조회 조건을 공통 후보로');
check(r.searchSel === '#btnSearch', '조회 버튼 후보', r.searchSel);

console.log('\n■ 화면별 버튼 목록 (클릭 스텝은 만들지 않고 목록만)');
const btns = menu('/emp')?.buttons || [];
const btn = (label) => btns.find((b) => b.label === label);
check(!!btn('조회'), '마크업 버튼을 목록에 담음', btns.map((b) => b.label).join(', '));
check(!!btn('삭제')?.danger, '위험 버튼은 danger 로 표시', JSON.stringify(btn('삭제')));
check(!!btn('btnExcelDown'), "스크립트에서 id 로만 다루는 버튼($('#btnExcelDown'))도 잡음");
check(btns.every((b) => b.sel), '버튼마다 셀렉터가 있음');
check(!JSON.stringify(btns).includes('+='), 'JS 문자열 조각은 버튼으로 안 잡음');

console.log('\n■ 버튼 동작 검사(actions) 자동 생성 — 데이터를 바꾸지 않는 버튼만');
const scA = toScenario(r, { actions: true });
const empA = scA.menus.find((m) => m.url === '/emp');
check(empA?.actions?.some((a) => a.click === '#btnSearch'), '조회 버튼은 actions 로 만든다', JSON.stringify(empA?.actions));
check(!empA?.actions?.some((a) => /Delete|Send|Save|Excel/i.test(a.click)), '삭제·발송·저장·엑셀 버튼은 actions 에 넣지 않는다');
check(!toScenario(r, {}).menus.some((m) => m.actions), '옵션 없이는 actions 를 만들지 않는다 (후보 메모만)');
check(/누르면 데이터가 안 바뀌는/.test(toScenario(r, {}).menus.find((m) => m.url === '/emp')?._액션후보 || ''), '옵션 없으면 _액션후보 로만 남는다');
check(lintScenario(scA).filter((i) => i.level === 'error').length === 0, 'actions 가 들어간 초안도 lint 통과');

console.log('\n■ 금지 버튼');
for (const w of ['삭제', '발송', '저장']) check(r.forbidden.some((d) => d.word === w), `버튼 텍스트 "${w}" 를 금지 버튼 후보로`);

console.log('\n■ 화면ID 규칙을 주면');
const r2 = scanSource(ROOT, { log: () => {}, pattern: '/screen/{}.do' });
check(!!r2.menus.find((m) => m.url === '/screen/deptStat.do'), '속성의 화면ID 를 규칙으로 URL 로 변환', r2.menus.find((m) => m.url.includes('deptStat'))?.url);

console.log('\n■ 시나리오 초안');
const sc = toScenario(r, { name: '소스스캔검증' });
const issues = lintScenario(sc);
const errors = issues.filter((i) => i.level === 'error');
check(errors.length === 0, '초안이 lint 오류 없이 통과', errors.map((i) => i.msg).join(' / '));
check(!JSON.stringify(sc).includes('"password"') && JSON.stringify(sc).includes('{{password}}'), '비밀번호는 자리표시자로');
check(sc.menus.every((m) => m.name && m.url), '모든 메뉴에 이름·URL');
check(new Set(sc.menus.map((m) => m.name)).size === sc.menus.length, '메뉴 이름 중복 없음 (비교·재실행이 엉키지 않게)');
check(!!sc._comment_menus && sc.menus.every((m) => m._출처), '초안에 출처(근거)가 남음');

console.log('\n■ 소스분석 보고서');
const html = renderSourceReport(r);
check(html.includes('<h1>') && html.includes('소스 분석'), 'HTML 보고서 생성');
check(html.includes('EmpController.java'), '보고서에 근거 파일이 들어감');
const tmp = path.join(os.tmpdir(), `wwt-source-report-${Date.now()}.html`);
fs.writeFileSync(tmp, html, 'utf8'); fs.unlinkSync(tmp);

console.log(`\n${ok} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
