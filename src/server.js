// GUI 서버: 로컬 HTTP + SSE. 브라우저 앱 창(--app)으로 열어 데스크톱 프로그램처럼 사용.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScenario } from './runner.js';
import { runBatch, collectScenarios, batchPlaceholders } from './batch.js';
import { findPlaceholders } from './secrets.js';
import { readJsonFile, resolveScenario, resolveForRun, readProjectConfig, projectConfigPath, PROJECT_KEYS } from './scenario.js';
import { findPrevReport, readReportJson, failedTargets } from './compare.js';
import { loadConfig, saveConfig } from './config.js';

// 로컬 API 토큰: 127.0.0.1 전용이라도 다른 로컬 페이지·CSRF·DNS 리바인딩이 /api/* 로 파일 쓰기·프로세스 실행을
// 시키지 못하게 막는다. 서버 시작 때 한 번 만들고, 앱 창 URL(?t=)로만 GUI 에 전달한다.
// WWT_TOKEN 이 있으면 그 값을 쓴다(자동 검증에서 고정 토큰으로 접속하기 위함) — 실제 사용 땐 설정하지 않는다.
const TOKEN = process.env.WWT_TOKEN || crypto.randomBytes(24).toString('hex');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCENARIO_DIR = path.join(ROOT, 'scenarios');
const REPORT_DIR = path.join(ROOT, 'reports');
const UI = path.join(ROOT, 'ui', 'index.html');

// 로그는 콘솔 대신 파일로 (최소화된 콘솔 창을 깔끔하게 유지). logs/gui-YYYYMMDD.log 에 append
const LOG_DIR = path.join(ROOT, 'logs');
function fileLog(m) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, `gui-${new Date().toISOString().slice(0, 10)}.log`), `[${new Date().toISOString()}] ${m}\n`); } catch { /* 로그 실패는 무시 */ }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.csv': 'text/csv; charset=utf-8' };

// ---------- 실행 상태 ----------
const state = { running: false, cancel: false, log: [], results: [], report: null, scenario: null, progress: null };
// 녹화 상태
const rec = { recording: false, handle: null, steps: [], log: [], name: '' };
const clients = new Set();
const emit = (type, data) => {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(line);
};

// 시나리오 경로: scenarios/ 기준 상대경로 ("프로젝트/폴더/파일.json"). 상위 이동(..)·이상한 문자 제거
const safeRel = (f) => String(f || '').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..').map((s) => s.replace(/[^\w가-힣.\- ()]+/g, '_')).join('/');
const scPath = (rel) => { const p = path.join(SCENARIO_DIR, safeRel(rel)); if (!p.startsWith(SCENARIO_DIR)) throw new Error('잘못된 경로'); return p; };
const readSc = (full) => readJsonFile(full);
// 편집 화면은 원본 그대로, 실행/녹화/필드수집은 extends 상속 + 프로젝트 공통 설정을 병합한 결과를 쓴다
const loadSc = (full) => resolveForRun(readJsonFile(full), { dir: path.dirname(full), root: SCENARIO_DIR });

// rerunFailed: true(가장 최근 증적 기준) 또는 증적 폴더 상대경로 → 그 실행에서 실패·주의였던 항목만
function rerunFrom(rerunFailed, outDir, match) {
  const json = typeof rerunFailed === 'string' ? readReportJson(repPath(rerunFailed)) : findPrevReport(path.join(outDir, '_'), match)?.json;
  if (!json) throw new Error('실패건만 재실행: 기준이 될 이전 증적이 없습니다 (먼저 한 번 실행하세요)');
  return failedTargets(json);
}

