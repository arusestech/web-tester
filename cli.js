#!/usr/bin/env node
// 사용법:
//   node cli.js                              -> GUI (앱 창)
//   node cli.js gui [--port 8765] [--no-open]
//   node cli.js <scenario.json|폴더> [옵션]  -> 바로 실행 (CLI). 폴더면 그 아래 시나리오 전부 일괄 실행
//   node cli.js run <scenario.json|폴더> [옵션]  -> 바로 실행 (동일)
//   node cli.js record <scenario.json> [--url /경로] [--name 흐름이름] [--append] [--no-login]  -> 녹화
//   node cli.js discover <scenario.json> [--url /경로] [--depth 2] [--append]  -> 메뉴 자동 수집
//   node cli.js cli                          -> 터미널 대화형 (시나리오 선택/작성)
//   node cli.js new [scenario.json]          -> 터미널 대화형 작성만
//   node cli.js init [scenario.json]         -> 예제 시나리오 복사
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';

// Node 버전 확인 — 동봉 Playwright(1.62) 가 Node 20 미만을 거부한다. 폐쇄망에서 원인 모를 오류 대신 명확히 알린다.
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`[ERROR] Node ${process.versions.node} 은(는) 지원하지 않습니다. Node 20 이상이 필요합니다 (동봉 런타임 = 24.x). runtime\\win\\node.exe cli.js 로 실행하거나 Node 20+ 를 설치하세요.`);
  process.exit(3);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const args = process.argv.slice(2);
// --no-config: 전역 설정(config.json)을 무시하고 순수 시나리오 값으로 실행 (자체 검증의 결정성 보장)
if (args.includes('--no-config')) process.env.WWT_NO_CONFIG = '1';

