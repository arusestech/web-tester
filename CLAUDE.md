# WIGO Web Tester — Claude 작업 안내

이 폴더는 **Java/JSP 웹 프로젝트 메뉴 자동 테스트 도구**다. 사용자가 "시나리오 만들어줘", "메뉴 테스트 해줘", "보고서 봐줘"라고 하면 아래 절차로 진행한다.
런타임에 AI는 쓰이지 않는다 — 네 역할은 **시나리오 JSON 작성·검증·보고서 해석**이다. 자세한 형식은 `docs/시나리오-작성-가이드.md`, 실제 예제는 `scenarios/example.json` (형식) 참고.
외부 연동 목업(서버 stub)을 만들라는 요청이면 **`docs/stub-분석-가이드.md`** 를 따른다(소스에서 외부 호출을 찾아 stubServer 라우트로 만드는 절차).

**먼저 `docs/HANDOVER.md` 를 읽을 것** — 구조, 변경 이력, 주의점(GUI 에서 네이티브 prompt/confirm 금지 등). 도구 자체를 고쳤으면 그 문서의 변경 이력에 추가한다.

## 실행 방법
- GUI: `WigoWebTester.bat` / `./wigo-web-tester.sh`
- 터미널: `run.bat scenarios\<프로젝트>\<이름>.json --mode menus --headless --screenshot fail` (옵션은 `node cli.js --help`)
- 일괄: `run.bat scenarios\<프로젝트>` 또는 `scenarios\<프로젝트>\<폴더>` — 아래 .json 전부 순서대로, 합산 증적 `reports/<폴더명>-일괄-<시각>/`
- 녹화: `run.bat record scenarios\<프로젝트>\x.json --url /경로 --name "흐름명" --append` — 브라우저 조작을 crud 스텝으로 기록 (GUI 편집 탭 ⏺ 버튼과 동일)
- 소스 스캔: `run.bat scan-source <소스폴더> [--out <시나리오>|--append <시나리오>] [--url] [--user] [--pattern "/screen/{}.ub"]` — 소스만 읽어 초안 생성 (GUI 편집 탭 📂 소스에서 만들기)
- 시나리오 배치: `scenarios/<프로젝트>/<폴더>/<이름>.json`. 프로젝트 = `scenarios/` 바로 아래 폴더(GUI 상단에서 선택). 기본 프로젝트 `기본/` 은 항상 존재하며 최상위 .json 은 시작 시 자동으로 `기본/` 으로 이동됨 → 새 시나리오는 반드시 프로젝트 폴더 아래에 만든다. `_` 로 시작하는 폴더/파일은 목록·일괄에서 제외
- 비밀번호는 JSON 에 넣지 말고 `{{password}}` → 실행 시 `--secret password=값` 또는 GUI 팝업
- 결과: `reports/<프로젝트>/<폴더>/<시나리오>-<시각>/report.html|md|json` (시나리오와 같은 폴더 구조. report.json 의 `file` = 시나리오 상대경로)
- 두 번째 실행부터: 보고서 맨 위에 **직전 실행 비교**(신규 실패/해결/그대로)가 자동으로 붙는다. 실패한 것만 다시 돌리려면 `--rerun-failed`
- 권한 페르소나처럼 계정만 다른 시나리오는 `_공통.json` + `"extends": "_공통.json"` 으로 묶는다 (가이드 §2-0). 일괄 실행하면 역할별 매트릭스가 합산 보고서에 붙는다
- 순회 속도 등 **전체 기본값**은 루트 `config.json`(GUI 헤더 ⚙ 설정). 시나리오에 같은 값이 있으면 그 값이 우선. 보안 엄격한 곳은 `"speed": "느림"` 이상 권장. 자체 검증은 `--no-config`

## 시나리오 작성 절차 (새 프로젝트)
사용자에게 **프로젝트 소스 경로와 접속 URL, 테스트 계정 ID** 를 먼저 묻는다.

**0. 먼저 `run.bat scan-source <소스폴더> --out scenarios\<프로젝트>\<이름>.json` 을 돌린다** (`src/source-scan.js`).
아래 1~8 을 정적 분석으로 자동 수행해 초안 + 근거 보고서(`reports/_소스분석/…/source-scan.html`)를 만든다.
네 일은 **초안을 검토·보완하는 것**이 된다: 확신도 낮은 이름 다듬기, 아닌 화면 빼기, expect 확인, 상세·조회조건 값 채우기.
스캔이 못 보는 것(권한별 메뉴, JS 로 그리는 메뉴, DB 에만 있는 URL)은 `discover` 로 보완한다.
스캔 결과가 이상하면 규칙을 고치기 전에 **왜 그렇게 나왔는지 보고서의 근거(파일:줄)를 먼저 본다**.

수동으로 채울 때(또는 초안 검토 시) 보는 곳은 아래와 같다. 추측 대신 파일:라인 근거를 남긴다.

