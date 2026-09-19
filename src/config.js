// 전역 설정: config.json (프로젝트 루트). 시나리오에 값이 없을 때의 기본값을 정한다.
// 시나리오가 직접 정한 값은 항상 우선한다 — 여기서는 "안 정한 것"만 채운다.
// 주 용도: 순회 속도(speed). 보안이 엄격한 곳(WAF/IPS·계정잠금)에서는 느리게 돌려야 안전하다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'config.json');

// 순회 속도 프리셋 → stepDelay(화면·스텝 사이 대기 ms) / slowMo(입력 하나하나 사이 ms)
// 느림: 스캐닝으로 오인받지 않도록 천천히. 빠름: 사내 테스트망 등 마음껏 돌려도 되는 곳.
export const SPEED_PRESETS = {
  '아주 느림': { stepDelay: 1500, slowMo: 200 },
  '느림':      { stepDelay: 1000, slowMo: 120 },
  '보통':      { stepDelay: 500,  slowMo: 0 },
  '빠름':      { stepDelay: 200,  slowMo: 0 },
};
export const DEFAULT_SPEED = '보통';

export function loadConfig() {
  if (process.env.WWT_NO_CONFIG) return {}; // 자체 검증은 전역 설정 영향 없이 결정적으로 (--no-config / env)
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; } // 파일이 없거나 깨졌으면 빈 설정 (전부 시나리오/코드 기본값)
}

export function saveConfig(c) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c ?? {}, null, 2), 'utf8');
}

// 전역 기본값을 시나리오에 채운다(시나리오가 정한 값은 그대로 둔다). 새 객체를 돌려준다.
// speed 프리셋 < config 의 개별 값(stepDelay/slowMo/…) 순으로 겹쳐 쓰고, 마지막으로 시나리오가 이긴다.
export function withDefaults(sc, config = loadConfig()) {
  if (!sc || !config || !Object.keys(config).length) return sc;
  const preset = SPEED_PRESETS[config.speed] || {};
  const stepDelay = config.stepDelay ?? preset.stepDelay;
  const slowMo = config.slowMo ?? preset.slowMo;
  const out = { ...sc };
  // 순회 속도
  if (out.stepDelay === undefined && stepDelay !== undefined) out.stepDelay = stepDelay;
  if (slowMo !== undefined) out.browser = { ...out.browser, slowMo: out.browser?.slowMo ?? slowMo };
  // 대기 시간
  if (out.timeout === undefined && config.timeout !== undefined) out.timeout = config.timeout;
  if (out.expectTimeout === undefined && config.expectTimeout !== undefined) out.expectTimeout = config.expectTimeout;
  if (out.slowMs === undefined && config.slowMs !== undefined) out.slowMs = config.slowMs;
  if (out.emptyWait === undefined && config.emptyWait !== undefined) out.emptyWait = config.emptyWait;
  // 로그인 재시도
  if (config.retries !== undefined && out.login) out.login = { ...out.login, retries: out.login.retries ?? config.retries };
  // 브라우저 창 숨김(headless): 시나리오가 정하지 않았을 때만
  if (config.headless !== undefined) out.browser = { ...out.browser, headless: out.browser?.headless ?? config.headless };
  // 증적 캡처 기본(all/fail/none): 시나리오 evidence 가 정하면 그쪽이 이긴다(runner 에서 판정)
  if (out.screenshot === undefined && ['all', 'fail', 'none'].includes(config.screenshot)) out.screenshot = config.screenshot;
  // 로그인 세션 재사용
  if (out.reuseSession === undefined && config.reuseSession !== undefined) out.reuseSession = config.reuseSession;
  // 깨진 화면 검사(images/layout): 키 단위로 시나리오가 우선
  if (config.checks && typeof config.checks === 'object') out.checks = { ...config.checks, ...(out.checks || {}) };
  return out;
}
