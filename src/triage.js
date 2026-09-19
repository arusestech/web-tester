// 결과 1건을 증상만 보고 1차 분류한다 (AI 없음, 규칙 기반).
// 보고서를 받는 사람이 "서버를 고칠 일"과 "시나리오를 고칠 일"과 "무시해도 되는 것"을 바로 나눠 볼 수 있게 하는 용도.
// 최종 판단은 사람이 한다 — 그래서 "의심" 이라는 말을 붙인다.

// 순서가 곧 우선순위 (위에서 먼저 걸리는 것이 이긴다)
const RULES = [
  { type: '서버 버그', re: /HTTP (5\d\d)|서버 오류 응답|에러 페이지 감지|Exception|SQLException|스택트레이스|업무오류 응답|JS 예외/ },
  { type: '권한/세션', re: /로그인 화면으로 돌아감|HTTP 40[13]|권한이 없|접근 권한|세션이 만료/ },
  { type: '안전장치 차단', re: /금지 버튼 클릭 차단|금지 동작 확인창 차단/ },
  { type: '시나리오 오류 의심', re: /핵심 요소 없음|입력 필드 없음|조회 버튼 없음|프레임 없음|입력 실패|Timeout .* exceeded|waiting for (locator|selector)|strict mode violation|net::ERR_/ },
  { type: '데이터 부족', re: /데이터가 없어 상세 조회 생략|빈 화면/ },
  { type: '화면 깨짐 의심', re: /이미지 로드 실패|가로 스크롤 발생/ },
  { type: '느림', re: /느린 화면/ },
  { type: '환경 노이즈 의심', re: /콘솔 에러|리소스 응답|요청 실패|다이얼로그:/ },
];

/** 결과 → { type, why } (정상이면 null) */
export function triage(r) {
  if (!r || r.status === 'ok') return null;
  const msgs = (r.issues || []).map((i) => i.msg);
  const all = msgs.join('\n');
  if (r.flaky) return { type: '불안정(flaky)', why: msgs[0] || '' };
  for (const rule of RULES) {
    const hit = msgs.find((m) => rule.re.test(m));
    if (hit) return { type: rule.type, why: hit };
  }
  return { type: '미분류', why: msgs[0] || (all ? all.slice(0, 80) : '') };
}

/** 여러 결과의 분류별 개수 (많은 순) */
export function triageSummary(results) {
  const m = new Map();
  for (const r of results) {
    const t = r.triage?.type || triage(r)?.type;
    if (t) m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}
