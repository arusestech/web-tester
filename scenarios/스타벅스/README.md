# 스타벅스 VOC — 시나리오 프로젝트

대상: 스타벅스 VOC (Java 21 / Spring 6 / MyBatis / MySQL, UBONE 프레임워크).
접속: `http://dev-ivoc.istarbucks.co.kr:8080/voc` (로컬 Tomcat 11, hosts 에 127.0.0.1 매핑. CrossEditor 라이선스 때문에 localhost 금지).
계정: `test01`(100) 및 `TEST_R110~R999`(롤별 23개, 비번은 `--secret password=…`). 금지 행위·목업 원칙은 프로젝트 `CLAUDE.md`.

## 폴더
| 폴더 | 내용 | 실행 |
|---|---|---|
| `01_메뉴회귀/` | `starbucks-voc.json` — 메뉴 63화면 조회 회귀(test01). baseUrl 8888(IntelliJ Tomcat) 기준이므로 8080 이면 수정 | `run.bat scenarios\스타벅스\01_메뉴회귀 --mode menus --headless` |
| `02_권한/` | `auth-P01~P24` 롤별 메뉴 노출·접근·버튼 TC(894항목). 판정은 DB `AP_SCREEN_AUTH` 기준 | `02_권한\run-personas-all.bat 비번` (로그 `logs\run_personas_*.log`) |
| `03_E2E/` | E2E-01~10, 33파일. 계정이 바뀌는 단계마다 파일 1개, 앞 단계가 남긴 `TEST_` 데이터를 뒤 단계가 사용 | `03_E2E\run-e2e.bat` (순서 실행, 실패 시 중단) |
| `_mock/` | E2E 사전 목업 SQL·원복 SQL (목록/일괄 제외) | pymysql 로 실행, `_mock/README.md` |

## E2E 구성 (03_E2E)
| E2E | 파일 | 계정 순서 | 사전 목업 | 비고 |
|---|---|---|---|---|
| 01 VOC 접수→배분→처리→삭제 | E2E01-1~4 | 240→250→220→test01 | 없음 | 8/25 통과 |
| 02 스토어케어 접수→매장처리→통계 | E2E02-1~5 | 230→560→550→520→750 | `e2e02_*` | 8/27 통과. 750 통계는 DB 권한상 허용이 정상 |
| 03 매장 VOC NOTE | E2E03-1~2 | 530→250 | 없음 | 8/25 통과 |
| 04 CE 관리→조회→마감 노출 | E2E04-1~4 | 220→530→520→800 | `e2e04_*` | 엑셀은 로컬 upload.path 불일치로 제외 |
| 05 컨텐츠 등록→열람 | E2E05-1~3 | 220→999→test01 | 없음 | 8/25 통과 |
| 06 VOC 설정 210 특수규칙 | E2E06-1~3 | 220→210→250 | 없음 | **E2E06-2 "서버 강제"는 결함(210 서버 미강제) 수정 전까지 ❌ 가 정상** |
| 07 시스템관리 경계 | E2E07-1~4 | test01→110→130→220 | 없음 | 130 SYS0027 로그인갱신은 TEST_R999 대상 |
| 08 결재 노출 | E2E08-1~2 | test01→110 | 없음 | 기안/승인 클릭 없음 |
| 09 발송(목업) | E2E09-1~2 | 220→250 | SMTP 목업(config.xml) | 문자발송은 개발 DB 관리자번호 코드 STATUS=S 라 "오류" alert 가 현재 정상 응답 |
| 10 칭찬파트너 기능권한 | E2E10-1~4 | test01→110→320→210 | 없음 | AP_FUNCTION_AUTH 검증 |

실행 결과 보고서(사내 분석 폴더): `e2e_auth_report_20260825.md`(01/03/05·페르소나), `e2e_remaining_report_20260827.md`(02/04/06~10 + 결함 원인).

## 작성 규약 (이 프로젝트)
- 조회 버튼은 화면마다 id 가 달라 eval 로 `#search a, #searchBtn a, #btnSearch a, span.button.search a` 후보 클릭
- 버튼 노출 검증은 `getElementById(id).offsetParent` 기준(hide 된 것은 숨김), 서버 권한 검증은 `fetch(uxl.getFunctionUrl(화면,alias))` 응답의 `resultStatus` / "권한이 없습니다" 문구
- 그리드 행은 `table.ui-jqgrid-btable tr.jqgrow` 텍스트 포함 여부로 찾고, 행 버튼은 `a[href*="fn명"]`
- confirm/alert 는 러너가 자동 수락 → `expectDialog` 로 문구만 검증
- 저장/삭제는 `TEST_` 접두 데이터만, `allowForbidden` 에 사용한 동작을 명시