async function startRun({ file, dir, files, mode = 'all', headless = false, only = '', secrets = {}, screenshot = '', compare = true, rerunFailed = null }) {
  if (state.running) throw new Error('이미 실행 중입니다');
  if (rec.recording) throw new Error('녹화 중에는 실행할 수 없습니다. 녹화를 먼저 종료하세요');
  // 증적은 시나리오와 같은 폴더 구조로: reports/<프로젝트>/<폴더>/<시나리오>-<시각>/
  const relDir = dir !== undefined ? safeRel(dir) : safeRel(file).split('/').slice(0, -1).join('/');
  const common = {
    headless, only: only || null, secrets, screenshot: screenshot || undefined,
    skipMenus: mode === 'crud', skipCrawl: mode === 'crud', skipCrud: mode === 'menus',
    outDir: path.join(REPORT_DIR, relDir), isCancelled: () => state.cancel, compare: compare !== false,
  };
  const log = (m) => { state.log.push(m); emit('log', m); fileLog(m); };
  const finish = (rep) => { state.report = { dir: path.relative(REPORT_DIR, rep.outDir).split(path.sep).join('/'), ok: rep.ok, warn: rep.warn, fail: rep.fail, total: rep.total, items: rep.items }; emit('done', state.report); };
  const onErr = (e) => { log(`치명적 오류: ${e.message}`); emit('done', { error: e.message }); };
  const end = () => { state.running = false; emit('state', { running: false }); };

  // 일괄: 폴더(프로젝트) 또는 파일 목록
  if (dir !== undefined || files) {
    const list = files ? files.map((f) => scPath(f)) : collectScenarios(scPath(dir));
    if (!list.length) throw new Error('실행할 시나리오가 없습니다');
    const missing = batchPlaceholders(list, SCENARIO_DIR).filter((k) => !secrets[k]);
    if (missing.length) throw new Error(`실행 시 입력 필요: ${missing.map((k) => `{{${k}}}`).join(', ')}`);
    const label = files ? `선택 ${list.length}개` : (safeRel(dir).split('/').filter(Boolean).pop() || '전체');
    let onlyMap;
    if (rerunFailed) {
      onlyMap = rerunFrom(rerunFailed, common.outDir, { name: label, batch: true }).files;
      if (!Object.keys(onlyMap).length) throw new Error('직전 일괄 실행에 실패·주의 항목이 없습니다 — 재실행할 것이 없습니다');
    }
    Object.assign(state, { running: true, cancel: false, log: [], results: [], report: null, scenario: `${label} (일괄 ${list.length}개)`, progress: { done: 0, total: list.length, pct: 0, current: '' } });
    emit('state', { running: true, scenario: state.scenario });
    runBatch(list, label, { ...common, log, onlyMap, scenarioRoot: SCENARIO_DIR, batchDir: files ? undefined : relDir,
      onResult: (r) => { state.results.push(r); emit('result', r); },
      onProgress: (p) => { state.progress = p; emit('progress', p); },
    }).then(finish).catch(onErr).finally(end);
    return;
  }
  const full = scPath(file);
  const sc = loadSc(full); // extends 상속 해석
  if (!sc.baseUrl) throw new Error('baseUrl 이 없습니다');
  sc._file = safeRel(file); // 증적 report.json 에 기록 → 증적 탭에서 시나리오별 필터
  const missing = findPlaceholders(sc).filter((k) => !secrets[k]);
  if (missing.length) throw new Error(`실행 시 입력 필요: ${missing.map((k) => `{{${k}}}`).join(', ')}`);
  let onlyList;
  if (rerunFailed) {
    onlyList = rerunFrom(rerunFailed, common.outDir, { file: sc._file, name: sc.name }).names;
    if (!onlyList.length) throw new Error('직전 실행에 실패·주의 항목이 없습니다 — 재실행할 것이 없습니다');
  }
  Object.assign(state, { running: true, cancel: false, log: [], results: [], report: null, scenario: sc.name || file, progress: { done: 0, total: 0, pct: 0, current: '' } });
  emit('state', { running: true, scenario: state.scenario });
  if (sc._extends?.length) log(`상속: ${sc._extends.join(', ')}`);
  runScenario(sc, { ...common, log, onlyList,
    onResult: (r) => { state.results.push(r); emit('result', r); },
    onProgress: (p) => { state.progress = p; emit('progress', p); },
  }).then(finish).catch(onErr).finally(end);
}

// GUI 가 보낸(=아직 저장 안 된) 시나리오 객체의 extends 해석. file 을 주면 그 파일 위치 기준
// 저장 전 폼 값(extends·프로젝트 상속으로 baseUrl/login 이 빠져 있을 수 있음)을 실행 가능한 형태로 해석
const resolveBody = (sc, file) => resolveForRun(sc, { dir: file ? path.dirname(scPath(file)) : SCENARIO_DIR, root: SCENARIO_DIR });