function opt(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const REPORT_DIR = path.join(__dirname, 'reports');
const options = () => ({
  headless: !!opt('headless', false),
  only: opt('only', null),
  skipMenus: !!opt('skip-menus', false) || opt('mode', 'all') === 'crud',
  skipCrawl: !!opt('skip-crawl', false) || opt('mode', 'all') === 'crud',
  skipCrud: !!opt('skip-crud', false) || opt('mode', 'all') === 'menus',
  screenshot: ['all', 'fail', 'none'].includes(opt('screenshot', '')) ? opt('screenshot') : undefined,
  outDir: path.resolve(opt('out', REPORT_DIR)),
  // 직전 실행 비교: --no-compare 면 끔. 아니면 전체 설정(config.compare) 을 따르고, 기본은 켬. --compare <증적폴더> 면 그 폴더 기준
  compare: opt('no-compare', false) ? false : loadConfig().compare !== false,
  compareWith: typeof opt('compare', null) === 'string' ? path.resolve(opt('compare')) : undefined,
});

// 증적은 시나리오와 같은 폴더 구조로: scenarios/A/B/x.json → reports/A/B/x-<시각>/ (--out 을 직접 주면 그대로)
function outDirFor(file, o) {
  if (opt('out', null)) return o.outDir;
  const abs = path.resolve(file);
  if (!abs.startsWith(SCENARIO_DIR + path.sep)) return o.outDir;
  const sub = path.dirname(path.relative(SCENARIO_DIR, abs));
  return sub === '.' ? o.outDir : path.join(REPORT_DIR, sub);
}
const relScenario = (file) => {
  const abs = path.resolve(file);
  return abs.startsWith(SCENARIO_DIR + path.sep) ? path.relative(SCENARIO_DIR, abs).split(path.sep).join('/') : undefined;
};

// --rerun-failed [증적폴더] → 기준 report.json 을 찾아 실패/주의 항목 이름만 뽑는다.
// match: { file, name } (시나리오 하나) 또는 { name: 폴더라벨, batch: true } (일괄)
async function rerunTargets(match, outDir) {
  const flag = opt('rerun-failed', false);
  if (!flag) return null;
  const { findPrevReport, readReportJson, failedTargets } = await import('./src/compare.js');
  let json = null, from = '';
  if (typeof flag === 'string') { json = readReportJson(path.resolve(flag)); from = flag; }
  else {
    // findPrevReport 는 "증적 폴더의 부모"에서 찾으므로 가상의 하위 경로를 넘긴다
    const prev = findPrevReport(path.join(outDir, '_'), match);
    if (prev) { json = prev.json; from = prev.rel; }
  }
  if (!json) { console.error('실패건만 재실행: 기준이 될 이전 증적을 찾지 못했습니다. --rerun-failed <증적폴더> 로 지정하세요'); return 'none'; }
  const t = failedTargets(json);
  console.log(`실패건만 재실행 — 기준 증적: ${from} (실패·주의 ${t.count}건)`);
  return { ...t, from };
}

function usage() {
  console.log(`사용법:
  WigoWebTester.bat / wigo-web-tester.sh          GUI 실행 (기본)
  run.bat <scenario.json> [옵션]           터미널에서 바로 실행
  run.bat <폴더> [옵션]                    폴더(프로젝트) 아래 시나리오 전부 일괄 실행 → 합산 증적
  run.bat record <scenario.json> [--url /경로] [--name 이름] [--append] [--no-login] [--allow-forbidden]
                                           브라우저를 띄워 조작을 녹화 → 스텝 JSON 출력 (--append 면 시나리오 crud 에 추가)
  run.bat discover <scenario.json> [--url /경로] [--depth 2] [--pages 20] [--max 200] [--selector "#lnb a"]
                                   [--pattern "/screen/{}.ub"] [--append]
                                           로그인 후 화면의 링크를 긁어 menus[] 초안 생성 (--append 면 시나리오에 새 메뉴만 추가)
                                           href 없이 속성에 화면ID 만 있는 메뉴는 --pattern 규칙으로 URL 을 만든다 (기존 menus 에서 자동 추론도 함)
  run.bat scan-source <소스폴더> [--out scenarios\<프로젝트>\<이름>.json] [--append <시나리오>]
                                   [--name 이름] [--url http://호스트:포트] [--user 계정] [--pattern "/screen/{}.ub"] [--limit 800] [--no-expect] [--actions]
                                           소스를 읽어 baseUrl·로그인·메뉴·금지버튼·expect 초안 생성 (서버 없이. 근거는 reports\_소스분석\ 보고서)
                                           --actions 를 주면 조회·검색처럼 데이터를 안 바꾸는 버튼을 눌러 동작까지 검사하는 actions 도 만든다
  run.bat lint <scenario.json|폴더>        시나리오 사전 검사 (이름 중복·필수값 누락 등). 종료코드 2 = 오류 있음
  run.bat stub <scenario.json>             서버 stub 을 단독으로 계속 띄움 (백엔드 외부 연동 목업 — 앱을 붙여 수동 테스트). Ctrl+C 종료
  run.bat cli                              터미널 대화형
  run.bat new [scenario.json]              터미널로 시나리오 JSON 작성
  run.bat init [scenario.json]             예제 시나리오 복사

옵션:
  --mode all|menus|crud   실행 범위 (기본 all)
  --headless              브라우저 창 숨김
  --only <이름>           해당 이름을 포함한 메뉴/CRUD만 실행
  --screenshot all|fail|none  증적 캡처 범위 (기본: 시나리오 evidence 설정 → all). 항목별 "screenshot": true/false 가 우선
  --out <폴더>            증적 폴더 위치 (기본: 시나리오와 같은 구조로 reports/<프로젝트>/<폴더>/)
  --secret 이름=값        시나리오의 {{이름}} 자리표시자 값 (환경변수 WWT_이름 도 가능, 없으면 터미널에서 입력)
  --rerun-failed [증적폴더]  직전 실행에서 실패·주의였던 항목만 다시 실행 (폴더 생략 시 가장 최근 증적 기준)
  --no-compare            직전 실행과의 비교(신규 실패/해결) 생략
  --compare <증적폴더>    비교 기준을 직접 지정
  --port <번호>           GUI 포트 (기본 자동)

종료 코드: 0 정상 / 2 실패 항목 있음 / 3 치명적 오류`);
}

// 터미널에서 화면에 표시하지 않고 입력받기
function askHidden(q) {
  return new Promise((res) => {
    process.stdout.write(q);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (ch) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); res(buf); }
      else if (ch === '\u0003') process.exit(130);                       // Ctrl+C
      else if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);   // Backspace
      else buf += ch;
    };
    stdin.on('data', on);
  });
}

