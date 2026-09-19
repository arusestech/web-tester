// 시나리오 파일 읽기 + 공통 설정 상속(extends) 해석.
//
//   { "extends": "../_공통.json", "name": "P01 시스템관리자", "login": { ... } }
//
// - extends 는 문자열 또는 문자열 배열(여러 개면 순서대로 겹쳐 씀. 뒤에 오는 것이 우선)
// - 경로는 자기 파일 기준 상대경로, 또는 scenarios/ 기준 경로 ("기본/_공통.json") 둘 다 허용. .json 은 생략 가능
// - 병합 규칙: 객체는 깊게 병합, 배열·원시값은 자식이 통째로 교체
// - menusAdd / menusExclude / crudAdd / crudExclude 로 상속받은 목록을 더하거나 뺄 수 있다 (Exclude 는 이름 정규식)
import fs from 'node:fs';
import path from 'node:path';

export const readJsonFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}

// 상속받은 목록에 더하기(Add) / 빼기(Exclude). 병합이 끝난 뒤에 적용한다.
function applyListMods(sc) {
  const out = { ...sc };
  for (const key of ['menus', 'crud']) {
    const add = out[`${key}Add`], ex = out[`${key}Exclude`];
    if (Array.isArray(add)) { out[key] = [...(out[key] || []), ...add]; delete out[`${key}Add`]; }
    if (Array.isArray(ex)) {
      const res = ex.map((s) => new RegExp(s, 'i'));
      out[key] = (out[key] || []).filter((x) => !res.some((re) => re.test(x?.name || '')));
      delete out[`${key}Exclude`];
    }
  }
  return out;
}

// "../_공통.json" | "기본/_공통" → 실제 파일 경로. root 를 주면 그 밖으로 나가는 경로는 거부
function resolveRef(ref, dir, root) {
  const cand = [];
  const raw = String(ref).replace(/\\/g, '/');
  if (path.isAbsolute(raw)) cand.push(raw);
  else {
    if (dir) cand.push(path.resolve(dir, raw));
    if (root) cand.push(path.resolve(root, raw));
  }
  // 허용 범위: scenarios 폴더 안, 또는 그 시나리오 자신의 폴더 안 (scenarios 밖에 둔 시나리오도 옆 파일을 상속할 수 있게)
  const allowed = [root, dir].filter(Boolean).map((r) => path.resolve(r) + path.sep);
  for (const c of cand) {
    for (const f of [c, c.endsWith('.json') ? null : `${c}.json`]) {
      if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
      if (allowed.length && !allowed.some((a) => path.resolve(f).startsWith(a))) throw new Error(`상속 경로가 허용된 폴더 밖입니다: ${ref}`);
      return f;
    }
  }
  throw new Error(`상속 대상 파일 없음: ${ref}`);
}

/**
 * 시나리오 객체의 extends 를 풀어 완성된 시나리오를 만든다.
 * opt: { dir(이 시나리오 파일이 있는 폴더), root(scenarios 폴더 — 경로 제한용), seen(순환 방지) }
 */
export function resolveScenario(sc, opt = {}) {
  if (!isObj(sc)) return sc;
  if (!sc.extends) return applyListMods(sc);
  const { dir, root, seen = [] } = opt;
  const refs = Array.isArray(sc.extends) ? sc.extends : [sc.extends];
  let base = {};
  const chain = [];
  for (const ref of refs) {
    const file = resolveRef(ref, dir, root);
    if (seen.includes(file)) throw new Error(`상속이 순환합니다: ${[...seen, file].map((f) => path.basename(f)).join(' → ')}`);
    const parent = resolveScenario(readJsonFile(file), { dir: path.dirname(file), root, seen: [...seen, file] });
    chain.push(...(parent._extends || []), ref);
    base = deepMerge(base, parent);
  }
  const { extends: _drop, ...own } = sc;
  const merged = applyListMods(deepMerge(base, own));
  delete merged._extends;
  merged._extends = [...new Set(chain)];
  return merged;
}

// ---------- 프로젝트 공통 설정 (scenarios/<프로젝트>/_project.json) ----------
// 접속 URL·브라우저·로그인처럼 "같은 사이트면 같은" 설정을 프로젝트 단위로 두고, 시나리오가 값을 안 쓰면 여기서 상속.
// reuseSession(로그인 세션 재사용)도 "같은 사이트면 같은" 설정이라 프로젝트 단위로 둔다.
// 시나리오는 기본적으로 이 값을 상속하고, 자기 파일에 직접 적었을 때만 그 값이 이긴다.
export const PROJECT_KEYS = ['baseUrl', 'browser', 'login', 'stubServer', 'reuseSession'];
export const PROJECT_FILE = '_project.json';

// dir(시나리오 폴더)에서 프로젝트(root 바로 아래 첫 폴더)를 찾아 _project.json 을 읽는다. 없으면 {}
export function readProjectConfig(dir, root) {
  if (!dir || !root) return {};
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  if (!rel || rel.startsWith('..')) return {};
  const project = rel.split(path.sep)[0];
  if (!project) return {};
  const f = path.join(path.resolve(root), project, PROJECT_FILE);
  try { return fs.existsSync(f) ? readJsonFile(f) : {}; } catch { return {}; }
}
export function projectConfigPath(project, root) { return path.join(path.resolve(root), String(project).split(/[\\/]/)[0], PROJECT_FILE); }

// 프로젝트 공통값을 채운다. 단, 우선순위 = 시나리오 "자기 파일" > 프로젝트 설정 > extends(_공통).
//   즉 시나리오가 자기 파일에서 baseUrl/browser/login/stubServer 를 직접 정하지 않았으면, extends 로 온 값보다
//   프로젝트 설정을 우선한다 → "프로젝트 설정을 상속하면 그 값으로 돈다"는 기대대로 동작.
//   ownRaw: 시나리오 원본(extends 풀기 전). undefined 면 resolved 기준으로만 판단(자기 파일 구분 없음).
export function applyProjectDefaults(resolved, pc, ownRaw) {
  if (!isObj(resolved) || !isObj(pc) || !Object.keys(pc).length) return resolved;
  const own = isObj(ownRaw) ? ownRaw : resolved; // ownRaw 없으면 예전처럼 "없는 것만" 채우는 동작
  const out = { ...resolved };
  for (const k of PROJECT_KEYS) {
    if (pc[k] === undefined) continue;
    if (own[k] !== undefined) continue; // 시나리오 자기 파일이 직접 정하면 그게 최우선
    out[k] = pc[k];                      // 자기 파일에 없으면(extends 로 왔든 없든) 프로젝트 값 사용
  }
  return out;
}

/** extends 해석 + 프로젝트 공통 설정 병합 (실행·검사용 최종 시나리오). 우선순위: 시나리오 own > 프로젝트 설정 > extends */
export function resolveForRun(sc, opt = {}) {
  return applyProjectDefaults(resolveScenario(sc, opt), readProjectConfig(opt.dir, opt.root), sc);
}

/** 파일 하나를 읽어 상속·프로젝트 공통까지 해석 */
export function loadScenario(file, root) {
  const abs = path.resolve(file);
  return resolveForRun(readJsonFile(abs), { dir: path.dirname(abs), root });
}
