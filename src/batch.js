// 프로젝트/폴더 단위 일괄 실행.
// scenarios/<프로젝트>/<폴더>/<시나리오>.json 구조에서 폴더(또는 프로젝트, 또는 파일 여러 개)를 골라 순서대로 실행하고,
// 증적은 reports/<라벨>-일괄-<시각>/ 아래에 시나리오별 폴더 + 전체 합산 report.html 로 남긴다.
// 여러 시나리오가 같은 항목(메뉴)을 공유하면 "시나리오별 매트릭스"(행=메뉴, 열=역할)를 합산 보고서에 함께 그린다.
import fs from 'node:fs';
import path from 'node:path';
import { runScenario } from './runner.js';
import { writeReport } from './report.js';
import { findPlaceholders } from './secrets.js';
import { readJsonFile, resolveForRun } from './scenario.js';
import { cmpKey, findPrevReport, buildCompare } from './compare.js';

// 시나리오 한 개 읽기 (extends 상속 + 프로젝트 공통 설정 병합)
const readJson = (f, root) => resolveForRun(readJsonFile(f), { dir: path.dirname(path.resolve(f)), root });

/** 디렉터리면 그 아래 모든 .json (재귀, 이름순), 파일이면 그 파일 하나 → 절대경로 배열 */
export function collectScenarios(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`경로 없음: ${target}`);
  if (fs.statSync(abs).isFile()) return [abs];
  const out = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      if (d.name.startsWith('_') || d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p); else if (d.name.endsWith('.json')) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** 여러 시나리오의 {{자리표시자}} 합집합 (상속받은 로그인 정보까지 포함) */
export function batchPlaceholders(files, root) {
  const set = new Set();
  for (const f of files) { try { findPlaceholders(readJson(f, root)).forEach((k) => set.add(k)); } catch { /* 손상 파일은 실행 시 보고 */ } }
  return [...set];
}

// ---------- 시나리오별 매트릭스 ----------
// perScenario: [{ name, results }] (results 는 시나리오 자체의 항목 이름)
// blocked: 권한 차단으로 볼 증상 정규식 (시나리오의 blocked 키 합집합)
function buildMatrix(perScenario, blocked = []) {
  if (perScenario.length < 2) return null;
  const res = blocked.map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
  const order = [], byName = new Map();
  for (const s of perScenario) {
    for (const r of s.results) {
      const k = cmpKey(r.name);
      if (!byName.has(k)) { byName.set(k, new Map()); order.push(k); }
      const cur = byName.get(k);
      const worse = { ok: 0, warn: 1, fail: 2 };
      const msg = (r.issues || []).map((i) => i.msg).slice(0, 2).join(' / ');
      const cell = { status: r.status, expected: !!r.expected, blocked: res.some((re) => re.test(msg)), msg };
      const old = cur.get(s.name);
      if (!old || worse[cell.status] > worse[old.status]) cur.set(s.name, cell);
    }
  }
  const shared = order.filter((k) => byName.get(k).size > 1);
  if (shared.length < 2) return null; // 겹치는 항목이 없으면 매트릭스가 의미 없음
  const rows = order.slice(0, 500).map((k) => ({ name: k, cells: perScenario.map((s) => byName.get(k).get(s.name) || null) }));
  const totals = perScenario.map((s) => ({
    ok: s.results.filter((r) => r.status === 'ok').length,
    warn: s.results.filter((r) => r.status === 'warn').length,
    fail: s.results.filter((r) => r.status === 'fail').length,
  }));
  return { scenarios: perScenario.map((s) => s.name), rows, totals, shared: shared.length, truncated: order.length > 500 };
}

/**
 * files: 절대경로 배열, label: 증적 폴더/보고서 이름
 * opt: runner 옵션 + { onScenario(i, n, name), onResult(r) (r.scenario 추가됨), onProgress(p) (전체 기준), log, isCancelled,
 *                     onlyMap({ '프로젝트/폴더/x.json': ['메뉴명', ...] } — 실패건만 재실행), scenarioRoot }
 * 반환: { outDir, htmlPath, ok, warn, fail, total, items: [{file, name, ok, warn, fail, total, dir, error}] }
 */