// --secret 이름=값 → 환경변수 WWT_이름 → 터미널 입력(숨김)
async function collectSecrets(need) {
  const { secretsFromEnv } = await import('./src/secrets.js');
  const secrets = secretsFromEnv(need);
  for (let i = 0; i < args.length; i++) if (args[i] === '--secret' && args[i + 1]?.includes('=')) { const [k, ...v] = args[i + 1].split('='); secrets[k] = v.join('='); }
  for (const k of need.filter((k) => secrets[k] === undefined)) {
    if (!process.stdin.isTTY) throw new Error(`실행 시 입력값 누락: {{${k}}} — --secret ${k}=값 또는 환경변수 WWT_${k}`);
    secrets[k] = await askHidden(`${k} 입력: `);
  }
  return secrets;
}

// 폴더 일괄 실행: 아래 모든 .json 을 순서대로, 합산 증적 하나
async function runDir(dir) {
  const { collectScenarios, batchPlaceholders, runBatch } = await import('./src/batch.js');
  const files = collectScenarios(dir);
  if (!files.length) { console.error(`시나리오 없음: ${dir}`); return 1; }
  console.log(`일괄 실행: ${files.length}개\n  ` + files.map((f) => path.relative(dir, f)).join('\n  '));
  let secrets; try { secrets = await collectSecrets(batchPlaceholders(files, SCENARIO_DIR)); } catch (e) { console.error(e.message); return 1; }
  const o = options();
  const label = path.basename(path.resolve(dir));
  const outDir = opt('out', null) ? o.outDir : path.join(REPORT_DIR, path.resolve(dir).startsWith(SCENARIO_DIR + path.sep) ? path.relative(SCENARIO_DIR, path.resolve(dir)) : '');
  const t = await rerunTargets({ name: label, batch: true }, outDir);
  if (t === 'none') return 1;
  if (t && !Object.keys(t.files).length) { console.log('직전 일괄 실행에 실패·주의 항목이 없습니다 — 재실행할 것이 없습니다.'); return 0; }
  const rep = await runBatch(files, label, { ...o, outDir, secrets, scenarioRoot: SCENARIO_DIR, batchDir: path.relative(REPORT_DIR, outDir).split(path.sep).join('/'), onlyMap: t ? t.files : undefined });
  console.log(`\nHTML: ${rep.htmlPath}`);
  return rep.fail > 0 ? 2 : 0;
}

// 녹화: 브라우저에서 조작 → 스텝 JSON. --append 면 시나리오 파일의 crud 에 흐름으로 추가
async function record(file) {
  if (!fs.existsSync(file)) { console.error(`파일 없음: ${file}`); return 1; }
  const { readJsonFile, resolveForRun } = await import('./src/scenario.js');
  const raw = readJsonFile(file);                       // 기록한 흐름은 원본 파일에 추가 (상속 결과를 덮어쓰지 않게)
  const scenario = resolveForRun(raw, { dir: path.dirname(path.resolve(file)), root: SCENARIO_DIR });
  const { startRecorder, tidySteps } = await import('./src/recorder.js');
  const { findPlaceholders } = await import('./src/secrets.js');
  const login = !opt('no-login', false);
  let secrets; try { secrets = await collectSecrets(login && scenario.login ? findPlaceholders(scenario.login) : []); } catch (e) { console.error(e.message); return 1; }
  const rec = await startRecorder(scenario, { url: opt('url', '/'), login, secrets, allowForbidden: args.includes('--allow-forbidden'), log: (m) => console.log(m) });
  const steps = tidySteps(await rec.done);
  const name = opt('name', `녹화 ${new Date().toLocaleString()}`);
  const flow = { name, steps };
  if (opt('append', false)) {
    raw.crud = [...(raw.crud || []), flow];
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`\n시나리오 crud 에 추가됨: "${name}" (${steps.length} 스텝) → ${file}`);
  } else console.log('\n' + JSON.stringify(flow, null, 2));
  return 0;
}

