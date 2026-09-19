// 테스트 데이터 변수 + 동적 토큰. 시나리오의 {{이름}} 을 값으로 바꿀 때 쓴다.
// 우선순위(runner): 실행 시 입력(secrets) > 시나리오 vars > 동적 토큰.
//   vars   : 시나리오 "vars" 에 저장된 목업 값 (재사용, 파일에 저장됨)
//   동적 토큰: 실행마다 값이 정해지는 예약 이름 — 등록 흐름의 중복키(같은 값 재등록 실패)를 피할 때
//     {{today}} 2026-08-29 · {{now}} 20260829_143022 · {{time}} 143022 · {{ts}} epoch(ms)
//     {{rand}}/{{rand6}} 6자리 난수 · {{rand4}} 4자리 · {{uuid}} 8자리 hex · {{seq}} 1,2,3…(쓸 때마다 증가)
export const DYNAMIC = ['today', 'now', 'time', 'ts', 'rand', 'rand6', 'rand4', 'uuid', 'seq'];
export const RESERVED = DYNAMIC;

// 실행 1회 동안 쓰는 동적 토큰 계산기. seq 만 매번 증가하고 나머지는 한 실행 안에서 같은 값(한 record 의 필드끼리 일관).
export function makeDynamic() {
  const cache = {}; let seq = 0;
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const compute = (k) => {
    switch (k) {
      case 'today': return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      case 'now': return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      case 'time': return `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      case 'ts': return String(Date.now());
      case 'rand': case 'rand6': return String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      case 'rand4': return String(Math.floor(Math.random() * 1e4)).padStart(4, '0');
      case 'uuid': return Math.random().toString(16).slice(2, 10);
      default: return undefined;
    }
  };
  return {
    isDynamic: (k) => DYNAMIC.includes(k),
    get: (k) => {
      if (k === 'seq') return String(++seq);
      if (!DYNAMIC.includes(k)) return undefined;
      if (!(k in cache)) cache[k] = compute(k);
      return cache[k];
    },
  };
}
