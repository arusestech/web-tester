// 직전 실행 결과와 비교 + 실패 항목만 골라내기.
// 증적 폴더 구조: reports/<프로젝트>/<폴더>/<시나리오>-<시각>/report.json
// 같은 부모 폴더 안에서 "같은 시나리오"의 가장 최근 report.json 을 기준(baseline)으로 삼는다.
import fs from 'node:fs';
import path from 'node:path';

const RANK = { ok: 0, warn: 1, fail: 2 };

// 비교용 키: 상세 항목(↳ 메뉴 상세 #1 (행 텍스트))은 행 텍스트가 매번 달라지므로 괄호를 뗀다
export const cmpKey = (name) => {
  const s = String(name ?? '');
  return s.includes('↳') ? s.replace(/\s*\([^()]*\)\s*$/, '').trim() : s; // 일괄 결과는 "[시나리오] ↳ ..." 형태
};

// 같은 이름이 여러 번 나오면 순번을 붙여 구분 (화면에 보일 때는 SEP 뒤를 떼어 낸다)
const SEP = '\u0000';
function keysOf(results) {
  const seen = new Map(), keys = [];
  for (const r of results) {
    const k = cmpKey(r.name);
    const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    keys.push(n > 1 ? `${k}\u0000${n}` : k);
  }
  return keys;
}

// 로그인 실패로 중단된 실행? (항목이 거의 없고 로그인이 실패)
const abortedRun = (j) => (j.results || []).some((r) => String(r.name).replace(/^\[[^\]]+\]\s*/, '') === '로그인' && r.status === 'fail') && (j.results || []).length < 3;

export function readReportJson(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch { return null; }
}

/**
 * outDir 의 부모 폴더에서 같은 시나리오의 직전 증적을 찾는다.
 * match: { file(시나리오 상대경로), name(시나리오명), batch(일괄이면 true) }
 */
export function findPrevReport(outDir, match = {}) {
  const parent = path.dirname(path.resolve(outDir));
  const me = path.basename(path.resolve(outDir));
  if (!fs.existsSync(parent)) return null;
  const cands = [];
  for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === me) continue;
    const j = readReportJson(path.join(parent, d.name));
    if (!j || !Array.isArray(j.results) || !j.results.length) continue;
    const isBatch = !!(j.batch && j.batch.length);
    if (!!match.batch !== isBatch) continue;
    // 시나리오 상대경로가 서로 있으면 그것으로, 없으면 시나리오명으로 (옛 증적 호환)
    if (match.file && j.file) { if (j.file !== match.file) continue; }
    else if (match.name && j.scenario !== match.name && !d.name.startsWith(String(match.name).replace(/[^\w가-힣-]+/g, '_'))) continue;
    cands.push({ dir: path.join(parent, d.name), rel: d.name, json: j, at: j.ranAt || fs.statSync(path.join(parent, d.name)).mtime.toISOString(), skip: abortedRun(j) || !!j.partial });
  }
  // 로그인 실패로 곧장 끝났거나 일부만 돌린(실패건만 재실행·이름 필터) 실행은 기준으로 삼지 않는다
  // — 나머지 항목이 전부 "신규"로 보이기 때문. 그런 것밖에 없으면 그냥 가장 최근 것을 쓴다
  cands.sort((a, b) => (a.skip !== b.skip ? (a.skip ? 1 : -1) : String(b.at).localeCompare(String(a.at))));
  return cands[0] || null;
}

/**
 * 이전 결과(prev.json.results) 와 이번 결과를 비교.
 * 반환: { prevDir, prevRanAt, changes[](결과와 같은 순서), newFail[], fixed[], stillFail[], added[], removed[], counts }
 */