// 시나리오 사전 검사
async function lint(target) {
  const { lintScenario, lintSummary } = await import('./src/lint.js');
  const { loadScenario } = await import('./src/scenario.js');
  const { collectScenarios } = await import('./src/batch.js');
  const files = fs.statSync(target).isDirectory() ? collectScenarios(target) : [target];
  let errors = 0;
  for (const f of files) {
    let sc; try { sc = loadScenario(f, SCENARIO_DIR); } catch (e) { console.log(`\n■ ${path.relative(process.cwd(), f)}\n  ❌ 읽기 실패: ${e.message}`); errors++; continue; }
    const issues = lintScenario(sc);
    errors += issues.filter((i) => i.level === 'error').length;
    console.log(`\n■ ${path.relative(process.cwd(), f)} — ${lintSummary(issues)}`);
    for (const i of issues) console.log(`  ${i.level === 'error' ? '❌' : '⚠️'} ${i.msg}${i.where ? `  (${i.where})` : ''}`);
  }
  return errors ? 2 : 0;
}

// 🔍 메뉴 자동 수집: 로그인 후 링크를 긁어 menus[] 초안. --append 면 시나리오에 새 메뉴만 추가
async function discover(file) {
  if (!fs.existsSync(file)) { console.error(`파일 없음: ${file}`); return 1; }
  const { readJsonFile, resolveForRun } = await import('./src/scenario.js');
  const raw = readJsonFile(file);                       // 파일에 쓸 때는 원본(상속 결과를 복사하지 않도록)
  const scenario = resolveForRun(raw, { dir: path.dirname(path.resolve(file)), root: SCENARIO_DIR });
  if (!scenario.baseUrl) { console.error('시나리오에 baseUrl 이 없습니다.'); return 1; }
  const { discoverMenus } = await import('./src/discover.js');
  const { findPlaceholders } = await import('./src/secrets.js');
  let secrets; try { secrets = await collectSecrets(findPlaceholders(scenario.login || {})); } catch (e) { console.error(e.message); return 1; }
  const r = await discoverMenus(scenario, {
    start: opt('url', null) || undefined, depth: opt('depth', 1), pages: opt('pages', 20), max: opt('max', 200),
    selector: typeof opt('selector', null) === 'string' ? opt('selector') : undefined,
    pattern: typeof opt('pattern', null) === 'string' ? opt('pattern') : undefined, // 화면ID → URL 규칙 (예: /screen/{}.ub)
    secrets, log: (m) => console.log(m),
  });
  // 위험 단어(forbidden)가 이름에 든 메뉴는 기본 제외 — --include-danger 로 포함
  const withDanger = !!opt('include-danger', false);
  const fresh = r.menus.filter((m) => !m.dup && (withDanger || !m.danger));
  const dangerSkipped = r.menus.filter((m) => !m.dup && m.danger && !withDanger);
  console.log('\n번호 | 메뉴명 | URL');
  r.menus.forEach((m, i) => console.log(`${String(i + 1).padStart(3)} | ${m.danger ? '⚠ ' : ''}${m.name}${m.dup ? ' (이미 있음)' : ''} | ${m.url}${m.danger ? `   ← 금지 단어 "${m.danger}"` : ''}`));
  if (dangerSkipped.length) console.log(`\n⚠ 이름에 금지 단어가 든 메뉴 ${dangerSkipped.length}개는 추가에서 뺐습니다 (조회만 할 거라면 --include-danger 또는 직접 추가)`);
  if (r.skipped.length) {
    console.log(`\n제외 ${r.skipped.length}건`);
    for (const s of r.skipped.slice(0, 30)) console.log(`  - ${s.text || '(이름 없음)'} | ${s.url} — ${s.why}`);
    if (r.skipped.length > 30) console.log(`  ... 외 ${r.skipped.length - 30}건`);
    console.log('  ※ 금지 버튼(forbidden) 텍스트가 든 메뉴는 일부러 뺍니다. 조회만 하려면 시나리오에 직접 추가하세요');
  }
  if (opt('append', false)) {
    if (!fresh.length) { console.log('\n추가할 새 메뉴가 없습니다.'); return 0; }
    raw.menus = [...(raw.menus || []), ...fresh.map((m) => ({ name: m.name, url: m.url }))];
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`\n시나리오에 ${fresh.length}개 추가됨 → ${file}\n   ※ 초안입니다. 위험한 화면(삭제·발송)·팝업 전용 화면을 지우고 expect 를 채운 뒤 실행하세요`);
  } else {
    console.log('\n' + JSON.stringify(fresh.map((m) => ({ name: m.name, url: m.url })), null, 2));
    console.log('\n※ 시나리오에 바로 넣으려면 --append');
  }
  return 0;
}