// ---------- 녹화 ----------
async function startRecord({ scenario, url, login = true, secrets = {}, name = '', file = '' }) {
  if (rec.recording) throw new Error('이미 녹화 중입니다');
  if (state.running) throw new Error('테스트 실행 중에는 녹화할 수 없습니다');
  scenario = resolveBody(scenario, file);
  if (!scenario?.baseUrl) throw new Error('baseUrl 이 필요합니다');
  const missing = (login && scenario.login ? findPlaceholders(scenario.login) : []).filter((k) => !secrets[k]);
  if (missing.length) throw new Error(`실행 시 입력 필요: ${missing.map((k) => `{{${k}}}`).join(', ')}`);
  const { startRecorder } = await import('./recorder.js');
  Object.assign(rec, { recording: true, steps: [], log: [], name, handle: null });
  const log = (m) => { rec.log.push(m); emit('recLog', m); fileLog(m); };
  emit('recState', { recording: true, starting: true, name });
  try {
    rec.handle = await startRecorder(scenario, {
      url: url || '/', login, secrets, log,
      onStep: (i, s, steps) => { rec.steps = steps; emit('recStep', { index: i, step: s, steps }); },
      onState: (s) => { if (!s.recording) { rec.recording = false; rec.steps = s.steps || rec.steps; rec.handle = null; emit('recState', { recording: false, reason: s.reason, steps: rec.steps, name: rec.name }); } else emit('recState', { recording: true, url: s.url, name: rec.name }); },
    });
    rec.steps = rec.handle.steps;
  } catch (e) {
    rec.recording = false; rec.handle = null;
    emit('recState', { recording: false, reason: 'error', error: e.message.split('\n')[0], steps: [] });
    throw e;
  }
}

// ---------- 유틸 ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });

// 프로젝트 = scenarios/ 바로 아래 폴더. 기본 프로젝트 "기본" 은 항상 존재하며, 최상위에 굴러다니는 시나리오 파일은 기본 프로젝트로 옮긴다
// (example.json 은 템플릿이라 최상위에 그대로 두고 목록에서 제외)
const DEFAULT_PROJECT = '기본';
function ensureDefaultProject() {
  const def = path.join(SCENARIO_DIR, DEFAULT_PROJECT);
  fs.mkdirSync(def, { recursive: true });
  for (const f of fs.readdirSync(SCENARIO_DIR)) {
    if (!f.endsWith('.json') || f === 'example.json' || f.startsWith('_')) continue;
    const src = path.join(SCENARIO_DIR, f); if (!fs.statSync(src).isFile()) continue;
    let dest = path.join(def, f); let i = 1; while (fs.existsSync(dest)) dest = path.join(def, f.replace(/\.json$/, `(${i++}).json`));
    fs.renameSync(src, dest); fileLog(`시나리오를 기본 프로젝트로 이동: ${f}`);
  }
}
// 파일/폴더 이동·복사: from(상대경로) → toDir(상대 폴더) 아래로. 같은 이름이 있으면 실패
function moveEntry(from, toDir, copy) {
  const src = scPath(from); const rel = safeRel(from); if (!rel || !fs.existsSync(src)) throw new Error(`원본 없음: ${from}`);
  const destDir = scPath(toDir); const dest = path.join(destDir, path.basename(src));
  if (!safeRel(toDir)) throw new Error('대상은 프로젝트 또는 그 아래 폴더여야 합니다');
  if (fs.existsSync(dest)) throw new Error(`대상에 같은 이름이 이미 있습니다: ${path.basename(src)}`);
  if (fs.statSync(src).isDirectory() && (dest + path.sep).startsWith(src + path.sep)) throw new Error('폴더를 자기 자신 안으로 옮길 수 없습니다');
  fs.mkdirSync(destDir, { recursive: true });
  if (copy) fs.cpSync(src, dest, { recursive: true });
  else { try { fs.renameSync(src, dest); } catch { fs.cpSync(src, dest, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); } }
  return path.relative(SCENARIO_DIR, dest).split(path.sep).join('/');
}

// scenarios/ 아래 전체: 폴더(재귀) + 시나리오 파일. 폴더는 비어 있어도 포함 (프로젝트 틀만 잡아 둘 수 있게)
function listScenarios() {
  fs.mkdirSync(SCENARIO_DIR, { recursive: true });
  ensureDefaultProject();
  const dirs = [], files = [];
  const walk = (dir, rel) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      if (d.name.startsWith('.') || d.name.startsWith('_')) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { dirs.push(r); walk(path.join(dir, d.name), r); continue; }
      if (!d.name.endsWith('.json') || !rel) continue; // 최상위 파일(example.json 등)은 목록에 없음
      try {
        // 목록의 메뉴 수·자리표시자는 상속을 푼 기준으로 (상속 파일이 깨졌으면 원본만이라도)
        const own = readSc(path.join(dir, d.name));
        let sc = own; try { sc = loadSc(path.join(dir, d.name)); } catch { /* 상속 오류는 실행할 때 보고 */ }
        files.push({ file: r, dir: rel, name: sc.name || d.name, baseUrl: sc.baseUrl || '', menus: (sc.menus || []).length, crud: (sc.crud || []).length, login: !!sc.login, placeholders: findPlaceholders(sc), extends: sc._extends || undefined });
      } catch (e) { files.push({ file: r, dir: rel, name: d.name, error: e.message }); }
    }
  };
  walk(SCENARIO_DIR, '');
  return { dirs, files, projects: dirs.filter((d) => !d.includes('/')), defaultProject: DEFAULT_PROJECT };
}