export function buildCompare(prev, results) {
  if (!prev?.json?.results?.length || !results.length) return null;
  const prevResults = prev.json.results;
  const prevKeys = keysOf(prevResults);
  const prevMap = new Map(prevKeys.map((k, i) => [k, prevResults[i]]));
  const curKeys = keysOf(results);
  const nice = (k) => String(k).split('\u0000')[0];

  const changes = [], newFail = [], fixed = [], stillFail = [], added = [], slower = [];
  results.forEach((r, i) => {
    const p = prevMap.get(curKeys[i]);
    const cur = RANK[r.status] ?? 0;
    if (!p) { changes.push('added'); added.push(r.name); if (r.status === 'fail') newFail.push(r.name); return; }
    const before = RANK[p.status] ?? 0;
    changes.push(cur > before ? 'worse' : cur < before ? 'better' : 'same');
    if (r.status === 'fail' && p.status !== 'fail') newFail.push(r.name);
    if (r.status === 'fail' && p.status === 'fail') stillFail.push(r.name);
    if (p.status !== 'ok' && r.status === 'ok') fixed.push(r.name);
    // 느려진 화면: 2배 이상 + 1초 이상 늘어난 것만 (측정 오차·1회성 지연 제외)
    if (r.ms && p.ms && r.ms > p.ms * 2 && r.ms - p.ms >= 1000) slower.push({ name: r.name, before: p.ms, after: r.ms });
  });
  const curSet = new Set(curKeys);
  const removed = prevKeys.filter((k) => !curSet.has(k)).map(nice);

  return {
    prevDir: prev.rel, prevPath: prev.dir, prevRanAt: prev.json.ranAt || prev.at,
    prevSummary: { ok: prev.json.ok ?? 0, warn: prev.json.warn ?? 0, fail: prev.json.fail ?? 0, total: prevResults.length },
    changes, newFail, fixed, stillFail, added, removed, slower,
  };
}

/** 보고서 한 줄 요약 (로그·md·html 공용) */
export function compareLine(c) {
  if (!c) return '';
  const bits = [`🆕 신규 실패 ${c.newFail.length}`, `✨ 해결 ${c.fixed.length}`, `➖ 그대로 실패 ${c.stillFail.length}`];
  if (c.added.length) bits.push(`✚ 신규 항목 ${c.added.length}`);
  if (c.slower?.length) bits.push(`🐢 느려짐 ${c.slower.length}`);
  if (c.removed.length) bits.push(`⏭ 이번 실행 제외 ${c.removed.length}`);
  return bits.join(' / ');
}

// ---------- 실패 항목만 재실행 ----------

// "↳ 사원관리 상세 #2 (홍길동)" → "사원관리" (상세는 부모 메뉴를 다시 돌려야 재현된다)
const parentName = (name) => {
  const s = cmpKey(name);
  const m = s.match(/^↳\s*(.+?)\s*상세\s*#\d+$/);
  return m ? m[1] : s;
};

/**
 * report.json → 재실행 대상.
 * 단일 시나리오: { names: [...] }
 * 일괄(batch): { byScenario: { '시나리오명': [이름...] }, files: ['프로젝트/폴더/x.json', ...] }
 * 일괄 결과의 항목 이름은 "[시나리오명] 메뉴" 형태라 접두사를 떼어 시나리오별로 나눈다.
 */
export function failedTargets(json) {
  const plain = (n) => String(n).replace(/^\[[^\]]+\]\s*/, '').trim();
  const bad = (json.results || []).filter((r) => r.status !== 'ok' && plain(r.name) !== '로그인');
  if (json.batch && json.batch.length) {
    const byScenario = {};
    for (const r of bad) {
      const sc = r.scenario || (String(r.name).match(/^\[([^\]]+)\]/) || [])[1];
      if (!sc) continue;
      const name = parentName(String(r.name).replace(/^\[[^\]]+\]\s*/, ''));
      (byScenario[sc] ||= new Set()).add(name);
    }
    const files = {};
    for (const it of json.batch) if (byScenario[it.name]) files[it.file] = [...byScenario[it.name]];
    return { byScenario: Object.fromEntries(Object.entries(byScenario).map(([k, v]) => [k, [...v]])), files, count: bad.length };
  }
  return { names: [...new Set(bad.map((r) => parentName(r.name)))], count: bad.length };
}