// 📂 소스에서 시나리오 초안 만들기 (정적 분석 — 서버·브라우저 없이 소스만 읽는다)
async function scanSourceCmd(root) {
  const { scanSource, toScenario, writeSourceReport } = await import('./src/source-scan.js');
  const { readJsonFile } = await import('./src/scenario.js');
  let r;
  try {
    r = scanSource(root, {
      log: (m) => console.log(m),
      name: typeof opt('name', null) === 'string' ? opt('name') : undefined,
      baseUrl: typeof opt('url', null) === 'string' ? opt('url') : undefined,
      user: typeof opt('user', null) === 'string' ? opt('user') : undefined,
      pattern: typeof opt('pattern', null) === 'string' ? opt('pattern') : undefined,
      limit: Number(opt('limit', 0)) || undefined,
      expect: !opt('no-expect', false),
      actions: !!opt('actions', false),   // 안전한 버튼(조회·검색·초기화)은 눌러서 동작까지 검사하도록 actions 생성
    });
  } catch (e) { console.error(e.message); return 1; }

  console.log(`\n접속 URL: ${r.baseUrl.value}${r.baseUrl.guessed ? ' (추정)' : ''}`);
  console.log(`로그인: ${r.login.found ? `${r.login.url}  ${r.login.fields.id || '?'} / ${r.login.fields.pw || '?'} / ${r.login.fields.button || '?'}  (${r.login.file}:${r.login.line})` : r.login.why}`);
  console.log(`금지 버튼 후보: ${r.forbidden.map((d) => `${d.word}(${d.count})`).join(', ') || '없음'}`);
  console.log('\n번호 | 확신도 | 출처 | 메뉴명 | URL');
  r.menus.slice(0, 60).forEach((m, i) => console.log(`${String(i + 1).padStart(3)} | ${m.confidence.padEnd(4)} | ${m.source.padEnd(10)} | ${m.name} | ${m.url}`));
  if (r.menus.length > 60) console.log(`  … 외 ${r.menus.length - 60}개 (전체는 보고서에서)`);
  if (r.warnings.length) console.log('\n확인할 것\n  - ' + r.warnings.join('\n  - '));

  // 소스분석 보고서 (근거 파일:줄 포함)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
  const repDir = path.join(REPORT_DIR, '_소스분석', `${r.name.replace(/[^\w가-힣-]+/g, '_')}-${stamp}`);
  const rep = writeSourceReport(r, repDir);
  console.log(`\n소스분석 보고서: ${rep.html}`);

  const outOpt = opt('out', null), appendOpt = opt('append', null);
  if (typeof appendOpt === 'string') {
    const file = path.resolve(appendOpt);
    if (!fs.existsSync(file)) { console.error(`파일 없음: ${file}`); return 1; }
    const raw = readJsonFile(file);                       // 원본에 추가 (상속 결과를 복사하지 않게)
    const have = new Set((raw.menus || []).map((m) => String(m.url || '').toLowerCase()));
    const fresh = toScenario(r, { actions: !!opt('actions', false) }).menus.filter((m) => !have.has(m.url.toLowerCase()));
    if (!fresh.length) { console.log('\n추가할 새 메뉴가 없습니다.'); return 0; }
    raw.menus = [...(raw.menus || []), ...fresh];
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`\n시나리오에 ${fresh.length}개 추가됨 → ${file}`);
  } else if (typeof outOpt === 'string') {
    const file = path.resolve(outOpt);
    if (fs.existsSync(file)) { console.error(`이미 있습니다: ${file} (--append 로 메뉴만 추가하거나 다른 이름을 쓰세요)`); return 1; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(toScenario(r, { actions: !!opt('actions', false) }), null, 2), 'utf8');
    console.log(`시나리오 초안: ${file}`);
    const { lintScenario, lintSummary } = await import('./src/lint.js');
    const { loadScenario } = await import('./src/scenario.js');
    try {
      const issues = lintScenario(loadScenario(file, SCENARIO_DIR));
      console.log(`검사: ${lintSummary(issues)}`);
      for (const i of issues.slice(0, 10)) console.log(`  ${i.level === 'error' ? '❌' : '⚠️'} ${i.msg}${i.where ? `  (${i.where})` : ''}`);
    } catch { /* 검사 실패가 결과를 막지 않게 */ }
    console.log(`\n다음: run.bat "${path.relative(process.cwd(), file)}" --mode menus --headless --only <메뉴 하나>  로 로그인부터 확인하세요`);
  } else {
    console.log('\n※ 시나리오로 저장하려면 --out scenarios\\<프로젝트>\\<이름>.json (기존 시나리오에 메뉴만 추가는 --append <시나리오>)');
  }
  return 0;
}