1. **baseUrl**: `server.xml` 포트 + 컨텍스트(`webapps/` 폴더명, war 이름, `application.properties` 의 `server.servlet.context-path`)
2. **login**: 로그인 JSP 의 아이디/비번 input `id`/`name`, 로그인 버튼(`button` 이 아니라 `div`/`a`/`img` 인 경우 많음), 로그인 후 이동 경로. `success` 는 `urlNotContains: login` 또는 메인 화면 고유 요소
3. **forbidden**: JSP 전체에서 `삭제|발송|전송|결제|승인|반려|마감|상신|저장|Delete|Save|Send` 버튼 텍스트/title 검색 → 배열. 조회 전용이면 `저장` 까지 넣는다
4. **menus**: 우선순위 — 메뉴 테이블 덤프/메뉴 관리 화면 > 메뉴 XML 매퍼 쿼리 > 사이드바·탑메뉴 JSP > 컨트롤러 `@RequestMapping` > `web.xml`. 소스를 못 보면 `run.bat discover <시나리오> --url /main --depth 2` 로 화면에서 링크를 긁어 초안을 만든 뒤 다듬는다(목록 데이터 행·팝업·위험 화면 제거). 화면ID→URL 규칙이 있으면 일괄 생성. `대메뉴 > 소메뉴` 이름, 위험 화면은 `(조회만)`. 새 창 팝업·발송·소스 없는 화면은 빼고 `_comment_menus` 에 이유
5. **expect**: 목록 화면의 그리드 공통 클래스(jqGrid `table.ui-jqgrid-btable` 등), 폼 화면의 폼/저장 버튼
6. **inputs (조회 조건)**: 검색 폼 input/select 의 `id`/`name` 을 화면별로 모아 **여러 화면에 반복되는 것**을 `inputs.common` 에, 설명을 `inputs.labels` 에. 날짜 형식(yyyy-MM-dd 등)과 readonly(팝업 선택) 필드 여부 확인 — readonly 는 넣지 않는다. 기간 제한(31일/3개월)이 있으면 그에 맞춘다. 조회 버튼 id 가 화면마다 다르면 `search` 에 후보를 쉼표로 나열. `a[title=Search]` 같은 넓은 셀렉터는 다른 버튼과 겹치니 피한다
6-1. **actions (버튼 동작 검사)**: 화면의 버튼 중 **데이터를 바꾸지 않는 것**(조회·검색·초기화·조회팝업 열기)만 `menus[].actions` 에 넣는다 — 누르면 JS 에러·5xx·에러 알림·**무반응(죽은 버튼)** 을 잡는다. 등록·저장·삭제·발송은 넣지 않는다(그건 `crud` + ⏺ 녹화). 소스 스캔은 `--actions` 로 이걸 자동 생성한다
7. **detail (목록→상세)**: 그리드 옵션 `ondblClickRow` / `onSelectRow` / 셀 링크 formatter 를 보고 `selector`(`#list tr.jqgrow` 등) + `dblclick` / `popup` 결정. **행 클릭이 DB 를 바꾸는 화면(권한 토글, 상태 전이, 인라인 편집)은 detail 을 넣지 않고** `_comment_detail` 에 이유를 적는다
8. **ignore**: 먼저 한 번 돌린 뒤 모든 화면에 반복되는 환경 노이즈(CDN 차단 CSP, 컨텍스트 빠진 404, 라이선스 alert)만 넣고 `_comment_ignore` 에 근거
9. **screenshot / mask**: 개인정보가 보이는 화면은 화면을 통째로 빼는 `"screenshot": false` 보다 `"mask": ["#custNm", "td.phone"]` 로 그 요소만 가리는 쪽이 낫다(증적 가치 유지)
9-1. **느린 화면**: 조회가 오래 걸리는 화면은 메뉴에 `"timeout"`·`"expectTimeout"`·`"loading"`(로딩 표시)·`"waitFor"` 를 준다. `핵심 요소 없음: X (5초 대기)` 메시지의 초를 보고 판단
9-2. **역할이 바뀌는 업무 흐름**(상신→승인→회신)은 시나리오를 쪼개지 말고 `{ "action": "switchUser", "user": "..." }` 로 한 흐름에서 처리
9-3. 저장·실행 전에 `run.bat lint <시나리오>` 로 검사한다 (메뉴 이름 중복은 비교·재실행을 망가뜨리므로 반드시 확인)
10. 저장 후 `run.bat scenarios\<이름>.json --mode menus --headless --only <메뉴 하나>` 로 로그인부터 확인 → 전체 실행 → 보고서의 ❌/⚠️ 를 **서버 버그 / 시나리오 오류(셀렉터·expect 틀림) / 환경 노이즈** 로 분류해 보고

## 보고서 해석 요청 시
`reports/<최신>/report.json` 을 읽고 `status !== 'ok'` 항목을 위 3분류로 나눠 표로 정리. 스크린샷 경로와 의심 소스 위치(파일:라인)를 함께. **소스 수정은 요청 없이는 하지 않는다.**
`report.json` 에 `compare` 가 있으면 **신규 실패(newFail)를 먼저** 보고한다 — 이번 배포로 깨진 것이라 우선순위가 높다. `stillFail` 은 기존 결함으로 묶어 간단히.
각 항목의 `triage.type`(서버 버그 / 시나리오 오류 의심 / 환경 노이즈 의심 …)은 규칙 기반 **1차 분류일 뿐**이므로 그대로 옮기지 말고 스크린샷·소스로 확인한 뒤 확정한다. `defects.csv` 는 이미 만들어져 있으니 표를 다시 만들지 말고 그 파일을 안내한다.

## 하지 말 것
- `forbidden` 에 있는 동작을 허용(`allowForbidden`)하는 CRUD 흐름을 사용자 확인 없이 만들지 않는다
- 시나리오 JSON 에 평문 비밀번호를 쓰지 않는다
- 프로그램 본체(`src/`, `ui/`)를 프로젝트별로 고치지 않는다 — 문제가 있으면 시나리오로 해결하고, 안 되면 보고