// reports/ 아래를 재귀로 훑어 증적 폴더(report.json 이 있거나 screenshots/ 가 있는 폴더)를 찾는다. 일괄 폴더 안의 시나리오별 폴더는 내려가지 않음
function listReports() {
  if (!fs.existsSync(REPORT_DIR)) return [];
  const out = [];
  const walk = (abs, rel) => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('_')) continue;
      const full = path.join(abs, d.name); const r = rel ? `${rel}/${d.name}` : d.name;
      const p = path.join(full, 'report.json');
      if (fs.existsSync(p) || fs.existsSync(path.join(full, 'screenshots'))) {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 진행중이거나 손상 */ }
        // 일괄 증적이면 시나리오별 하위 보고서를 children 으로 (증적 탭에서 펼쳐 보기). dir 은 <일괄폴더>/<하위폴더>
        const children = Array.isArray(s.batch) ? s.batch.map((b) => ({ scenario: b.name, dir: b.dir ? `${r}/${b.dir}` : '', file: b.file || '', ok: b.ok ?? 0, warn: b.warn ?? 0, fail: b.fail ?? 0, total: b.total ?? 0, error: b.error || undefined })) : undefined;
        out.push({ dir: r, parent: rel, file: s.file || '', scenario: s.scenario || d.name, ranAt: s.ranAt || fs.statSync(full).mtime.toISOString(), ok: s.ok ?? 0, warn: s.warn ?? 0, fail: s.fail ?? 0, total: (s.results || []).length, batch: s.batch ? s.batch.length : 0, children });
        continue;
      }
      walk(full, r);
    }
  };
  walk(REPORT_DIR, '');
  return out.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}
const repPath = (rel) => { const p = path.join(REPORT_DIR, safeRel(rel)); if (!p.startsWith(REPORT_DIR)) throw new Error('잘못된 경로'); return p; };

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function openInOS(target) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
}

async function pingUrl(url) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' }); clearTimeout(t);
    return { ok: true, status: r.status };
  } catch (e) { return { ok: false, error: e.cause?.code || e.message }; }
}