// stub 서버 단독 실행 (앱을 이 stub 에 붙여 수동 테스트할 때). 시나리오/프로젝트의 stubServer 설정을 읽어 계속 띄운다.
async function stubCmd(file) {
  if (!fs.existsSync(file)) { console.error(`파일 없음: ${file}`); return 1; }
  const { loadScenario } = await import('./src/scenario.js');
  const { startStub } = await import('./src/stub-server.js');
  let sc; try { sc = loadScenario(file, SCENARIO_DIR); } catch (e) { console.error(`읽기 실패: ${e.message}`); return 1; }
  const cfg = sc.stubServer;
  if (!cfg || !Array.isArray(cfg.routes) || !cfg.routes.length) { console.error('stubServer.routes 가 없습니다 — 프로젝트 설정(🔧) 또는 시나리오에 정의하세요.'); return 1; }
  if (cfg.enabled === false) console.log('※ 이 프로젝트는 stub 이 꺼져 있지만(enabled:false), 단독 실행이므로 그대로 띄웁니다.');
  await startStub({ ...cfg, vars: sc.vars }, { log: (m) => console.log(m), vars: sc.vars });
  console.log('Ctrl+C 로 종료. 대상 앱의 외부 연동 주소를 이 서버로 돌려두세요(설정 변경 또는 hosts).');
  await new Promise(() => {}); // 종료 전까지 유지
  return null;
}

async function run(file) {
  if (!fs.existsSync(file)) { console.error(`파일 없음: ${file}`); return 1; }
  if (fs.statSync(file).isDirectory()) return runDir(file);
  let scenario;
  const { loadScenario } = await import('./src/scenario.js');
  try { scenario = loadScenario(file, SCENARIO_DIR); } // BOM 허용(메모장 저장) + extends 상속 해석
  catch (e) { console.error(`시나리오 읽기 실패: ${file}\n${e.message}`); return 1; }
  if (!scenario.baseUrl) { console.error('시나리오에 baseUrl 이 없습니다.'); return 1; }
  if (scenario._extends?.length) console.log(`상속: ${scenario._extends.join(', ')}`);
  scenario._file = relScenario(file);
  // 실행 전 사전 검사 — 막지는 않고 알려만 준다 (실행 20분 뒤에 알게 되는 것보다 낫다)
  try {
    const { lintScenario } = await import('./src/lint.js');
    const issues = lintScenario(scenario).filter((i) => i.level === 'error');
    if (issues.length) console.log(`⚠ 시나리오 검사에서 오류 ${issues.length}건:\n  ` + issues.map((i) => `${i.msg}${i.where ? ` (${i.where})` : ''}`).join('\n  ') + '\n  (자세히 보려면 run.bat lint ' + path.basename(file) + ')');
  } catch { /* 검사 실패가 실행을 막지 않게 */ }
  const { runScenario } = await import('./src/runner.js');
  const { findPlaceholders } = await import('./src/secrets.js');
  let secrets; try { secrets = await collectSecrets(findPlaceholders(scenario)); } catch (e) { console.error(e.message); return 1; }
  const o = options();
  const outDir = outDirFor(file, o);
  const t = await rerunTargets({ file: scenario._file, name: scenario.name }, outDir);
  if (t === 'none') return 1;
  if (t && !t.names.length) { console.log('직전 실행에 실패·주의 항목이 없습니다 — 재실행할 것이 없습니다.'); return 0; }
  const summary = await runScenario(scenario, { ...o, outDir, secrets, onlyList: t ? t.names : undefined });
  console.log(`\n${summary.text}\n\nHTML: ${summary.htmlPath}`);
  return summary.fail > 0 ? 2 : 0;
}

