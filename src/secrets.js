import { RESERVED } from './vars.js';

// 시나리오 안의 {{이름}} 중 "실행 시 입력받아야 하는 것"만. vars(테스트 데이터)·동적 토큰(today/rand/seq…)은 제외.
export function findPlaceholders(scenario) {
  const text = typeof scenario === 'string' ? scenario : JSON.stringify(scenario);
  const varKeys = (scenario && typeof scenario === 'object' && scenario.vars && typeof scenario.vars === 'object') ? Object.keys(scenario.vars) : [];
  const skip = new Set([...RESERVED, ...varKeys]);
  const set = new Set();
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!skip.has(m[1])) set.add(m[1]);
  return [...set];
}

// 환경변수 WWT_<이름> 에서 먼저 찾는다 (CI 용)
export function secretsFromEnv(names) {
  const out = {};
  for (const n of names) {
    const v = process.env[`WWT_${n}`] ?? process.env[`WWT_${n.toUpperCase()}`];
    if (v !== undefined) out[n] = v;
  }
  return out;
}