export async function runBatch(files, label, opt = {}) {
  const log = opt.log || ((m) => console.log(m));
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const safe = (s) => String(s).replace(/[^\w가-힣-]+/g, '_');
  const outDir = path.join(opt.outDir, `${safe(label)}-일괄-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const rel = (f) => (opt.scenarioRoot && f.startsWith(opt.scenarioRoot) ? path.relative(opt.scenarioRoot, f).split(path.sep).join('/') : path.basename(f));
  // 실패건만 재실행: 대상이 없는 시나리오는 통째로 건너뛴다
  const targets = opt.onlyMap || null;
  const list = targets ? files.filter((f) => targets[rel(f)]?.length) : files;
  if (targets) log(`실패건만 재실행: 시나리오 ${list.length}/${files.length}개, 항목 ${Object.values(targets).flat().length}개`);
  const items = [];
  const all = [];
  const perScenario = [];
  const blocked = new Set();
  const n = list.length;
  for (let i = 0; i < n; i++) {
    if (opt.isCancelled?.()) { log('⏹ 사용자 중단 — 남은 시나리오 생략'); break; }
    const file = list[i];
    let sc;
    try { sc = readJson(file, opt.scenarioRoot); if (!sc.baseUrl) throw new Error('baseUrl 이 없습니다'); }
    catch (e) {
      const name = path.basename(file);
      log(`\n═══ [${i + 1}/${n}] ${name} — 읽기 실패: ${e.message}`);
      const r = { name: `[${name}] 시나리오 읽기 실패`, url: file, issues: [{ level: 'fail', msg: e.message }], status: 'fail', error: true, scenario: name };
      all.push(r); opt.onResult?.(r);
      items.push({ file, name, error: e.message, ok: 0, warn: 0, fail: 1, total: 1 });
      continue;
    }
    const name = sc.name || path.basename(file, '.json');
    sc._file = rel(file); // 증적 ↔ 시나리오 연결용
    (sc.blocked || []).forEach((b) => blocked.add(b));
    log(`\n═══ [${i + 1}/${n}] ${name} ═══`);
    opt.onScenario?.(i, n, name);
    try {
      const rep = await runScenario(sc, {
        ...opt, outDir, onlyList: targets ? targets[rel(file)] : opt.onlyList,
        compare: false, // 비교는 일괄 보고서에서 한 번만 (일괄 폴더 안에는 직전 실행이 없다)
        onResult: (r) => opt.onResult?.({ ...r, scenario: name }),
        onProgress: (p) => opt.onProgress?.({ done: i, total: n, pct: Math.round(((i + (p.pct || 0) / 100) / n) * 100), current: `[${i + 1}/${n}] ${name}${p.current ? ' › ' + p.current : ''}` }),
        log,
      });
      const sub = path.basename(rep.outDir);
      const results = JSON.parse(fs.readFileSync(rep.jsonPath, 'utf8')).results;
      perScenario.push({ name, results });
      for (const r of results) all.push({ ...r, name: `[${name}] ${r.name}`, scenario: name, screenshot: r.screenshot ? path.join(sub, r.screenshot) : r.screenshot });
      items.push({ file, name, ok: rep.ok, warn: rep.warn, fail: rep.fail, total: rep.total, dir: sub });
    } catch (e) {
      if (e.cancelled) break;
      log(`치명적 오류: ${e.message.split('\n')[0]}`);
      const r = { name: `[${name}] 실행 실패`, url: sc.baseUrl, issues: [{ level: 'fail', msg: e.message.split('\n')[0] }], status: 'fail', error: true, scenario: name };
      all.push(r); opt.onResult?.(r);
      items.push({ file, name, error: e.message, ok: 0, warn: 0, fail: 1, total: 1 });
    }
  }
  // 직전 일괄 실행과 비교 (같은 폴더의 가장 최근 일괄 증적)
  let compare = null;
  if (opt.compare !== false) {
    try { compare = buildCompare(findPrevReport(outDir, { file: opt.batchDir, name: label, batch: true }), all); }
    catch (e) { log(`(직전 실행 비교 건너뜀: ${e.message.split('\n')[0]})`); }
  }
  const matrix = buildMatrix(perScenario, [...blocked]);

  // 합산 보고서 (시나리오별 폴더의 스크린샷을 상대경로로 링크)
  const rep = writeReport(all, outDir, { name: `${label} (일괄 ${items.length}개)`, _file: opt.batchDir, baseUrl: [...new Set(items.map((it) => { try { return readJson(it.file, opt.scenarioRoot).baseUrl; } catch { return null; } }).filter(Boolean))].join(', ') }, { compare, matrix, partial: !!(targets || opt.only), batch: items });
  // 시나리오별 요약도 json 에 추가
  const j = JSON.parse(fs.readFileSync(rep.jsonPath, 'utf8')); j.batch = items.map(({ file, ...rest }) => ({ file: rel(file), ...rest }));
  fs.writeFileSync(rep.jsonPath, JSON.stringify(j, null, 2), 'utf8');
  log(`\n일괄 합계: ${rep.summary[0]}`);
  rep.summary.slice(1).forEach((l) => log(l));
  if (matrix) log(`시나리오별 매트릭스: 항목 ${matrix.rows.length}행 × 시나리오 ${matrix.scenarios.length}열 (공통 항목 ${matrix.shared}개)`);
  log(`증적 폴더: ${outDir}`);
  opt.onProgress?.({ done: n, total: n, pct: 100, current: '' });
  return { ...rep, items };
}
