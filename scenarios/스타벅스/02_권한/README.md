# 권한별 시나리오 (2026-08-25 생성)

페르소나 1개 = 로그인 계정 1개 = 파일 1개. 비밀번호는 실행 시 `{{password}}` 입력(전 계정 동일 — 실행 시 입력).

실행: `run.bat scenarios\auth-P04-R210.json --mode all --secret password=<비번>` (배치: 아래 `run-auth-all.bat`)

| 파일 | 계정 | 권한 | 정상 메뉴 | 불일치▲ | 버튼 노출TC | crud 흐름 수 |
|---|---|---|---|---|---|---|
| auth-P01-R100.json | test01 | 시스템 관리자 | 64 | 0 | 25 | 52 |
| auth-P02-R110.json | TEST_R110 | 전체 관리자 | 48 | 0 | 25 | 50 |
| auth-P03-R130.json | TEST_R130 | 권한 관리자(VDI) | 17 | 1 | 0 | 15 |
| auth-P04-R210.json | TEST_R210 | 운영지원팀 팀장 | 30 | 0 | 25 | 41 |
| auth-P05-R220.json | TEST_R220 | VOC 관리자 | 38 | 0 | 25 | 47 |
| auth-P06-R230.json | TEST_R230 | Web VOC 접수자 | 22 | 0 | 14 | 26 |
| auth-P07-R240.json | TEST_R240 | Call VOC 접수자 | 22 | 0 | 14 | 28 |
| auth-P08-R250.json | TEST_R250 | 고객서비스팀 | 22 | 1 | 16 | 29 |
| auth-P09-R310.json | TEST_R310 | 운영기획팀 | 11 | 0 | 3 | 14 |
| auth-P10-R320.json | TEST_R320 | 칭찬파트너 | 3 | 0 | 2 | 10 |
| auth-P11-R330.json | TEST_R330 | 커피품질서비스팀 | 9 | 0 | 3 | 14 |
| auth-P12-R510.json | TEST_R510 | 영업팀장 | 9 | 0 | 4 | 11 |
| auth-P13-R520.json | TEST_R520 | DM | 9 | 0 | 4 | 11 |
| auth-P14-R530.json | TEST_R530 | 점장 | 6 | 0 | 4 | 12 |
| auth-P15-R540.json | TEST_R540 | 부점장 | 7 | 0 | 4 | 12 |
| auth-P16-R550.json | TEST_R550 | 수퍼바이저 | 5 | 0 | 2 | 10 |
| auth-P17-R560.json | TEST_R560 | 바리스타 | 1 | 0 | 1 | 9 |
| auth-P18-R701.json | TEST_R701 | 스타벅스임원 | 3 | 0 | 1 | 8 |
| auth-P19-R705.json | TEST_R705 | 지원센터-총괄부장 | 3 | 0 | 1 | 8 |
| auth-P20-R750.json | TEST_R750 | 지원센터-아카데미 | 6 | 0 | 1 | 6 |
| auth-P21-R800.json | TEST_R800 | CE 관리자 그룹 | 1 | 0 | 0 | 8 |
| auth-P22-R900.json | TEST_R900 | VOC조회 | 1 | 0 | 1 | 9 |
| auth-P23-R901.json | TEST_R901 | VOC 조회-지원센터 | 3 | 0 | 1 | 9 |
| auth-P24-R999.json | TEST_R999 | 일반사용자 | 3 | 0 | 1 | 8 |

## 판정 방법
- `menus`: 정상 접근 메뉴. 그리드 화면은 `table.ui-jqgrid-btable` expect, 조회 버튼 자동 클릭.
- `[불일치▲]`: 메뉴는 있으나 화면 실효 권한(DB) 없음 → accessDenied.jsp 또는 권한 alert 이 보고서에 기록되어야 정상(5xx 는 결함). 데이터가 조회되면 권한 불일치 결함.
- `[버튼 노출/미노출]`: `eval` 로 버튼 표시 상태를 기대값과 비교(불일치 시 ❌). 미노출 버튼의 우회 검증은 수동(note).
- `[CRUD-명세]`: 저장/삭제/처리 버튼은 forbidden 으로 클릭이 차단됨. 상세 폼 입력 명세(등록·배분·처리 팝업)는 후속 작성 필요 — 현재는 노출 확인만.
- `[URL 우회○]`/`[URL 차단]`: 메뉴에 없는 화면 직접 진입 샘플 3건씩.

## 미완 항목
- 등록/배분/처리 상세 화면(VOC0001 폼, VOC1032 배분 상세, VOC1102 업무요청 등록, VRE1102 처리, INF4005 등)의 필드 단위 스텝.
- E2E(접수→배분→처리)는 계정이 바뀌므로 단일 시나리오로 표현 불가 → 페르소나 파일을 순서대로 실행하고 데이터 연결은 TEST_ 제목으로 수동 확인.