async function main() {
  const cmd = args[0];
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { usage(); return 0; }

  if (!cmd || cmd === 'gui' || cmd.startsWith('--')) {
    const { startServer } = await import('./src/server.js');
    await startServer({ port: Number(opt('port', 0)) || 0, open: !args.includes('--no-open') });
    return null; // 서버 유지
  }

  if (cmd === 'init') {
    const target = args[1] || 'scenario.json';
    if (fs.existsSync(target)) { console.error(`이미 존재: ${target}`); return 1; }
    fs.copyFileSync(path.join(SCENARIO_DIR, 'example.json'), target);
    console.log(`생성됨: ${target}`);
    return 0;
  }

  const { createPrompt, runWizard, pickScenario } = await import('./src/wizard.js');

  if (cmd === 'new') {
    const p = createPrompt();
    try {
      const file = await runWizard(p, SCENARIO_DIR);
      if (await p.yes('지금 바로 실행할까요?', true)) { p.close(); return run(file); }
    } finally { p.close(); }
    return 0;
  }

  if (cmd === 'cli') {
    const p = createPrompt();
    try {
      let file = await pickScenario(p, SCENARIO_DIR);
      if (file === null) return 0;
      if (file === 'new') file = await runWizard(p, SCENARIO_DIR);
      const mode = await p.ask('실행 범위  1) 조회+CRUD  2) 조회만  3) CRUD만', '1');
      args.push('--mode', mode === '2' ? 'menus' : mode === '3' ? 'crud' : 'all');
      if (!(await p.yes('브라우저 창을 보면서 실행할까요?', true))) args.push('--headless');
      const shotSel = await p.ask('증적 캡처  1) 시나리오 설정대로  2) 모든 화면  3) 실패만  4) 안 찍음', '1');
      if (shotSel !== '1') args.push('--screenshot', { 2: 'all', 3: 'fail', 4: 'none' }[shotSel] || 'all');
      p.close();
      return run(file);
    } finally { p.close(); }
  }

  if (cmd === 'scan-source' || cmd === 'source') { if (!args[1]) { usage(); return 1; } return scanSourceCmd(path.resolve(args[1])); }
  if (cmd === 'stub') { if (!args[1]) { usage(); return 1; } return stubCmd(path.resolve(args[1])); }
  if (cmd === 'record') { if (!args[1]) { usage(); return 1; } return record(path.resolve(args[1])); }
  if (cmd === 'discover') { if (!args[1]) { usage(); return 1; } return discover(path.resolve(args[1])); }
  if (cmd === 'lint') { if (!args[1]) { usage(); return 1; } return lint(path.resolve(args[1])); }
  if (cmd === 'run') { if (!args[1]) { usage(); return 1; } return run(path.resolve(args[1])); }
  return run(path.resolve(cmd));
}

main()
  .then((code) => { if (code !== null) process.exit(code); })
  .catch((e) => { console.error('치명적 오류:', e); process.exit(3); });