// ---------- 라우팅 ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // /api/* 는 토큰 검사 (헤더 x-wwt-token 또는 쿼리 t). EventSource 는 헤더를 못 실어 쿼리로 받는다.
    // 정적 파일(/, /reports/*)은 읽기 전용이고 REPORT_DIR 로 제한돼 있어 검사에서 제외 — 보고서 <img>·새 탭 링크가 헤더를 못 싣기 때문.
    if (p.startsWith('/api/')) {
      const t = req.headers['x-wwt-token'] || url.searchParams.get('t') || '';
      if (t !== TOKEN) { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: '인증 토큰 불일치 (이 GUI 창에서만 조작할 수 있습니다)' })); }
    }
    if (p === '/' || p === '/index.html') return serveFile(res, UI);
    if (p.startsWith('/reports/')) {
      const rel = decodeURIComponent(p.slice('/reports/'.length));
      const file = path.join(REPORT_DIR, rel);
      if (!file.startsWith(REPORT_DIR)) { res.writeHead(403); return res.end(); }
      return serveFile(res, file);
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify({ running: state.running, scenario: state.scenario, log: state.log, results: state.results, report: state.report, progress: state.progress })}\n\n`);
      res.write(`event: recState\ndata: ${JSON.stringify({ recording: rec.recording, steps: rec.handle?.steps || rec.steps, name: rec.name, resumed: true })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/scenarios') return json(res, 200, listScenarios());
    if (p === '/api/scenario' && req.method === 'GET') {
      const f = scPath(url.searchParams.get('file'));
      // content = \uC6D0\uBCF8(\uD3B8\uC9D1\uC6A9). extends \uAC00 \uC788\uC73C\uBA74 resolved(\uC0C1\uC18D\uAE4C\uC9C0 \uBC18\uC601\uD55C \uC2E4\uC81C \uC2E4\uD589\uAC12) \uC640
      // inherited.base(\uBD80\uBAA8\uC5D0\uAC8C\uC11C\uB9CC \uC628 \uAC12) \uB97C \uD568\uAED8 \uC900\uB2E4 \u2192 \uD3B8\uC9D1 \uD3FC\uC740 resolved \uB97C \uBCF4\uC5EC \uC8FC\uACE0, \uC800\uC7A5\uD560 \uB54C \uBD80\uBAA8\uC640 \uAC19\uC740 \uAC12\uC740 \uBE7C\uC11C \uC0C1\uC18D\uC744 \uC720\uC9C0
      let inherited, resolved;
      try {
        const own = readSc(f);
        if (own.extends) {
          const base = resolveScenario({ extends: own.extends }, { dir: path.dirname(f), root: SCENARIO_DIR });
          delete base._extends;
          resolved = loadSc(f);
          resolved.extends = own.extends; // 편집 폼이 상속 관계를 유지한 채 저장할 수 있게 되돌려 둔다
          inherited = { from: resolved._extends || [], base, menus: (resolved.menus || []).length, crud: (resolved.crud || []).length, forbidden: (resolved.forbidden || []).length, inputs: Object.keys(resolved.inputs?.common || {}).length, login: !!resolved.login };
        }
      } catch (e) { inherited = { error: e.message }; }
      // \uD504\uB85C\uC81D\uD2B8 \uACF5\uD1B5 \uC124\uC815(_project.json) \u2014 \uD3B8\uC9D1 \uD3FC\uC758 "\uD504\uB85C\uC81D\uD2B8 \uC0C1\uC18D" \uD1A0\uAE00\uC774 \uCC38\uACE0
      const project = readProjectConfig(path.dirname(f), SCENARIO_DIR);
      return json(res, 200, { file: safeRel(url.searchParams.get('file')), content: fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''), inherited, resolved, project });
    }
    if (p === '/api/scenario' && req.method === 'POST') {
      // file: "프로젝트/폴더/이름.json" (상대경로). replace: 이전 경로 — 다르면 이동(옛 파일 삭제)
      const { file, content, replace } = await body(req);
      let parsed; try { parsed = JSON.parse(String(content).replace(/^\uFEFF/, '')); } catch (e) { return json(res, 400, { error: `JSON 문법 오류: ${e.message}` }); }
      let rel = safeRel(file || `${parsed.name || 'scenario'}.json`);
      if (!rel.includes('/')) rel = `${DEFAULT_PROJECT}/${rel}`; // 프로젝트 없이 저장하면 기본 프로젝트로
      const full = scPath(rel);
      // baseUrl 은 필수 — 단, extends 또는 프로젝트 공통 설정(_project.json)으로 상속받으면 된다
      if (!parsed.baseUrl) {
        let eff = null;
        try { eff = resolveForRun(parsed, { dir: path.dirname(full), root: SCENARIO_DIR }); } catch (e) { return json(res, 400, { error: `상속(extends) 오류: ${e.message}` }); }
        if (!eff?.baseUrl) return json(res, 400, { error: 'baseUrl 은 필수입니다 (상속받는 경우 상속 대상 또는 프로젝트 공통 설정에 있어야 합니다)' });
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(parsed, null, 2), 'utf8');
      if (replace && safeRel(replace) !== rel) { const old = scPath(replace); if (fs.existsSync(old)) fs.unlinkSync(old); }
      return json(res, 200, { ok: true, file: rel });
    }
    if (p === '/api/scenario/delete' && req.method === 'POST') {
      const { file } = await body(req);
      const f = scPath(file);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return json(res, 200, { ok: true });
    }
    // 폴더(프로젝트) 생성/삭제/이름변경
    if (p === '/api/folder' && req.method === 'POST') {
      const { dir } = await body(req);
      const rel = safeRel(dir); if (!rel) return json(res, 400, { error: '폴더 이름을 입력하세요' });
      fs.mkdirSync(scPath(rel), { recursive: true });
      return json(res, 200, { ok: true, dir: rel });
    }
    if (p === '/api/folder/delete' && req.method === 'POST') {
      const { dir } = await body(req);
      const full = scPath(dir); if (!safeRel(dir)) return json(res, 400, { error: '루트는 삭제할 수 없습니다' });
      if (safeRel(dir) === DEFAULT_PROJECT) return json(res, 400, { error: '기본 프로젝트는 삭제할 수 없습니다' });
      if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    // 시나리오/폴더를 다른 프로젝트(또는 폴더)로 이동·복사
    if (p === '/api/move' && req.method === 'POST') {
      const { from, to, copy } = await body(req);
      try { return json(res, 200, { ok: true, dest: moveEntry(from, to, !!copy) }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/folder/rename' && req.method === 'POST') {
      const { dir, to } = await body(req);
      const from = scPath(dir); const dest = scPath(to);
      if (!safeRel(dir) || !safeRel(to)) return json(res, 400, { error: '잘못된 경로' });
      if (fs.existsSync(dest)) return json(res, 400, { error: '같은 이름의 폴더가 이미 있습니다' });
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(from, dest);
      return json(res, 200, { ok: true, dir: safeRel(to) });
    }
    if (p === '/api/example') return json(res, 200, { content: fs.readFileSync(path.join(SCENARIO_DIR, 'example.json'), 'utf8') });
    if (p === '/api/run' && req.method === 'POST') {
      try { await startRun(await body(req)); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/stop' && req.method === 'POST') { state.cancel = true; return json(res, 200, { ok: true }); }
    // 화면의 입력 필드 수집 (GUI 메뉴 입력값 팝업). scenario: 현재 편집 중인 시나리오 객체(저장 전 값도 허용)
    if (p === '/api/scan' && req.method === 'POST') {
      const { scenario: raw, url: target, secrets = {}, file: from = '' } = await body(req);
      if (state.running) return json(res, 409, { error: '테스트 실행 중에는 필드를 가져올 수 없습니다' });
      let scenario; try { scenario = resolveBody(raw, from); } catch (e) { return json(res, 400, { error: e.message }); }
      if (!scenario?.baseUrl || !target) return json(res, 400, { error: 'baseUrl 과 화면 URL 이 필요합니다' });
      const missing = findPlaceholders(scenario).filter((k) => !secrets[k]);
      if (missing.length) return json(res, 400, { error: `실행 시 입력 필요: ${missing.map((k) => `{{${k}}}`).join(', ')}`, missing });
      const { scanFields } = await import('./scan.js');
      try { return json(res, 200, await scanFields(scenario, target, secrets)); }
      catch (e) { return json(res, 500, { error: e.message.split('\n')[0] }); }
    }
    // 시나리오 사전 검사 (저장 전 값도 허용). extends 는 풀어서 검사한다
    if (p === '/api/lint' && req.method === 'POST') {
      const { scenario: raw, file: from = '' } = await body(req);
      const { lintScenario } = await import('./lint.js');
      let sc = raw;
      try { sc = resolveBody(raw, from); } catch (e) { return json(res, 200, { issues: [{ level: 'error', msg: `상속(extends) 오류: ${e.message}` }] }); }
      return json(res, 200, { issues: lintScenario(sc) });
    }
    // 🔍 메뉴 자동 수집 (GUI 편집 탭). 시나리오는 저장 전 값도 허용
    if (p === '/api/discover' && req.method === 'POST') {
      const { scenario: raw, secrets = {}, file: from = '', url: start, depth, pages, max, selector, pattern } = await body(req);
      if (state.running) return json(res, 409, { error: '테스트 실행 중에는 메뉴를 수집할 수 없습니다' });
      if (rec.recording) return json(res, 409, { error: '녹화 중에는 메뉴를 수집할 수 없습니다' });
      let scenario; try { scenario = resolveBody(raw, from); } catch (e) { return json(res, 400, { error: e.message }); }
      if (!scenario?.baseUrl) return json(res, 400, { error: 'baseUrl 이 필요합니다' });
      const missing = findPlaceholders(scenario.login || {}).filter((k) => !secrets[k]);
      if (missing.length) return json(res, 400, { error: `실행 시 입력 필요: ${missing.map((k) => `{{${k}}}`).join(', ')}`, missing });
      const { discoverMenus } = await import('./discover.js');
      try { return json(res, 200, await discoverMenus(scenario, { start, depth, pages, max, selector, pattern, secrets, log: (m) => emit('log', m) })); }
      catch (e) { return json(res, 500, { error: e.message.split('\n')[0] }); }
    }
    // 📂 소스에서 시나리오 초안 만들기 (정적 분석 — 서버·브라우저 없이 소스 폴더만 읽는다)
    if (p === '/api/source/scan' && req.method === 'POST') {
      const { root, name, baseUrl, user, pattern, limit, expect, actions } = await body(req);
      if (!root) return json(res, 400, { error: '소스 폴더 경로를 입력하세요' });
      const { scanSource, writeSourceReport, safeActions } = await import('./source-scan.js');
      try {
        const r = scanSource(root, { name, baseUrl, user, pattern, limit: Number(limit) || undefined, expect: expect !== false, log: (m) => emit('log', m) });
        const forbWords = r.forbidden.map((d) => d.word);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
        const dir = path.join('_소스분석', `${String(r.name).replace(/[^\w가-힣-]+/g, '_')}-${stamp}`);
        writeSourceReport(r, path.join(REPORT_DIR, dir));
        // 응답은 GUI 가 쓰는 것만 (근거 하나·expect 하나). 전체 근거는 보고서에 있다
        return json(res, 200, {
          reportDir: dir.split(path.sep).join('/'),
          name: r.name, baseUrl: r.baseUrl, login: r.login, forbidden: r.forbidden,
          inputsCommon: r.inputsCommon, searchSel: r.searchSel, warnings: r.warnings,
          stats: r.stats, pattern: r.pattern, skipped: r.skipped.length,
          menus: r.menus.map((m) => ({
            name: m.name, url: m.url, source: m.source, confidence: m.confidence, risky: !!m.risky,
            expect: m.expect?.[0]?.sel || '', from: m.evidence?.[0] ? `${m.evidence[0].file}:${m.evidence[0].line}` : '',
            detail: m.detailCandidate ? `${m.detailCandidate.selector}${m.detailCandidate.dblclick ? ' (더블클릭)' : ''}` : '',
            buttons: (m.buttons || []).map((b) => `${b.danger ? '⚠' : ''}${b.label}`).join(' · '),
            // 🖱 버튼 동작 검사: 데이터를 안 바꾸는 버튼만 (요청했을 때만 내려보낸다)
            actions: actions ? safeActions(m.buttons || [], forbWords) : undefined,
          })),
        });
      } catch (e) { return json(res, 500, { error: e.message.split('\n')[0] }); }
    }
    // ----- 녹화 -----
    if (p === '/api/record/start' && req.method === 'POST') {
      try { await startRecord(await body(req)); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message.split('\n')[0] }); }
    }
    if (p === '/api/record/stop' && req.method === 'POST') { rec.handle?.stop(); return json(res, 200, { ok: true, steps: rec.handle?.steps || rec.steps }); }
    if (p === '/api/record/remove' && req.method === 'POST') { const { index } = await body(req); if (rec.handle) rec.handle.remove(index); else rec.steps.splice(index, 1); return json(res, 200, { ok: true, steps: rec.handle?.steps || rec.steps }); }
    if (p === '/api/record/add' && req.method === 'POST') { const { step } = await body(req); if (rec.handle) rec.handle.add(step); else rec.steps.push(step); return json(res, 200, { ok: true, steps: rec.handle?.steps || rec.steps }); }
    if (p === '/api/record') return json(res, 200, { recording: rec.recording, steps: rec.handle?.steps || rec.steps, log: rec.log, name: rec.name });

    if (p === '/api/reports') return json(res, 200, listReports());
    if (p === '/api/report/delete' && req.method === 'POST') {
      const { dir } = await body(req);
      const d = repPath(dir);
      if (safeRel(dir) && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/open' && req.method === 'POST') {
      const { what, dir, name } = await body(req);
      // 파일 열기: 앱 창(Playwright 컨텍스트)에서는 브라우저 다운로드가 제대로 동작하지 않으므로
      // defects.csv 같은 파일은 OS 기본 프로그램(엑셀 등)으로 직접 연다
      if (what === 'file') {
        const f = path.join(repPath(dir), safeRel(name || ''));
        if (!f.startsWith(REPORT_DIR)) return json(res, 400, { error: '잘못된 경로' });
        if (!fs.existsSync(f)) return json(res, 400, { error: `파일이 없습니다: ${name} (예전 증적에는 없을 수 있습니다)` });
        openInOS(f);
        return json(res, 200, { ok: true, path: f });
      }
      if (what === 'reports') openInOS(dir ? repPath(dir) : REPORT_DIR);
      else if (what === 'scenarios') openInOS(dir ? scPath(dir) : SCENARIO_DIR);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/ping' && req.method === 'POST') return json(res, 200, await pingUrl((await body(req)).url));
    // 프로젝트 공통 설정 (_project.json): 접속 URL·브라우저·로그인
    if (p === '/api/project' && req.method === 'GET') {
      const dir = safeRel(url.searchParams.get('dir') || '').split('/')[0];
      return json(res, 200, { dir, config: dir ? readProjectConfig(path.join(SCENARIO_DIR, dir), SCENARIO_DIR) : {} });
    }
    if (p === '/api/project' && req.method === 'POST') {
      const { dir, config } = await body(req);
      const project = safeRel(dir || '').split('/')[0];
      if (!project) return json(res, 400, { error: '프로젝트를 지정하세요' });
      if (!config || typeof config !== 'object') return json(res, 400, { error: '설정 형식 오류' });
      // 저장은 지정된 키(baseUrl/browser/login/stubServer/reuseSession)만, 값이 있는 것만
      // (reuseSession 은 켤 때만 보낸다 — 끄면 키가 빠져서 전체 설정 config.json 을 따른다)
      const clean = {}; for (const k of PROJECT_KEYS) if (config[k] !== undefined && config[k] !== null && config[k] !== '') clean[k] = config[k];
      const f = projectConfigPath(project, SCENARIO_DIR);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (Object.keys(clean).length) fs.writeFileSync(f, JSON.stringify(clean, null, 2), 'utf8');
      else if (fs.existsSync(f)) fs.unlinkSync(f); // 다 비우면 파일 삭제
      return json(res, 200, { ok: true, config: clean });
    }
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, { config: loadConfig() });
    if (p === '/api/config' && req.method === 'POST') {
      const { config } = await body(req);
      if (!config || typeof config !== 'object') return json(res, 400, { error: '설정 형식 오류' });
      saveConfig(config);
      return json(res, 200, { ok: true, config });
    }
    if (p === '/api/info') return json(res, 200, { root: ROOT, node: process.version, platform: process.platform, bundledBrowsers: !!process.env.PLAYWRIGHT_BROWSERS_PATH });
    res.writeHead(404); res.end('not found');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

export function startServer({ port = 0, open = true } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer(handle);
    server.listen(port, '127.0.0.1', async () => {
      const addr = `http://127.0.0.1:${server.address().port}`;
      const appUrl = `${addr}/?t=${TOKEN}`; // 토큰은 앱 창 URL 로만 전달 (콘솔에는 안 찍는다)
      console.log(`WIGO Web Tester 실행 중: ${addr}  (이 창을 닫으면 종료 · 로그는 logs\\ 폴더)`);
      fileLog(`GUI 시작: ${addr}`);
      if (open) await openAppWindow(appUrl, () => { fileLog('앱 창 닫힘 — 종료'); process.exit(0); });
      resolve({ server, url: addr });
    });
  });
}

// Chrome/Edge 를 앱 창(--app)으로 열어 프로그램처럼 보이게. 실패하면 기본 브라우저.
async function openAppWindow(url, onClose) {
  const { chromium } = await import('playwright');
  const os = await import('node:os');
  // 실행마다 새 임시 프로필. 고정 프로필을 쓰면 이전 WIGO 창이 남아 있을 때 Chrome 이 기존 프로세스에 창만 하나 더 띄우고
  // Playwright 연결은 실패 → Edge → 기본 브라우저까지 연쇄로 창이 뜨는 문제가 있었음
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wwt-gui-'));
  const cleanup = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 사용 중이면 다음 기회에 */ } };
  // ignoreDefaultArgs 로 --enable-automation 을 지우지 않는다: "자동화 표식을 일부러 숨기는" 코드로 보여
  // 보안 프로그램·반입 심사에서 불리하다. "자동화 소프트웨어가 제어 중" 안내줄이 뜨는 것 외에 기능 차이는 없다.
  const tryLaunch = async (opts) => chromium.launchPersistentContext(profile, {
    headless: false, viewport: null, chromiumSandbox: true, // --no-sandbox 경고 방지
    args: [`--app=${url}`, '--window-size=1280,860', '--disable-extensions'],
    timeout: 20000,
    ...opts,
  });
  const errors = [];
  for (const opts of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      const ctx = await tryLaunch(opts);
      ctx.on('close', () => { cleanup(); onClose(); });
      return;
    } catch (e) { errors.push(`${opts.channel || 'chromium'}: ${e.message.split('\n')[0]}`); }
  }
  cleanup();
  const msg = '브라우저 앱 창을 열지 못해 기본 브라우저로 엽니다. 종료는 Ctrl+C\n  ' + errors.join('\n  ');
  console.log(msg); fileLog(msg);
  openInOS(url);
}
