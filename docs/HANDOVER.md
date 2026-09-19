# WIGO Web Tester — 인수인계 / 변경 이력 (Claude 용)

다른 세션의 Claude 가 이 프로젝트를 이어받을 때 먼저 읽는 문서. 사용자 대상 설명은 `README.md`, 시나리오 작성법은 `docs/시나리오-작성-가이드.md`, 작업 규칙은 `CLAUDE.md`.
git 저장소가 아니므로 변경 이력은 이 문서가 유일하다. **기능을 바꾸면 아래 "변경 이력"에 날짜와 함께 추가할 것.**

## 1. 무엇인가
Java/JSP 등 웹 프로젝트의 메뉴 조회·CRUD 자동 테스트 + 증적(스크린샷/보고서) 도구. **런타임에 AI 없음** — JSON 시나리오 → Playwright 실행 → `reports/` 증적. 폐쇄망 반입용으로 Node 런타임까지 zip 으로 묶는다(`tools/bundle.mjs`). Claude 의 역할은 시나리오 작성·보고서 해석·도구 개선.

## 2. 구조 (파일 지도)
```
cli.js                 진입점. gui(기본) / run <json|폴더> / record <json> / stub <json> / cli / new / init
src/server.js          GUI 서버(HTTP+SSE, 127.0.0.1 임의 포트). Chrome/Edge --app 창으로 ui/index.html 을 연다
src/runner.js          시나리오 1개 실행: 로그인(재시도) → 메뉴 순회(inputs/detail) → crawl → crud. runSteps = 스텝 실행기
src/checks.js          화면 검사: HTTP 상태, 에러 페이지, 콘솔/JS 에러, 리소스 실패, 빈 화면, expect, onScreen(실제 가시성)
src/report.js          report.html/md/json 생성 (json 에 file = 시나리오 상대경로)
src/batch.js           폴더/프로젝트 단위 일괄 실행 → 합산 보고서 + 시나리오별 하위 폴더
src/scenario.js        시나리오 파일 읽기 + extends(공통 설정 상속) 해석. readJsonFile/resolveScenario/loadScenario
src/compare.js         직전 증적 찾기·비교(신규 실패/해결/그대로/느려짐) + 실패 항목 추출(재실행 대상)
src/triage.js          증상 문구 → 분류(서버 버그 / 시나리오 오류 의심 / 환경 노이즈 …). 규칙 배열 하나가 전부
src/discover.js        🔍 메뉴 자동 수집: 로그인 → 링크 수집(href + onclick 경로 + 속성) → menus[] 초안
src/source-scan.js     📂 소스에서 만들기: 소스 트리 정적 분석(브라우저·서버 없음) → baseUrl·login·menus·forbidden·expect·조회조건 초안 + 근거 보고서. scanSource/toScenario/renderSourceReport/writeSourceReport
src/lint.js            시나리오 사전 검사(이름 중복·필수값·모르는 action…). CLI lint / GUI ✓ 검사 / 저장 전 확인
src/recorder.js        ⏺ 녹화: 브라우저 조작 → 스텝 JSON (init script + exposeBinding, 상단 툴바)
src/scan.js            [화면에서 필드 가져오기]: 로그인 후 화면의 input/select 목록 (runLoginSteps 를 recorder 도 사용)
src/secrets.js         {{password}} 자리표시자 수집(vars·동적 토큰은 제외) / 환경변수 WWT_*
src/vars.js            테스트 데이터 변수 + 동적 토큰(today/now/rand/seq/uuid…). makeDynamic()/RESERVED
src/stub-server.js     서버 stub(백엔드가 부르는 외부 연동 목업). Node 내장 http 만. startStub(config,{log,vars})
src/config.js          전역 설정(config.json) 로드/저장 + withDefaults(순회 속도 등 기본값을 시나리오에 채움. 시나리오가 우선)
scenario.js 프로젝트 공통  _project.json(scenarios/<프로젝트>/): PROJECT_KEYS = baseUrl·browser·login·stubServer·reuseSession 를 프로젝트 단위로. readProjectConfig/applyProjectDefaults/resolveForRun. 시나리오가 우선
src/wizard.js          터미널 대화형 시나리오 작성 (GUI 못 쓰는 서버용)
ui/index.html          GUI 전체 (단일 파일, 인라인 JS). 자체 다이얼로그 ui.ask/confirm/menu 필수 (아래 주의)
scenarios/<프로젝트>/<폴더>/*.json   시나리오. 프로젝트 = scenarios/ 바로 아래 폴더. 기본 프로젝트 "기본" 자동 생성
reports/<프로젝트>/<폴더>/<이름>-<시각>/   증적 (시나리오와 같은 경로 구조). 일괄은 <라벨>-일괄-<시각>/
config.json            전역 설정(순회 속도 speed / retries / stepDelay …). GUI 헤더 ⚙ 설정 또는 파일 직접. 시나리오가 이 값을 이긴다
test/mock-server.js    자체 검증용 가짜 사이트 (:3999). test/mock.json 이 그 시나리오
tools/bundle.mjs       반입 zip 생성 (--no-scenarios --browser --no-runtime --all)
docs/                  가이드, 이 문서. stub 만들 때: docs/stub-분석-가이드.md (소스에서 외부 연동 찾아 stubServer 로)
```
시나리오 JSON 스키마는 가이드 문서 참고. 핵심 키: `extends baseUrl login menus(+actions/detail/inputs) crud mocks stubServer forbidden blocked inputs vars ignore errorStatus errorPatterns evidence browser timeout stepDelay emptyWait reuseSession`. `_` 로 시작하는 키/폴더/파일은 무시(메모용).

## 3. 검증 방법
```
npm run mock            # 가짜 사이트 :3999 (별도 터미널)
npm test                # test/mock.json 실행. 기대치: 정상 7 / 실패 5 / 주의 1 (실패는 의도된 에러 메뉴들) → 종료코드 2 가 정상
npm run test:batch      # test/extends/ (상속 + 일괄 + 매트릭스). 기대치: 전체 8 / 정상 6 / 실패 2, 매트릭스 5행×2열
npm run test:checks     # test/checks.json (재시도·느린화면·깨진화면·다시그리는화면·분류·CSV). 기대치: 전체 7 / 정상 3 / 실패 1 / 주의 3,
                        #   분류 = 불안정(flaky) 1 / 느림 1 / 화면 깨짐 의심 1 / 서버 버그 1
                        #   ※ /flaky 는 첫 요청만 500 이라 mock 서버를 새로 띄우거나 /flaky?reset=1 을 부른 뒤 실행
npm run test:switch     # test/switch.json (계정 전환 + 마스킹). 기대치: 전체 3 / 정상 3
npm run test:slow       # test/slow.json (7초 뒤 그려지는 그리드). 기대치: 정상 1 / 실패 1(기본 대기) / 주의 1(느림)
npm run test:actions    # test/actions.json (🖱 버튼 동작 검사). 기대치: 전체 8 / 정상 4 / 실패 3(JS에러·에러알림·금지버튼) / 주의 1(죽은 버튼)
npm run lint:test       # 검사 동작 확인 (mock.json 은 주의 4건이 정상)
npm run test:source     # 📂 소스 스캔 (test/source-fixture 정적 분석). 기대치: 38 ok / 0 fail. 브라우저·서버 불필요
node test/gui-check.mjs # GUI 자동 검증 (임시 프로젝트 "자동검증" 생성 → 검사 → 삭제). 기대치: 60 ok / 0 fail
                        #   서버는 WWT_TOKEN=test-token + WWT_NO_CONFIG=1 로 뜬다(토큰 검사·전역설정 무시). config.json 은 건드리지 않음
node cli.js discover test/mock.json --url /main --depth 2 --pages 5   # 메뉴 수집 (후보 6개 / 새 것 2개)
node cli.js gui --no-open --port 8766    # GUI 를 Playwright 로 자동 검증할 때 (헤드리스 녹화는 WWT_REC_HEADLESS=1)
```
GUI 검증은 `test/gui-check.mjs` 가 한다(서버 spawn → `chromium.launch` → 임시 프로젝트로 트리/편집/실행/증적 확인 후 정리).
**브라우저 `dialog` 핸들러를 달지 말 것** — 앱 창과 같은 조건(네이티브 dialog 자동 닫힘)에서 검증해야 실제 버그를 잡는다. 녹화 흐름은 아직 이 스크립트에 없다(헤드리스 녹화는 `WWT_REC_HEADLESS=1`).

## 4. 반드시 알아야 할 주의점
- **GUI 에서 `prompt()/confirm()/alert()` 금지.** 앱 창은 Playwright `launchPersistentContext` 라 네이티브 dialog 가 자동으로 닫혀 버튼이 죽는다. `ui.ask / ui.confirm / ui.menu` (index.html 상단) 를 쓴다. 2026-08-27 실제로 이 버그로 ⋯ 메뉴·새 프로젝트·삭제가 전부 먹통이었음.
- 소스 파일에 BOM 문자(U+FEFF) 를 직접 쓰지 말고 `\uFEFF` 이스케이프로. (Claude 출력이 리터럴 BOM 을 넣는 경우가 있었음 → Node 스크립트로 치환해서 고침)
- `??` 와 `||` 를 괄호 없이 섞으면 문법 오류 → 페이지 스크립트 전체가 죽는다 (한 번 겪음).
- runner 의 `press` 는 대상 없으면 `keyboard.press`. `dblclick` 액션 있음. CRUD 실패 시 `error.trail` 로 어디까지 갔는지 보고서 `path` 에 남김.
- `scenarios/` 최상위 .json 은 서버 시작(listScenarios) 때 자동으로 `기본/` 으로 이동됨 (example.json 제외). 사용자 파일을 옮기는 동작이므로 바꿀 때 주의.
- 비밀번호는 JSON 에 넣지 않는다 (`{{password}}`). 일괄 실행은 같은 자리표시자 이름이면 한 번만 묻고 전체 적용. **`_comment` 안이나 `.bat` 실행줄도 예외가 아니다** — 2026-09-01 에 66곳이 발견됐다.
- **반입 zip 을 만들기 전에는 위생 점검을 한다** (`tools/bundle.mjs` 기본값이 시나리오를 포함하므로). ① 평문 비밀번호 ② 사용자 PC 절대경로(근거 문서·소스 루트·로그 경로) ③ DB 호스트·포트·계정 — 이 셋을 `scenarios/ docs/ ui/ README.md CLAUDE.md` 에서 지운다. 계정 ID·대상 URL 은 남긴다(없으면 시나리오가 안 돈다). 만든 뒤에는 **zip 엔트리를 직접 읽어** 다시 확인한다. 구체 문자열은 여기 나열하지 않는다 — 이 문서도 zip 에 들어간다.
- `forbidden` 에 걸리는 버튼은 재생 시 차단. `allowForbidden` 을 사용자 확인 없이 넣지 않는다.
- 프로그램 본체를 특정 프로젝트(스타벅스/우리은행) 전용으로 고치지 않는다. 시나리오 JSON 으로 해결.
- 시나리오를 읽는 곳은 반드시 `scenario.js` 를 거친다(extends 해석). 단, **파일에 다시 쓸 때는 원본**을 쓴다
  (`cli.js record` 처럼 — 해석된 값을 저장하면 상속이 통째로 복사돼 버린다).
- 소스에 제어문자(BOM U+FEFF, NUL)를 직접 넣지 말 것 — 반드시 `\uFEFF` 같은 이스케이프로. (이번에도 두 번 겪음)
- **`.bat`(WigoWebTester.bat/run.bat) 주석·문자열은 ASCII 로만 쓴다.** `chcp 65001` 이 있어도 `rem` 줄에 한글·em대시(—)를 넣으면 cmd 가 주석을 명령으로 오파싱해 실행이 통째로 깨진다(2026-08-29 실제로 겪음: `'체인을' is not recognized`). 설명은 영어로.

## 5. 변경 이력
### 2026-09-19 — 개인 git 레포로 이전
코드(`src/`·`ui/`) 변경 없음. 작업 위치가 옛 공용 폴더에서 개인 레포 `arusestech/web-tester`(main)로 바뀌었다(형제 레포 `scbk_voc`·`starbucks_voc`·`wrb_voc` 와 같은 방식).
- 커밋 대상 = 소스·문서·시나리오. **로컬 전용(gitignore)** = `node_modules/`·`runtime/`·`reports/`·`dist/`·`logs/`·`.sessions/`(로그인 쿠키)·`CLAUDE.local.md`. 옛 `scenarios/*.json` 제외 규칙은 시나리오가 프로젝트 폴더로 옮겨진 뒤 아무것도 거르지 못하고 있어 삭제.
- `.gitattributes` 로 `*.sh` 는 체크아웃해도 LF — Windows 체크아웃(autocrlf)에서 만든 리눅스/맥 번들의 셸 런처가 CRLF 로 깨지는 것 방지.
- 옛 최상위 폴더의 MCP 설정 기록·프로젝트 CLAUDE.md 템플릿은 `setup/` 으로(번들 포함 목록 밖).
- 커밋 전에도 §4 의 반입 위생 점검을 돌린다(첫 커밋 때 0건).

### 2026-09-17 — 데이터: SCBK(SC제일은행 VOC) 프로젝트 신설 + SIT 온라인 시나리오 24개
코드(`src/`·`ui/`) 변경 없음.
- `scenarios/SCBK/_project.json`(baseUrl localhost:9090, 로그인 `#userid/#userpw/#login`, success `POR0001`+`#menu`, `login.retries:1`(계정 잠금 방지), `reuseSession:false`) + `01_SIT_온라인/_공통.json` + `SIT-VOC-xxxx-yy.json` 24개(SIT v0.5 케이스 1:1, 흐름 115) + `README.md`.
- **생성기로 만든 파일이다**: `D:/ai/scbk/SIT/_gen/gen_tester_scenarios.py [회차마커]`. 직접 고치지 말고 생성기를 고쳐 재생성.
- 역할 전환은 흐름마다 `switchUser` 로 시작(실패건만 재실행해도 계정이 맞도록). 테스트 VOC 는 제목 마커로 찾는다 — **eval·selector 에는 `{{변수}}` 치환이 없어서** 마커를 생성 시점에 문자열로 박았다.
- **함정**: 시나리오 파일에 `login` 을 두면 프로젝트 `login` 을 그룹째 대체한다 → 계정만 바꾸려 해도 url·success 까지 전부 넣어야 lint 오류("로그인 URL 이 없습니다")가 안 난다.
- 폐기·마스터 전달·반송은 forbidden + `expectFail: "금지 버튼 클릭 차단"`(버튼 노출까지만 검증). allowForbidden 은 사용자 승인 전이라 넣지 않았다.
- 아직 실제 실행 안 됨. 첫 실행 때 README "잠정값" 목록(POP0001 부서 선택, DCC 처리자 콤보 값, 업무협조 처리자 옵션, VOC0004 권한)을 확인할 것.
- **같은 날 폐쇄망 기준으로 재작성**: 생성기가 폐쇄망에 없으므로 회차 마커·계정 ID·처리부서·기한일을 `_공통.json` `vars` 로 뺐다(GUI 에서 수정). baseUrl 은 접속 불가 자리표시 주소(🔧 에서 교체), 브라우저 채널 미지정(Chrome→Edge 자동), 목업 제거, 고객 생년월일·휴대폰은 실행 시 입력.
  - **eval/selector/select 값에는 `{{}}` 치환이 없다** → 시나리오 데이터만으로 우회: eval 로 `#__wwt_var` 입력칸을 만들고 `fill`(치환됨)로 값을 넣은 뒤 다음 eval 이 읽고 지우는 "브리지". mock 페이지(임시 시나리오, 검증 후 삭제)로 검색→행 선택→콤보 선택→dialog 확인까지 통과 확인. 도구 본체에 eval 치환을 넣으면 이 우회는 필요 없어진다(후보 개선).
  - `findPlaceholders` 는 `_comment` 안의 `{{x}}` 도 실행 시 입력 항목으로 잡는다 → 코멘트에 중괄호 자리표시자를 쓰지 말 것.
  - 등록 VOC(VOC0003)는 T1~T4(등록 전 단계)만 표시 — RE 이후 건을 거기서 찾던 흐름을 VOC0005/임시저장 건으로 교체.

### 2026-09-04 — 반입 차단 → `--no-runtime` 번들로 전환
코드 변경 없음. 9/1 zip(node.exe 동봉, 37MB)이 사내 반입 심사에서 막혔다. zip 안의 **실행파일(node.exe)** 이 원인으로 판단 — Node 자체는 사내에 프로그램으로 정식 설치한다. zip 엔트리 위생 재검사(평문 비번·로컬 경로·DB 정보)는 이상 없었다.
- `node tools/bundle.mjs --no-runtime` → `dist/wigo-web-tester-win-noruntime-20260904.zip` (4.3MB, 300항목, exe 0). **앞으로 반입 zip 은 이 옵션으로 만든다.** 대상 PC 에 **Node 20+** 필요(`bin/env.bat` 이 `where node` 로 찾음). 같은 날 확인: `package.json` engines 가 `>=18` 이었지만 동봉 Playwright 1.62.1 의 engines 는 `>=20` → `>=20` 으로 정정, README/env.bat/env.sh/bundle 문구도 20 으로. `cli.js` 맨 위에 **Node<20 이면 오류 메시지 + exit 3** 가드 추가(폐쇄망에서 원인 모를 import 오류 방지). 동봉 런타임은 24.19.0.
- **미사용 스크립트 제거 확대** (`bundle.mjs` 스테이징 단계, 사용자 요청): `node_modules/.bin/` 통째(playwright.cmd 등 npm shim), `node_modules` 안 `.cmd/.bat` 추가, `scenarios/**` 의 `.bat/.cmd/.sh/.ps1`(권한·E2E 일괄 bat — 폴더 일괄 실행으로 대체), Windows 단독 번들에서 `.sh` 런처 3개(반대로 리눅스/맥 번들에선 `.bat` 제거). `--all` 이면 런처는 모두 남긴다. 결과 291항목, 스크립트는 **`WigoWebTester.bat`·`run.bat`·`bin/env.bat` 3개만** 남음.
- **`--no-scripts` 옵션 신설** (사용자 요청, bat 까지 빼기): `WigoWebTester.bat`·`run.bat`·`bin/`·`.sh` 런처 전부 제외 → zip 에 exe·bat·cmd·sh·ps1 이 0개. 파일명 `…-noruntime-noscripts-<날짜>.zip`. **반입 zip 표준 = `node tools/bundle.mjs --no-runtime --no-scripts`.**
- **bat 없이 실행하는 법**은 README "반입 후 실행 (스크립트 파일 없이)" 절에 정리: `node -v` 확인 → 압축 해제 → 폴더에서 `node cli.js`(인자 없으면 GUI, `cli.js:348`) 또는 `npm start` → 터미널은 `run.bat …` 대신 `node cli.js …`. `bin/env.bat` 의 역할은 node 찾기 + `node_modules/playwright` 존재 확인뿐이라 PATH 에 node 가 있으면 필요 없다. 바로가기·bat 은 반입 후 사내 PC 에서 만든다. `.js` 더블클릭은 WSH 로 열리므로 금지 문구 포함.
- **단, 사용자는 사내에 Node 를 설치하지 않고 zip 그대로 실행할 계획**(같은 날 확인) → node.exe 가 zip 에 있어야 한다. 그래서 `node tools/bundle.mjs --no-scripts`(런타임 포함, 스크립트 0개, 37MB) 도 만들었다: `dist/wigo-web-tester-win-noscripts-20260904.zip`. 이 번들의 실행은 `runtime\win\node.exe cli.js` (README 에 추가). **위 "표준" 은 확정이 아니다** — exe 가 차단 사유면 노런타임 zip + Node 별도 반입, 스크립트가 사유면 이 zip. 차단 사유 확인 후 결정.
- 여전히 들어 있는 것: `scenarios/스타벅스/_mock/*.sql` 6, 우리은행 시나리오 22 엔트리. SQL 확장자까지 막히면 제외 옵션을 추가할 것.

### 2026-09-01 — 스타벅스 dev 실행 준비 + 반입 zip 에 시나리오 포함(위생 정리)
코드(`src/`·`ui/`) 변경 없음. 데이터(시나리오)와 번들 범위만 바뀌었다. 사용자는 **사내망 PC 에서 dev-ivoc 대상**으로 돌린다.
- **스타벅스 환경 정리 4건** — 돌리기 전 점검하다 나온 것들:
  - `scenarios/스타벅스/_project.json` 의 `stubServer.enabled` **true → false**. 대상이 원격 dev 서버라 **원격 앱이 테스터 PC 의 localhost:9900 을 부를 수 없다** — 켜 봐야 무의미하다. 스타벅스 앱을 로컬에 띄워 붙일 때만 true(로컬=ON / 개발·운영=OFF 원칙 그대로).
  - `01_메뉴회귀/starbucks-voc.json` 이 **자기 파일에 `baseUrl` 을 갖고 있었다** → 제거(상속). own > 프로젝트 순서라, 두면 🔧 프로젝트 설정을 바꿔도 이 시나리오만 안 따라온다. 2026-08-29(24)·08-31(4) 와 같은 함정이 데이터 쪽에서 반복된 것.
  - `02_권한/_공통.json`·`03_프로세스/_공통.json` 의 fallback `baseUrl` 이 죽은 `:8080/voc` 였다 → 현재 dev 포트로 정정. (프로젝트 값이 이기므로 동작에는 영향 없었지만, 로컬 주소로 바꿀 때 헷갈리는 지점)
  - `02_권한/run-personas-all.bat`·`03_프로세스/run-e2e.bat` 의 대상 폴더가 존재하지 않는 이름(`02_권한페르소나`/`03_E2E`)이라 **파일을 하나도 못 찾던 상태** → 실제 폴더명으로 정정. 페르소나 배치 로그도 사용자 PC 절대경로 → 도구 폴더의 `logs/`.
  - 확인 방법: `node cli.js lint scenarios\스타벅스`(63개 오류 0) + `loadScenario()` 로 **resolve 된 baseUrl·stub 을 직접 찍어 본다**. 파일만 읽으면 상속 결과를 못 본다.
- **반입 zip 에 시나리오를 포함하기로 (사용자 결정)** — 예전 zip 은 `--no-scenarios` 였다. `node tools/bundle.mjs` 기본값으로 만들면 301항목/시나리오 99개, 37MB.
- **그래서 반입 전 위생 정리를 했다** (시나리오는 사용자 PC 기준으로 쓰여 있어 그대로 넣으면 사내 정보가 같이 나간다):
  - **평문 비밀번호 66곳 제거** — `_comment`·`_comment_baseUrl`·README 뿐 아니라 **`.bat` 의 `--secret password=…` 실행줄**과 **`docs/시나리오-작성-가이드.md` 의 로그인 예제**까지 비번이 박혀 있었다. `.bat` 은 `set PW=%~1` + 없으면 `set /p` 로 물어보게 바꿨다(비번 없으면 `exit /b 1`). 가이드 예제는 `{{password}}` 로.
  - **로컬 절대경로 제거** — 근거 엑셀·분석 폴더·소스 루트·테스트데이터 SQL 경로를 파일명만 남기고 지웠다(스타벅스 24개 + 우리은행 5곳).
  - **DB 접속정보 제거** — `_mock/README.md` 의 호스트·포트·계정을 `CLAUDE.local.md` 참조로.
  - **남긴 것**: 계정 ID 와 사내 URL(없으면 시나리오가 안 돈다), `D:\source\myproject` 같은 사용법 자리표시자.
  - 검증: zip 을 풀지 말고 `System.IO.Compression.ZipFile` 로 엔트리를 읽어 훑는다(node_modules 제외). JSON 84개 전수 파싱 + lint 도 같이.

### 2026-08-31 (5) — 데이터: 우리은행VOC 프로젝트 설정 신설 + 두 프로젝트 소스스캔 초안
- **`scenarios/우리은행VOC/_project.json` 신설** (코드 아님, 데이터): `baseUrl(localhost:18081)` · `browser(chrome 1600x950)` · `login(#loginId/#loginPwd/a[data-click=signIn], b00756, detect:#loginId, after:/)`. 그 프로젝트의 환경값 **정본**이다.
  - `_공통.json` 에서는 baseUrl·browser·login 을 **뺐다**(프로젝트 값이 extends 를 이기므로 두면 헷갈린다) + `_comment_env` 로 "여기 다시 넣지 말 것" 명시. 스타벅스에서 했던 것과 같은 정리.
  - 안전 확인: 바꾸기 전/후로 **시나리오 18개의 실행값(baseUrl·browser·login·메뉴 수)을 스냅샷 비교 → 달라진 것 0개**. lint 폴더 전체 오류 0.
- **소스스캔 초안 2개**(사용자 요청으로 생성, `_` 로 시작해 목록·일괄 실행에서 제외):
  - `scenarios/스타벅스/_소스스캔-초안.json` — 333메뉴(60개는 01_메뉴회귀와 중복) / expect 134 / actions 139화면 187버튼 / `_버튼` 199 / 제외 목록(팝업 97·예제 46·화면조각 26·모바일 21·로그인계정 3) 보존. 환경값은 스타벅스 `_project.json` 에서 상속.
  - `scenarios/우리은행VOC/_소스스캔-초안.json` — 201메뉴(92개는 `기본/wrb-voc.json` 과 중복, **그 92개는 사람이 붙인 한글 메뉴명을 가져다 씀**) / expect 43 / actions 40화면 56버튼 / `_버튼` 49. 환경값은 새로 만든 `_project.json` 에서 상속.
  - 둘 다 **아직 실제 실행 안 됨**(스타벅스는 사내망 닫힘, 우리은행은 앱 기동 필요). 첫 실행 때 expect 오탐과 영문 메뉴명을 다듬어야 한다.

### 2026-08-31 (4) — 로그인 세션 재사용(reuseSession)을 프로젝트 설정으로 (기본 상속)
사용자 요청: "세션 재사용 좋은데, 프로젝트 설정에 추가하고 프로젝트 상속으로. 기본으로 상속되게".
- `scenario.js` **`PROJECT_KEYS` 에 `reuseSession` 추가** → `_project.json` 에 두면 그 프로젝트의 모든 시나리오가 상속. 우선순위는 다른 키와 같다: **시나리오 own > 프로젝트 > extends(_공통) > 전역 config.json**. (검증: 프로젝트 true + 자식 없음 → true / 자식이 false 로 직접 지정 → false / `_공통` 이 false 여도 프로젝트 true 가 이김)
- **🔧 프로젝트 설정 다이얼로그**에 `로그인 세션 재사용` 체크박스(`#pj_reuse`). 켤 때만 저장한다 — 끄면 키가 빠져서 ⚙ 전체 설정을 따르고, "설정 지우기"도 그대로 동작한다.
- **편집 폼은 체크박스 → 3단 선택**(`#f_reuse`: `기본(프로젝트 상속)` / `사용` / `사용 안 함`)으로 바꿨다. **이게 핵심** — 예전 체크박스는 폼에 채워진 값이 resolved(프로젝트에서 온 값)라 저장할 때마다 시나리오 파일에 `reuseSession:true` 가 박혀 상속이 끊겼다(HANDOVER 2026-08-29(24)와 같은 함정). 이제 `select()` 가 **원본 파일(own)** 기준으로 값을 채우고(`window._own`), 저장 시 `''` 이면 키를 아예 안 쓴다. 상속 중일 때는 `→ 프로젝트: 사용` 같은 안내를 옆에 보여 준다(`#f_reuseHint`, `applyInherit`).
- 검증: gui-check 62→**67**(프로젝트 저장·상속·폼 기본값·안내·"사용 안 함" 직접 지정).

### 2026-08-31 (3) — 🖱 버튼 동작 검사 (`actions`): 화면이 뜨는지 말고 버튼을 눌러 동작까지
사용자 요청: "버튼을 클릭했을 때의 기능까지 검증하는 걸 만들어 줘". 지금까지 menus 모드에서 눌리는 건 조회 버튼(`inputs.search`)과 목록 행(`detail`) 뿐이었다.
- **시나리오 키 `menus[].actions`**: `[{ name, click|text, frame, exact, dblclick, popup, expect, expectText, expectNotText, expectUrl, expectDialog, wait, waitFor, loading, close, back, screenshot, expectFail, skip, allowForbidden }]`. 버튼 하나가 결과표의 별도 행(`↳ <메뉴> · <버튼>`)이 된다.
- **적어 두지 않아도 보는 것**(이게 핵심): ① 버튼이 화면에 없으면 ❌ ② 누른 뒤 JS 에러·서버 5xx·에러 페이지 ❌ ③ 에러 알림(alert 에 오류/실패/Exception) ❌ ④ **아무 반응이 없으면 ⚠️** — 이동·팝업·서버 요청·DOM 변화·알림이 전부 없을 때. **죽은 버튼**을 잡는다.
  - 반응 판정은 클릭 직전 모든 프레임에 `MutationObserver`(`window.__wwt_mut`)를 심고, `page.on('request')` 로 요청 수를 세고, URL·팝업·dialog 를 함께 본다. 임계값은 **변화 1건 이상**(레이어를 `style.display` 하나로 여는 화면이 흔해서 3건으로 잡으면 오탐).
- **안전**: `forbidden` 에 걸리는 버튼은 누르지 않고 ❌ `금지 버튼 클릭 차단`(detail 행 클릭과 같은 규칙). `allowForbidden` 은 사용자 확인 후에만.
- **복귀**: 각 버튼 뒤에 레이어를 닫고(닫기 버튼 → 없으면 모달이 보일 때만 Esc), 화면이 바뀌었으면 메뉴 URL 재진입 + `applyInputs` 재실행. 그래야 다음 버튼을 같은 화면에서 누른다.
- 진행률(`progress.total`)·재시도 보정(`expected`)에 `actionCount(m)` 반영. `finishPage(…, { issues })` 로 호출한 쪽 판정을 함께 실을 수 있게 확장.
- **소스 스캔 연동**: `safeActions(buttons, forbidden)` — 조회/검색/초기화/닫기류만 고르고 등록·저장·삭제·발송·엑셀·다운로드는 제외(단어 기준 이중 필터 `SAFE_BTN`/`UNSAFE_BTN` + forbidden). CLI `--actions`, GUI 소스 스캔 다이얼로그 **🖱 버튼 동작 검사도 만들기** 체크박스. 옵션을 안 주면 `_액션후보` 메모로만 남긴다.
- **GUI**: 편집 폼에는 actions 칸이 없으므로 `tr.dataset.actions` 로 **저장 왕복에서 보존**(안 하면 GUI 로 저장하는 순간 사라진다). 메뉴 행 입력값 버튼에 `🖱버튼 N` 표시.
- lint: actions 형식·이름 중복·대상 누락·금지 버튼 경고.
- **검증**: `test/actions.json` + mock `/buttons`(정상·죽은 버튼·JS 에러·에러 알림·레이어·금지 버튼) → `npm run test:actions` 기대치 **전체 8 / 정상 4 / 실패 3 / 주의 1**. source-scan 자체검증 43→**48**(actions 생성/미생성·안전 필터·lint). gui-check 60→**62**(🖱 옵션, 폼 저장 보존).

### 2026-08-31 (2) — 소스 스캔: 화면 JSP 연결 버그 수정 + 화면별 버튼 목록
사용자 지적: "JSP 에 버튼들이 있는데 왜 빠지냐". **맞는 지적이었고 버그였다.**
- **버그**: 메뉴가 화면 정의 XML·메뉴 테이블에서 나온 경우, 화면 JSP 를 찾을 때 힌트를 `url.split('/').pop()` = `VOC1001.ub` 로 써서 `VOC1001.jsp` 와 매칭되지 않았다(확장자를 안 뗌). 그래서 스타벅스는 **JSP 연결 0건** → expect·조회조건·상세·버튼이 전부 비어 있었고, 나는 "버튼이 소스에 없다(메타 페이지=DB)"고 잘못 설명했다. 실제로는 `WebContent/WEB-INF/jsp/app/standard/<모듈>/<화면ID>.jsp` 가 774개 있다.
  - 수정 ①: 힌트에서 확장자 제거(`/screen/VOC1001.ub` → `VOC1001`). 수정 ②: 화면 정의 XML 의 `<filePath>/standard/voc/</filePath><fileName>VOC1001</fileName>` 을 `view` 로 실어 정확히 그 JSP 를 찾게 함.
  - 결과(스타벅스): JSP 연결 **450/528**, expect 212, 상세 후보 85. VOC1001 → `expect:#list` + `detail:#list tr.jqgrow(더블클릭)` 로 사람이 만든 시나리오와 같은 값이 나온다.
- **화면별 버튼 목록 추가**(`analyzeView.buttons`): 마크업 버튼(`<button>`/`<a class=btn>`/`value=`) + **스크립트에서 id 로만 다루는 버튼**(`$('#btnRegister').click(…)` — 메타 화면은 마크업에 버튼이 없다). 라벨·셀렉터·위험 여부(⚠)를 화면당 최대 20개.
  - **클릭 스텝은 만들지 않는다**(누르면 데이터가 바뀌고, 성공 판정을 소스에서 정할 수 없다) — 초안의 `_버튼` 키와 보고서 "화면별 버튼" 표로 보여 주고, CRUD 흐름은 ⏺ 녹화로 만들게 한다.
  - JS 문자열로 조립한 마크업(`tag +='<button…`)에서 잘려 나온 조각은 라벨에 `'"+<>${};=` 가 있으면 버린다.
- **조회 버튼 추론**: 화면 JSP 에 조회/검색 마크업이 없는 메타 화면도, 버튼 id 가 딱 `searchBtn|btnSearch|…` 인 것을 세어 `inputs.search` 후보로 쓴다 → 스타벅스에서 `#searchBtn`(사람이 검증한 값과 동일)이 나온다. 빈도 우선, 동률이면 id 우선.
- 검증: `npm run test:source` 38 → **43**(버튼 5건 추가: 마크업 버튼·⚠위험표시·JS id 버튼·셀렉터·JS 조각 제외). gui-check 60 유지.

### 2026-08-31 — 📂 소스에서 만들기 (scan-source): 소스를 읽어 시나리오 초안 생성
사용자 요청: "시나리오 만드는 게 어렵다 — tester 가 소스를 보고 만들 수 없나". 지금까지 소스를 읽어 시나리오를 만드는 건 **Claude 뿐**이었고(폐쇄망에서는 불가), 도구 쪽에는 화면을 긁는 discover 만 있었다. `CLAUDE.md` 의 "시나리오 작성 절차 1~8" 을 정규식 규칙으로 옮긴 것이 이 기능이다.
- **`src/source-scan.js`** (의존성 0, 파일만 읽음): `scanSource(root, opts)` → `{ baseUrl, login, menus, forbidden, inputsCommon, searchSel, skipped, warnings, apis, stats }`, `toScenario(r)` → 시나리오 초안, `renderSourceReport`/`writeSourceReport` → 근거 보고서.
  - 메뉴 출처 4가지(확신도 순): **메뉴 테이블 INSERT**(MENU_NM+MENU_URL+상위메뉴 → `대 > 소` 이름) > **화면 정의 XML**(`<screenBuilder id><screenName>` — uBridge/uxl) > **메뉴 JSP**(href·onclick·`data-menu-url` 속성) > **컨트롤러**(`@GetMapping` 등). struts `<action path>`·옛 Spring `<bean name="/x">` 도.
  - baseUrl = `application-*.yml`(local 우선, `port: '8081'` 처럼 따옴표 붙은 값 포함)·`server.xml` Connector·`context-path`·pom `finalName`. login = 비밀번호 입력란이 있는 JSP 중 점수가 가장 높은 것에서 아이디/비번/버튼 셀렉터 + URL + `detect`.
  - forbidden = 모든 JSP 버튼 텍스트에서 위험 단어(횟수·예시 위치 포함). expect·조회조건·상세 후보 = 화면 JSP(jqGrid/toastUI/table id, 조회 폼 input, `ondblClickRow`).
  - 안전장치: **상세(detail)와 조회 조건 값은 자동으로 넣지 않는다**(행 클릭이 데이터를 바꿀 수 있고, 날짜 형식·기간 제한을 모른다) — 후보만 `_상세후보`·`_todo_inputs`·보고서에.
  - 결과물 2개: 시나리오 초안 JSON(각 메뉴에 `_출처`) + `reports/_소스분석/<이름>-<시각>/source-scan.html`(메뉴별 근거 파일:줄, 확신도, **제외한 것과 이유**, 로그인·금지버튼·조회조건·상세 후보, 다음 단계).
- **CLI** `run.bat scan-source <소스폴더> [--out|--append] [--name --url --user --pattern --limit --no-expect]` — 저장하면 lint 까지 돌려 준다. **GUI** 편집 탭 `📂 소스에서 만들기`(`openSourceScan`) → 폴더 입력 → 진행 로그(SSE) → 체크박스 표(거르기·전체선택) → [선택한 메뉴 추가] + 접속·로그인/금지버튼/조회조건 설명 적용 토글. 서버 `POST /api/source/scan`(응답은 GUI 가 쓰는 것만 슬림하게).
- **실측 검증 (사람이 만든 시나리오와 대조)**: 우리은행 VOC(Spring Boot+Tiles, 4587파일 1초) → 메뉴 205개, 사람 109개 중 **92개** 일치(나머지는 경로변수 `/cmtyBrd/TP…`·`/statisticN` 이나 DB 에만 있는 주소), baseUrl `:8081`·로그인 `#loginId/#loginPwd/[data-click=signIn]` 정확. 스타벅스 VOC(uBridge, 3262파일 1초) → **61/61 전부** + 로그인 `/screen/BCO0001.ub`·`#userid/#userpw/#login` 이 사람이 만든 것과 완전히 일치.
- **만들면서 걸린 함정(다음에 규칙을 고칠 때 주의)**
  1. **주석·백업 파일**: 우리은행 `@RequestMapping` 첫 25건이 전부 `ApiVocController_backup_0903.java` 의 `//@GetMapping` 이었다 → 파일명 `_backup|_bak|_old|복사본` 제외 + 주석을 **길이·줄 보존하며** 지우는 `maskJava`(문자열 리터럴은 남기고 `skel` 에서만 지워 중괄호 짝 맞추기에 사용).
  2. **javadoc 을 멀리서 끌어오면** 모든 메뉴 이름이 `<pre> com.…` 이 된다 → 주석이 애너테이션 **바로 위**일 때만, 그리고 javadoc 안에 `*/` 가 다시 나오면 안 되게(`(?:(?!\*\/)[\s\S])*`) — 안 그러면 "앞 메서드 주석 + 코드 + 이번 주석" 이 통째로 잡힌다.
  3. **부분 일치 제외의 함정(= discover 에서 겪은 것과 같은 것)**: `proc` 로 거르면 `vocProcessList`, `excel|upload` 로 거르면 `/excelLog`·`/mgmtExcelUpload` 같은 **정상 화면**이 사라진다 → 단어 단위(`NOT_MENU_WORDS`) + "조각 전체가 그 단어일 때만"(`ALONE_WORDS`)으로 분리.
  4. **라이브러리 제외도 마찬가지**: 에디터 이름은 경로 어디에 있어도(`CrossEditor/`) 제외하지만, `doc|test|sample` 은 조각 전체일 때만(`isLibPath`). 안 그러면 업무 경로가 통째로 날아간다. (스타벅스에서 `uxl/menu/sample/iconMenu.html` 이 메뉴 128개로 잡혔던 것)
  5. **로그인 버튼은 점수제**: 비밀번호 칸 뒤 첫 매치를 쓰면 "아이디 저장" 체크박스(`div.login-idcheck`)를 집는다 → btn/버튼태그/텍스트 가점, `idsave|find|join|cert` 감점.
  6. **로그인 성공 판정**: 로그인 URL 에 `login` 이 없는 사이트(`/screen/BCO0001.ub`)에서는 `urlNotContains:login` 이 항상 통과한다 → `detect`(비밀번호 칸이 아직 보이면 실패)를 기본으로 넣는다.
  7. 한 메서드 = 한 화면(`@GetMapping({"", "index"})` → 짧은 쪽), URL 정규화(`/x/`·`/x/index` → `/x`), 컨텍스트가 baseUrl 에 있으면 메뉴·로그인 URL 에서 제거, `port: '8081'` 따옴표, pom `${project.artifactId}` 는 컨텍스트로 안 씀.
  8. CP949 소스 대비: utf8 로 읽어 `�` 가 있으면 `TextDecoder('euc-kr')` 로 다시 읽는다(`readText`).
- **검증**: `npm run test:source`(`test/source-fixture` 가짜 프로젝트 + `test/source-scan-check.mjs`, 38 ok — 백업/주석 제외·POST·API·모달·경로변수 제외 사유·컨텍스트 제거·(조회만) 표시·초안 lint 통과까지). gui-check 에 소스 스캔 E2E 4건 추가 → **60 ok**. 기존 스위트(npm test 7/5/1, lint:test) 회귀 없음.
- 남은 것: 메뉴 이름이 없는 컨트롤러(주석 없는 프로젝트)는 이름이 `emp > list` 식이라 다듬어야 한다. `@RestController` 만 있는 SPA 백엔드는 메뉴를 못 만든다(화면이 프런트에 있음).

### 2026-08-29 (26) — 예상된 실패(expectFail): "막혀야 정상"인 항목을 실패로 안 센다
- 메뉴/CRUD 흐름에 `expectFail` 추가. `true`=모든 실패 예상 / 정규식 문자열·배열=그 사유의 실패만 예상. 예상대로 실패하면 상태를 `ok`+`r.expected=true` 로 바꾸고 🔒(예상된 실패)로 표기 — **fail 카운트에서 빠짐**. 다른 사유로 실패하면 그대로 ❌ + 경고. 막혀야 하는데 통과하면 ⚠️(`expectedMiss`).
- 구현: `src/runner.js` `finalize()` 에서 판정(헬퍼 `expectFailPatterns`/`expectFailLabel`). 결과 객체에 `expectFail` 을 실어 보냄(finishPage=`extra.item?.expectFail`, 메뉴/CRUD catch·push, crud 성공 push). retry 는 status 가 ok 라 안 걸림(예상 실패를 재시도하지 않음). 스크린샷은 실패 시점에 이미 찍혀 증적으로 남음.
- 보고서(`src/report.js`): `statusIcon` 🔒, 요약에 "예상된 실패 N(정상 처리)" + 필터 칩(`data-f=expected`), 행/스크린샷 class `expected`(정상 필터와 분리), 총평·md·json(`expected` 필드)·매트릭스(🔒)·CSS 반영. ok 카운트에서 expected 는 뺐다(따로 셈). `defects.csv` 엔 안 들어감(결함 아님).
- 매트릭스(`src/batch.js`): 셀에 `expected` 실어 🔒 표기(기존 🚫 blocked 와 별개 — blocked 는 매트릭스 아이콘만 바꿀 뿐 상태는 그대로였음).
- lint(`src/lint.js`): `expectFail` 정규식 검사(`lintExpectFail`).
- 검증: mock `/err`(500)로 5케이스(패턴매칭·true·패턴다름·통과·일반실패) 전부 기대대로. npm test 7/5/1 · batch 6/2 · gui-check 53/0 회귀 없음.

### 2026-08-29 (25) — 보고서 URL 칸 말줄임(표 깨짐 방지)
- 긴 URL 이 결과 표를 밀어 레이아웃이 깨지던 문제. `src/report.js` 의 `td.url` 을 `word-break:break-all`(무한 줄바꿈) → `max-width:340px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`(말줄임)로 변경하고, `<td class="url">` 에 `title`(전체 URL) 추가 → 마우스 올리면 전체 확인. 상세 섹션 `.shot small` 에는 `word-break:break-all` 추가(카드 밖 삐짐 방지).
- CSS만 바뀜(판정 로직 무관). 긴 URL 샘플로 렌더 확인.

### 2026-08-29 (24) — 상속 우선순위 수정: 프로젝트 설정 > extends (기능 버그 수정)
- (23)에서 데이터(_공통)를 손으로 고쳤는데, 사용자 지적대로 **그건 기능이 안 되는 것**이었다. 코드로 고침 + (23)의 _공통 편집은 원복.
- 변경: `resolveForRun`/`applyProjectDefaults` 의 우선순위를 **시나리오 own > 프로젝트 설정(_project.json) > extends(_공통)** 로. 즉 시나리오가 자기 파일에 baseUrl/browser/login/stubServer 를 직접 정하지 않았으면, extends 로 온 값보다 **프로젝트 설정이 우선**한다 → "🔧 프로젝트 설정을 바꾸면 상속 시나리오가 그 값으로 돈다"는 기대대로 동작.
  - 구현: `applyProjectDefaults(resolved, pc, ownRaw)` — ownRaw(시나리오 원본, extends 풀기 전)에 그 키가 없으면 프로젝트 값으로 덮는다(extends 로 온 것도 덮음). own 에 있으면 own 최우선. ownRaw 생략 시 예전(없는 것만 채움) 동작 유지.
- 검증: _공통 에 baseUrl(:8080/voc)이 있어도, 프로젝트 baseUrl 을 LOCAL:9999/voc 로 바꾸니 01/02/03 전부 그 값. 시나리오 own baseUrl 은 여전히 최우선. 하위호환: _project.json 없는 프로젝트(우리은행 등)는 그대로.
- _project.json baseUrl 은 `…:8080/voc`(컨텍스트 포함, war 정상값)로 둠. 삭제했던 _공통 의 baseUrl/browser 는 fallback 으로 복원(프로젝트 설정 있으면 무시됨). projectSettingsDialog 저장 시 browser.viewport 보존(23의 코드 수정 유지).
- 교훈: 환경값(baseUrl/browser/stub)은 _project.json 에 두는 게 정석이지만, extends(_공통)에 있어도 이제 프로젝트가 이긴다.

### 2026-08-29 (23) — 스타벅스 환경설정을 프로젝트 단일 소스로 (상속 우선순위 함정)
- 증상(사용자): 🔧 프로젝트 설정 baseUrl 을 바꿔도 02_권한/03_프로세스 시나리오에 안 먹힘.
- 원인(코드 아님, 상속 우선순위 by design): **시나리오 own > extends > 프로젝트(_project.json)**. 02/03 은 `_공통.json` 을 extends 하는데 그 `_공통.json` 이 자기 baseUrl(`…:8080/voc`)·browser 를 갖고 있어 프로젝트 값을 덮어씀. 01 만 프로젝트에서 상속. 게다가 _project.json baseUrl 이 `/voc` 없이 `:8080` 이라 01 은 잘못된 주소.
- 수정(데이터): `_project.json` baseUrl 을 `…:8080/voc` 로 고치고 browser 에 viewport(1600x950) 포함. 두 `_공통.json` 에서 `baseUrl`·`_comment_baseUrl`·`browser` 제거 → 프로젝트에서 상속. 이제 🔧 한 곳만 바꾸면 01/02/03 61개 전부 반영(테스트 확인). `_공통.json` 에 `_comment_env` 로 "baseUrl 다시 넣지 말 것" 명시.
- 수정(코드): `projectSettingsDialog` 저장 시 browser 의 viewport·headless 를 잃던 버그 수정(폼엔 channel 만 있어 `config.browser={channel}` 로 덮어써 viewport 유실) → 기존 browser 를 병합해 보존.
- 교훈: extends 부모(_공통)에 환경값(baseUrl/browser)을 두면 프로젝트 설정 상속이 안 먹는다. 환경값은 _project.json 한 곳에만.

### 2026-08-29 (22) — 로그인 세션 재사용 (storageState)
- `reuseSession: true` (시나리오 키 / ⚙ 전역 / 편집 폼 체크박스): 최초 로그인 뒤 `context.storageState()` 를 `<ROOT>/.sessions/<md5(baseUrl|로그인아이디)>.json` 에 저장, 다음 실행·시나리오에서 재사용.
  - runner: newContext 에 `storageState`(있으면) → 로그인 섹션에서 `sessionValid()`(포털=login.steps 의 마지막 goto→login.after→menus[0]→'/' 로 이동 후 success/detect 검사)로 유효하면 **로그인 스텝 생략**, 만료면 정식 로그인 후 `saveSession()`.
  - 효과: 일괄(같은 baseUrl+아이디) 실행 속도 ↑, 로그인 반복 ↓(계정 잠금·스캐닝 오인 감소 — 보안 방향과도 맞음).
  - 세션키 = baseUrl + 로그인 아이디값(login.userField 또는 첫 fill). switchUser 는 세션 저장/재사용에 안 씀(계정 섞임 방지).
  - `.sessions/` 는 쿠키를 담으므로 로컬 전용(번들 include 아님, 반입 zip 에 안 들어감). 기본 꺼짐(opt-in).
  - config.js withDefaults 에 reuseSession 추가(전역→시나리오). gui-check 53.

### 2026-08-29 (21) — stub 분석 가이드 (문서)
- `docs/stub-분석-가이드.md` 신설: 다른 세션 Claude 가 대상 프로젝트 소스를 분석해 외부 연동을 찾아 `stubServer` 로 만드는 절차(호출 지점 grep → 경로·메서드·성공코드·응답필드 추출 → JSON/SOAP 라우트 → 프로젝트 단위 on/off → 앱을 stub 에 붙이기(환경) → 검증 → 함정). CLAUDE.md·HANDOVER 파일지도에서 참조.
- 스타벅스 시나리오(`starbucks-voc.json`)에 `enabled:false` stub 예시 + `_comment_stubServer` 추가(문자발송/매장연동/catch-all).

### 2026-08-29 (20) — 서버 stub (백엔드 외부 연동 목업, 프로젝트 단위 on/off)
- (19)의 browser `mocks` 는 화면 fetch/XHR 만 잡는다. 백엔드(서버)가 부르는 외부 연동은 브라우저를 안 거쳐서 안 잡힘 → 진짜 HTTP **stub 서버**로 처리.
- `src/stub-server.js`(Node 내장 http, 의존성 0): `startStub({port,routes,vars},{log,vars})`. url 매칭 `re:`/글로벌/부분일치, method 필터, json/body(+sub), status, delayMs, CORS+OPTIONS. 미매칭은 404.
- **프로젝트 단위 on/off**(사용자 요청: 로컬=목업 ON / 개발·운영=실제 OFF): `stubServer` 를 `PROJECT_KEYS` 에 추가(scenario.js) → `_project.json` 에 저장·상속. `stubServer.enabled:false` 면 runner 가 안 띄운다. 🔧 프로젝트 설정 다이얼로그에 "서버 stub 사용" 토글 + 포트 + 라우트 JSON.
- runner: `sc.stubServer.enabled!==false && routes.length` 이면 실행 전 startStub, finally 에서 stop.
- CLI `stub <파일>`: 프로젝트/시나리오의 stubServer 를 읽어 단독으로 계속 띄움(앱을 붙여 수동 테스트용, Ctrl+C 종료. enabled:false 여도 단독 실행은 띄움).
- **한계**: 대상 앱이 이 stub 을 보도록 외부 연동 주소를 설정 변경/hosts 로 돌리는 건 환경 세팅(도구 밖). stub 은 실행 중에만 뜸.
- 검증: startStub 단위(vars·동적토큰·method·정규식·미매칭·stop), 프로젝트 상속+enabled 토글. gui-check 52 유지.

### 2026-08-29 (19) — 인터페이스 목업 (외부 호출 가로채기)
- 사용자가 말한 "목업" = **폼 입력 데이터가 아니라 외부 인터페이스/서비스 호출을 실제로 안 타고 지정 응답으로 돌려주는 것**. (18)의 vars 는 오해였고 vars 는 그대로 두되, 진짜 요청 목킹을 추가.
- `sc.mocks: [{ url, method?, status?, json?/body?, contentType?, headers?, abort?, delayMs? }]`. runner 가 `context.route` 로 등록.
  - url 매칭: `re:정규식` / 글로벌(`*`,`**`) / 그 외는 부분일치(`**url**`). CORS 허용 헤더·OPTIONS 프리플라이트 자동 응답(교차 출처 fetch 도 받게). body/json 안에서 `sub()`(vars·동적 토큰) 치환.
  - `abort:true` = 호출 차단, `delayMs` = 지연. 등록은 페이지 이동/로그인 전(context) → 로그인 포함 전 구간에 적용.
- GUI: 편집 폼 "인터페이스 목업" 카드(`#f_mocks`, JSON 배열) + fillForm/formToJson 왕복.
- 픽스처: mock `/iface`(ext.invalid/api/rate 를 fetch). 검증: 목업 없으면 `ERR_NAME_NOT_RESOLVED`, 목업 있으면 화면에 지정값(rate=MOCKED-1250) — 실제 호출 안 탐. gui-check 52.
- 미적용: recorder/scan/discover 에는 mocks 미적용(실행 runner 만). 필요 시 추가.

### 2026-08-29 (18) — 테스트 데이터 변수(vars) + 동적 토큰
- 목업 데이터를 시나리오에서 받도록: `sc.vars`(이름→값) + 동적 토큰. `{{이름}}` 치환 우선순위 **secrets(실행 시 입력) > vars > 동적 토큰**.
  - `src/vars.js`: 동적 토큰 `today/now/time/ts/rand/rand6/rand4/uuid/seq`. `makeDynamic()` 는 실행 1회 동안 캐시(값 일관), `seq` 만 쓸 때마다 +1(중복키 방지).
  - runner `sub()` 확장 + **모든 스텝에 sub 적용**(fill/type/inputs/switchUser 에 더해 goto·expectText·expectNotText·expectUrl·expectDialog).
  - `secrets.js findPlaceholders`: vars 키·동적 토큰(RESERVED)은 "실행 시 입력" 목록에서 제외 → 팝업 안 뜸.
  - GUI: 편집 폼 "테스트 데이터 (변수)" 카드(`#varRows`, addVarRow), fillForm/formToJson 왕복. `{{today}}{{now}}{{rand}}{{seq}}{{uuid}}` 안내.
  - 검증: mock 등록 흐름 `{{custName}}-{{seq}}` 채움→저장→목록 확인 ok. gui-check 51.
  - 주의: vars 값 안의 `{{다른토큰}}` 은 중첩 확장 안 함(단일 패스). 동적 값은 필드에 직접 `{{now}}` 로.

### 2026-08-29 (17) — 녹화 모드: 자동 로그인 시 시작 URL 버그 수정
- 증상: 녹화 모드에서 "로그인 자동 처리"를 켜면 로그인 후 포털로 안 감. 원인 = 시작 URL 기본값이 **로그인 URL** 이라, 자동 로그인 뒤 다시 로그인 페이지로 goto.
- 수정: `#rcLogin` change 시 시작 URL 을 스왑 — ON → **로그인 후 이동 URL**(login.steps 의 마지막 goto, 없으면 `/`), OFF → 로그인 URL. 사용자가 직접 수정한 값은 안 건드림(기본값과 같을 때만 스왑).
- 검증: 토글 ON → `/login`→`/main`, 자동 로그인 후 `goto /main`(포털) 기록 확인. gui-check 50 유지.

### 2026-08-29 (16) — 시작 시 폴더 접힘 (전체 설정)
- 사용자 요청: GUI 를 처음 열 때 폴더는 닫힌 채로. 전체 설정(⚙)에 **시작 시 폴더** = `closed`(기본)/`open`/`remember` 추가(`config.folders`).
- startup(IIFE): config.folders 를 읽어 `closed` → `tree.dirs` 전부 `collapsed` 에 추가 후 renderTree, `open` → collapsed 비움, `remember` → localStorage 그대로.
- 닫힘 모드에서는 첫 시나리오 자동 선택이 상위 폴더를 펴 버리므로, **폴더 밖(2단계) 최상위 시나리오만 자동 선택**. `config.folders` 는 UI 전용(scenario.js withDefaults 는 무시).
- 검증: closed → 폴더 `.closed` / open → 펼침 (headless). gui-check 50 유지(자동검증 프로젝트는 하위 폴더가 없어 영향 없음).

### 2026-08-29 (15) — 가이드: expect 는 런타임 검증 필수 (문서만)
- 코드 변경 아님. `docs/시나리오-작성-가이드.md` 2-5(expect) 에 **경고 블록 추가**: expect 는 소스 JSP id 를 그대로 쓰지 말고 **실제 렌더 화면에 보이는 요소**여야 한다. 메타(uxl)·트리(dynatree)·팝업·jqGrid 는 소스 구조 ≠ 런타임(숨김/동적생성)이라 오탐 유발.
  - 근거: 스타벅스 VOC 시나리오에서 소스 grep 만으로 넣은 expect 가 오탐(❌) — VOC1026/STC0102(트리): `#searchForm`/`#rb_store`(런타임 미존재·숨김) → `#vocCauseTree`/`#storecareCauseTree`(트리 컨테이너)로 교체. POP0007(문자발송 팝업): `table.ui-jqgrid-btable`(jqGrid 데이터 있을 때만 생성) → `#registForm`(정적 발송폼)으로 교체.
  - 지침: 소스로 후보만 잡고 **첫 실행 report/스크린샷의 "핵심 요소 없음: … (N초 대기)" ❌** 로 확인 후 확정. jqGrid 는 컨테이너 `#list` 우선.

### 2026-08-29 (14) — "맨 위로" 버튼
- GUI: 각 `.tab`(실행/편집/증적/도움말)이 스크롤 컨테이너 → 우하단 떠 있는 `#toTop`(↑). 300px 이상 내려가면 표시, 누르면 현재 탭 맨 위로(smooth). `initToTop`(startup) + `tab()` 에서 갱신.
- 보고서(`report.js`): body 스크롤 → 같은 `#toTop` 버튼 + scroll 리스너.

### 2026-08-29 (13) — 녹화를 단일 "녹화 모드" 로 통합
- 사용자 요청: 메뉴 카드 / CRUD 카드에 하나씩 있던 녹화 버튼(`openRecorder('menu')`/`('crud')`)을 없애고 **편집 툴바의 단일 `⏺ 녹화 모드`(`openRecorder()`)** 로 통합. "시작하면 로그인 화면부터 띄우고 그때부터 기록".
  - 시작 URL 기본값 = 로그인 URL(`eff.login.url`). 로그인 처리 체크박스 **기본 해제** = 로그인 화면부터 직접 로그인하며 그 과정도 기록(비번은 `{{password}}` 로 저장). 체크하면 예전처럼 자동 로그인 후(기록 안 함) 시작.
  - 종료 후 한 패널에서 이름 + **[＋ CRUD 흐름으로 추가] / [＋ 클릭 진입 메뉴로 추가]** 둘 다 제공(기록 스텝은 동일, 목적지만 선택). expect(메뉴용)·allowForbidden(CRUD용) 필드 공존. JSON 은 `<details>` 고급.
  - `recUI.state` 의 resume 도 `openRecorder(true)` 로. 엔진(`recorder.js`)은 그대로 — login:false 로 시작하면 로그인 화면부터 기록되는 동작을 이미 지원.
  - E2E 확인: 녹화 시작→🔴녹화 중→종료→CRUD 추가. gui-check 50 유지.

### 2026-08-29 (12) — 녹화 UX 정리 + 프로젝트 상속과 연동
- 녹화 엔진(`recorder.js`)은 원래 "로그인(기록 안 함) → 브라우저 → 클릭·입력 실시간 기록"이 맞다(테스트로 확인). 사용자가 "값 입력 방식 같다"고 한 건 다이얼로그가 마지막 JSON 편집창을 크게 보여줘서 생긴 오해 → **다이얼로그를 정리**:
  - 안내를 번호 흐름으로(①로그인 자동 ②브라우저 열림 ③클릭·입력이 아래 표에 실시간 기록 ④■종료). 녹화 중 상태 문구 "🔴 녹화 중 — 브라우저에서 클릭·입력하세요".
  - 완료 후 **큰 JSON 편집창을 `<details>` 로 접음**(고급). 기본은 실시간 스텝 표 + 추가 버튼만. 로그인 미설정 시 "로그인 설정 없음 — 바로 시작" 표시.
- **프로젝트 상속과 연동(중요 버그 방지)**: 폼은 상속받는 baseUrl/login 을 생략하므로, 그대로 녹화/수집/스캔에 보내면 로그인이 빠진다.
  - 서버 `resolveBody` 를 `resolveForRun`(extends+프로젝트 병합)으로 바꿈. 클라이언트 `effective()` 도 `window._project` 를 병합하도록 하고, record/scan/discover 호출을 `effective(sc)` 로 보냄.
  - 검증: `_project.json` 에만 login 이 있고 시나리오는 login 을 안 가져도, 녹화가 그 로그인으로 접속한 뒤 클릭을 기록함(headless 테스트).

### 2026-08-29 (11) — 전용 "프로젝트 설정" 화면
- (10)의 "📌 프로젝트 공통으로"(현재 폼값을 밀어넣는 방식)를 없애고 **전용 다이얼로그 `projectSettingsDialog()`** 로 교체(사용자 요청). 헤더 **🔧 프로젝트 설정** 버튼 + 프로젝트 ⋯ 메뉴 첫 항목에서 연다.
  - 다이얼로그에서 접속 URL·브라우저·로그인(전체 필드)을 직접 편집 → `/api/project` 저장. "설정 지우기" 로 `_project.json` 삭제. 저장 시 현재 프로젝트면 `window._project` 갱신 + `applyInherit()` 로 열려 있는 폼에 즉시 반영.
  - 편집 폼의 "프로젝트 상속" 체크박스는 그대로 — 상속 켜면 해당 필드 입력 잠금(`applyInherit` 의 disabled). `projectMenu` 인덱스 재배치(0=설정/1=이름변경/2=탐색기/3=삭제).

### 2026-08-29 (10) — 로그 파일화 + 프로젝트 공통 설정(상속 토글)
- **로그를 파일로**: GUI 서버의 `console.log` 를 `logs/gui-YYYYMMDD.log`(append, UTF-8)로 뺐다(`fileLog`). 최소화된 콘솔 창은 시작 줄 한 줄만. 앱 창 열기 실패 등 사용자가 봐야 할 것만 콘솔에도 남긴다. (사용자가 1번=최소화 유지 선택 → 창은 두되 로그만 파일로)
- **프로젝트 공통 설정 `_project.json`** (`scenarios/<프로젝트>/_project.json`): `baseUrl`·`browser`·`login` 을 프로젝트 단위로 두고, 시나리오가 그 값을 안 쓰면 상속.
  - `scenario.js`: `readProjectConfig`/`applyProjectDefaults`/`resolveForRun`(=resolveScenario+프로젝트 병합). `loadScenario` 도 resolveForRun 사용. 우선순위 = **시나리오 own > extends > 프로젝트 공통**. 그룹(baseUrl/browser/login) 단위 전체 상속.
  - 실행 경로 전부 프로젝트 병합 적용: server `loadSc`, batch `readJson`, cli record/discover/run. 저장 시 baseUrl 검증도 프로젝트 값 인정.
  - 서버 `/api/project` GET/POST(dir+config, 지정 키만 저장, 다 비우면 파일 삭제). `/api/scenario` GET 이 `project` 도 반환.
  - **편집 폼 상속 토글**: 접속 URL·브라우저·로그인 옆 "프로젝트 상속" 체크박스(`#inh_baseUrl/#inh_browser/#inh_login`). 체크=프로젝트 값 표시+입력 잠금+저장 JSON 에서 생략, 해제=직접. `applyInherit()` 가 상태 반영. 프로젝트에 값 없으면 체크박스 잠금. 로그인은 "직접+사용 안 함 & 프로젝트에 로그인 있음"이면 `login:false` 로 상속 차단.
  - **📌 프로젝트 공통으로** 버튼(편집 툴바): 지금 폼의 접속·브라우저·로그인을 `_project.json` 으로 저장(`saveProjectDefaults`). 새 시나리오는 프로젝트 공통값이 있으면 기본 상속.
  - `applyConnLogin` → `fillLoginFields`+`loginFieldsToObj` 로 분리(폼↔login 객체 공용). 가져오기·상속·저장 모두 이 헬퍼 사용.
  - `ui.menu` 스크롤(60vh) — 가져오기 목록이 전 프로젝트라 길어짐.
  - gui-check 1건 추가 → 50 ok.

### 2026-08-29 (9) — 접속 URL·로그인만 다른 시나리오에서 가져오기 + 빈 template
- **📋 다른 시나리오에서 접속·로그인 가져오기** (로그인 카드 헤더 버튼 → `importConnLogin()`): 같은 사이트의 다른 시나리오를 골라 **baseUrl + login 설정만** 현재 폼에 복사. 이름·메뉴·나머지는 그대로. extends 시나리오는 resolved(실행값) 기준. JSON 직접 편집 모드면 raw 객체에 병합.
  - `fillForm` 의 접속·로그인 채우기를 `applyConnLogin(sc)` 로 분리해 fillForm 과 공용. gui-check 3건 추가 → 49 ok.
  - **전체 프로젝트에서 고른다**: `filesUnder(project)` 가 아니라 `scenarios`(전 프로젝트) 사용. 목록 라벨에 `[프로젝트]` 접두. `ui.menu` 에 `max-height:60vh;overflow:auto` 추가(시나리오가 많으면 스크롤).
- **새 시나리오 template 을 완전 빈 폼으로**: 기본 금지버튼·로그인 스텝·baseUrl 다 비움(login:{} 로 카드는 열림, 값만 빈칸).

### 2026-08-29 (8) — "새 시나리오"에 이전 값이 따라오던 버그 수정
- 증상: `＋ 새 시나리오` 를 눌러도 직전에 열어 둔 시나리오의 이름·URL·메뉴가 폼에 그대로 남았다.
- 원인: `newScenario()` 가 template 으로 `fillForm()` 한 뒤 `toggleRaw()` 를 부르는데, toggleRaw 의 폼 모드 분기가 **`#raw` 텍스트영역을 다시 파싱해 폼을 채운다**. newScenario 는 `#raw` 를 갱신하지 않아 거기 남은 **직전 시나리오 JSON** 이 template 을 덮어썼다. (select() 는 `#raw` 를 먼저 채워서 무사했음)
- 수정: newScenario 가 template 을 `#raw` 에도 넣은 뒤 fillForm/toggleRaw. 폼 모드·raw 모드 양쪽에서 새 시나리오가 빈 폼으로 시작함을 확인.
- **template 을 완전 빈 폼으로** (사용자 요청): 예전엔 기본 금지버튼(삭제·발송·결제·일괄)·로그인 스텝(userId/password/submit)·baseUrl(localhost:8080)이 미리 채워졌는데, 전부 비웠다. 새 tpl = `{ name:'', baseUrl:'', browser:{channel:'chrome'}, forbidden:[], login:{}, menus:[{name:'',url:''}], crud:[] }`. login:{} 라 로그인 카드는 켜진 채 값만 빈칸.
- 문구 점검(이어서): 전 탭 조작 요소 툴팁 채움(편집 툴바·사이드바·＋행추가·붙여넣기·녹화 버튼·로그인 사용·프로젝트 선택 등) — title 없는 컨트롤 0. 증적 탭 보고서/CSV/폴더·상단 버튼 툴팁도 보강.

### 2026-08-29 (7) — 실행/편집 탭 문구 다듬기 + 폴더 시나리오 목록 접기
- 실행 탭: 범위(조회+CRUD/조회만/CRUD만)·브라우저 창 숨김·증적 캡처·이름 필터·▶실행/■중단/서버 응답 확인 버튼에 설명 툴팁. 이름 필터 placeholder 를 "이 글자가 든 항목만 실행 (예: 사원)" 로, 입력폭 220px.
- 편집 탭 "기본"·"로그인" 카드의 라벨·컨트롤에 툴팁(접속 URL, 브라우저, 요소 대기/스텝 간격, 금지 버튼, 개인정보 가림, 성공 판정 등).
- **폴더 실행 시 시나리오 이름을 다 늘어놓지 않는다**: `#runFiles` 를 "포함 시나리오 N개 ▸"(접힘)로 바꾸고 누르면 목록 펼침(`toggleRunFiles`). 시나리오가 많은 폴더에서 화면이 길어지던 문제.
- UI 텍스트/토글뿐 — 로직 영향 없음. gui-check 46 ok 유지.

### 2026-08-29 (6) — 증적 탭에서 일괄 증적 펼치기
- 증적 탭의 일괄(🗂️) 행을 **▶ 눌러 시나리오별 하위 행 펼치기**. 하위 행마다 보고서·CSV·폴더 링크(+실패 있으면 ↻ 실패만 재실행).
  - `listReports`(server)가 일괄 report.json 의 `batch[]` 를 `children:[{scenario,dir,ok,warn,fail,total,file,error}]` 로 붙인다(dir = `<일괄폴더>/<하위폴더>`). `listReports` 는 report.json 있는 폴더에서 멈춰(하위 폴더 재귀 안 함) 하위 시나리오 폴더가 목록에 안 나오던 것을, children 으로 노출.
  - `loadReports`(ui): 일괄 행에 `.exp`(▶/▼) + `data-bx`, 하위 행은 `tr.childrow.child-<idx>` 로 렌더(기본 숨김), `toggleBatch(idx)` 로 토글. 링크는 `repLinks()` 로 공통화.
  - gui-check 4건 추가(펼치기 버튼/숨김/펼침/시나리오명) → **46 ok**. (주의: gui-check 는 일괄을 2번 돌려 batch 행이 2개 — 토글 검증은 첫 행 `child-<bx>` 로 범위를 좁혀서 본다.)

### 2026-08-29 (5) — 일괄 보고서에 시나리오별 개별 보고서 링크
- 일괄(폴더/프로젝트) 실행의 **합산 report.html·md 에 "시나리오별 보고서" 섹션 추가** — 각 시나리오 하위 폴더의 `report.html` 로 링크(📄 보고서 열기). 매트릭스 **열 제목도** 그 시나리오 보고서로 링크.
  - 개별 증적(하위 폴더 report.html/md/json + 스크린샷)은 예전부터 생성됐고 합산 보고서가 스크린샷은 상대경로로 링크했지만, **개별 보고서로 가는 링크가 없었다** — 그걸 추가.
  - 구현: `batch.js` 가 `writeReport(..., { batch: items })` 로 넘기고, `report.js` 가 `extra.batch`(name/dir/ok/warn/fail/error)로 섹션 렌더. `dirOf` 로 매트릭스 헤더 링크.
  - `report.json.batch`(compare 의 일괄 판정·rerun-failed 매핑, 증적 목록에서 쓰임)는 **batch.js 가 그대로 기록** — 형태 안 바뀜. writeReport 는 렌더링만.
  - 폴더 링크는 넣지 않음: 서버 `serveFile` 이 디렉터리 요청에 404 라서(`/reports/*`) 개별 `report.html` 로만 연결.

### 2026-08-29 (4) — 전체 설정 확장 + ⚙ 다이얼로그 확대
- **전역 설정 6키 추가** (`src/config.js withDefaults`): `timeout` `expectTimeout` `headless` `screenshot`(all/fail/none) `compare` `checks`(images/layout). 전부 "시나리오가 정했으면 그 값이 우선".
  - `headless`/`checks` 는 `browser`/`checks` 객체에 병합(키 단위로 시나리오 우선). `screenshot` 은 `sc.screenshot`(top-level)로 주입하고 runner `shotMode` 가 **opt(run) > 시나리오 evidence(명시) > config 주입값 > 'all'** 순으로 판정(`scHasEvidence` 로 시나리오 evidence 가 config 를 이기게).
  - `compare` 는 시나리오 필드가 아니라 실행 옵션이라 **진입점에서** 처리: CLI `options().compare = --no-compare? false : loadConfig().compare!==false`, GUI 는 시작 시 `#cmpPrev`/`#headless` 체크박스를 config 로 초기화(증적 캡처는 `#shotMode` 빈 값="시나리오대로"가 이미 config 로 흘러가 그대로 둠).
- **⚙ 설정 다이얼로그 확대**: 420→**620px**, 2단 그리드(`.cfgGrid`). 순회속도·로그인재시도·증적캡처·timeout + 체크박스(headless/compare/images/layout) + 고급(stepDelay/slowMo/slowMs/expectTimeout). 실측 620×589, 10개 필드 렌더 확인.
- 검증 그대로: 시나리오 스위트 5종 · lint · gui-check 42. `withDefaults` 6키 적용/시나리오 우선 단위 확인 완료.

### 2026-08-29 (3) — 보안 프로그램 반입 대응 + 전역 설정
사용자 요청: 보안 프로그램(EDR·백신·반입 심사)에 최대한 안 걸리게 + 순회 속도를 전역으로 조절 가능하게. **반입 신청서/심사 문서는 만들지 않는다(사용자가 그냥 반입)** — 다음 세션도 제안하지 말 것.
- **① 자동화 표식 숨김 제거** (`server.js` openAppWindow): `ignoreDefaultArgs: ['--enable-automation']` 삭제. "자동화 표식을 일부러 지우는" 코드로 읽혀 불리했다. 앱 창에 "자동화 소프트웨어가 제어 중" 줄이 뜨는 것 외 차이 없음.
- **② 프로세스 체인 단축** (`WigoWebTester.bat`): `start /min cmd /c node …` → `start "..." /min node …`. bat→cmd→node→chrome 다단계 spawn 이 EDR 탐지 패턴이라 cmd 한 단계 제거.
- **④ 순회 속도 낮춤 + 전역화**: 전역 설정 `config.json` 신설(`src/config.js`). `speed` 프리셋(아주 느림/느림/보통/빠름 → stepDelay+slowMo) + `retries`/`stepDelay`/`slowMo`/`slowMs`/`emptyWait` 개별값.
  `runScenario` 진입 시 `withDefaults(sc)` 로 **시나리오에 없는 값만** 채운다(시나리오가 항상 우선). 현재 기본 `{ speed:"느림"(step1000/slow120), retries:2 }`.
  - **사용자 시나리오 61개에서 `stepDelay`·`browser.slowMo:0` 을 제거**(strip 스크립트, JSON 라운드트립)했다 — 안 지우면 pin 값이 전역 설정을 덮어 순회 속도 knob 이 안 먹는다. `example.json` 만 키 설명용으로 남김.
  - GUI: 헤더 **⚙ 설정** 버튼 → `settingsDialog()`(순회 속도 select + 로그인 재시도 + 고급). `/api/config` GET/POST. 저장은 다음 실행부터 적용.
  - 자체 검증 결정성: `--no-config`(CLI) / `WWT_NO_CONFIG=1`(env) → 전역 설정 무시. npm test 스크립트 전부 `--no-config` 추가. gui-check 는 env 로.
- **⑥ 로컬 API 토큰** (`server.js` + `ui/index.html`): 서버 시작 때 랜덤 토큰 생성, 앱 창 URL `?t=` 로만 GUI 에 전달. 모든 `/api/*` 는 헤더 `x-wwt-token`(EventSource 는 쿼리 `t`)를 검사, 불일치면 403.
  127.0.0.1 전용이라도 CSRF·DNS 리바인딩으로 로컬 페이지가 파일 쓰기·`/api/open` 프로세스 실행을 시키는 것을 막는다. 정적(`/`, `/reports/*`)은 읽기 전용이라 검사 제외(보고서 `<img>`·새 탭이 헤더를 못 실음).
  - `WWT_TOKEN` env 로 고정 토큰 지정 가능(자체 검증용). gui-check 은 `WWT_TOKEN=test-token` + `?t=` 로 접속하고 **토큰 없는 요청 403** 을 확인한다.
- **내장 브라우저 폴더 삭제**: `browsers/`(427MB, 미서명 Chromium) 제거 — 시스템 Chrome/Edge 만 쓴다(미서명 실행파일은 AppLocker·백신에 가장 잘 걸림). `--browser` 로 다시 만들지 말 것.
- `config.json` 을 반입 zip 에 포함(`bundle.mjs` include). gui-check 3건 추가(토큰 403 / config GET / ⚙ 다이얼로그) → **42 ok**.
- **못 없앤 것(한계)**: CDP 브라우저 조종 자체(도구 본질), node.exe(93MB) 미등록 실행 → AppLocker 예외는 회사 정책이라 코드로 불가(서명은 유효).

### 2026-08-29 (2)
- **"빈 화면" 오탐 수정** (`src/checks.js`). 스타벅스 실측에서 상세 3건이 ⚠️ 빈 화면으로 찍혔는데 **스크린샷에는 내용이 멀쩡히 있었다**.
  - 원인: `collectText()` 가 프레임마다 `evaluate(() => document.body.innerText)` 를 돌리면서 실패를 `catch {}` 로 **빈 문자열처럼 삼켰다.**
    목록 자리에서 상세를 다시 그리는 화면(URL 이 안 바뀌는 상세)은 검사 순간에 내용이 교체 중이라 컨텍스트가 날아가거나 body 가 잠깐 비어 있다.
    스크린샷은 그 뒤 `inspectLayout` + `applyMask` 를 거쳐 몇백 ms 늦게 찍히니 그때는 이미 다 그려져 있어서 증상이 안 보였다.
  - 근거: 그 실행의 report.json 에서 ⚠️ 3건은 URL 이 목록 화면 그대로(`…VOC1001.ub#none`), ✅ 6건은 새 URL 로 이동(`…VOC1503.ub?ID_…`) — 제자리 렌더링에서만 났다.
  - 수정: `collectText` 가 `{ text, failed }` 를 돌려주고(못 읽은 프레임 수), `readText()` 가 비어 보이면 250ms 간격으로 `emptyWait`(기본 1500ms)까지 다시 읽는다.
    끝까지 비면 그때 경고하고, 못 읽은 프레임이 있었으면 메시지에 `— 프레임 N개를 읽지 못함` 을 붙인다(다음에 원인 추적하기 쉽게).
    **정상 화면은 첫 읽기에서 통과하므로 느려지지 않는다** — 비어 보이는 화면만 최대 1.5초 더 기다린다.
  - 시나리오 키 `emptyWait`(ms) 추가 — 아주 느린 화면이면 늘리고, `0` 이면 예전처럼 즉시 판정(회귀 확인용으로 씀).
  - 회귀 픽스처: mock `/repaint?ms=900`(처음엔 빈 `#content`, ms 뒤에 채워짐 — `html()` 을 쓰면 메뉴 텍스트 때문에 안 비니 직접 만든 페이지),
    `test/checks.json` 에 메뉴 "다시그리는화면" 추가 → `test:checks` 기대치가 6→**7 / 정상 2→3**. `emptyWait:0` 으로 돌리면 예전 오탐이 그대로 재현된다(확인함).
  - 남은 것: 그 실행의 005(전체 VOC 상세)는 **클릭한 행(C202608260001)과 캡처된 상세(C202608250008)가 다르다**. 별건이고 사내망이 열려야 확인 가능.

### 2026-08-29
- **개인정보 마스킹 `mask`**: 캡처 직전 모든 프레임에 `<style id="__wwt_mask">` 를 넣어 해당 요소를 `maskColor` 로 덮고, 캡처 후 제거(`applyMask`).
  Playwright 의 `screenshot({mask})` 는 iframe 안을 못 가려서 CSS 주입 방식을 택했다. 시나리오 공통 + 항목별(`maskOf`) 합집합.
- **계정 전환 스텝 `switchUser`**: 로그인 로직을 `doLogin(over, label)` / `loginSteps(over)` 로 뽑아 최초 로그인과 공용.
  아이디 칸은 `login.userField` → 없으면 첫 fill, 비번은 셀렉터에 pw/pass 가 든 것 → 없으면 두 번째 fill.
  로그아웃은 `step.logout || login.logoutUrl` 이동 후 `context.clearCookies()`. 팝업이 열려 있으면 닫고 본 창으로 돌아온다.
- **시나리오 검사 `src/lint.js`**: 이름/URL 중복, 필수값 누락, 모르는 action, 평문 비밀번호, expect 없는 메뉴 비율,
  금지 버튼 클릭 스텝, 정규식 오류 등. CLI `lint`(종료코드 2), 실행 시 오류만 로그, `/api/lint`, GUI `✓ 검사` + 저장 전 확인.
- **느린 화면 대응**: `expectTimeout`(핵심 요소 대기, 기본 timeout/2·최소 3초 — 예전엔 1.5초 고정이라 느린 그리드를 놓쳤다),
  메뉴·흐름별 `timeout`(`page.setDefaultTimeout`), `loading`(사라질 때까지 대기), 메뉴 `waitFor`,
  재시도 시 `slowFactor = 시도 회차` 로 모든 대기 시간을 배로. 실패 메시지에 기다린 초를 남긴다.
- **보고서 요약 클릭 필터**: `.sum .f` 클릭 → 표 행과 스크린샷 섹션을 함께 필터(`tr.hide`), 신규 실패 칸도 있음. 해시(`#f=fail`)로 유지.
- **GUI 사이드바**: `☰`/Ctrl+B 접기, `#drag` 로 폭 조절(180px ~ 화면 절반), 더블클릭 기본 폭. localStorage `wwt.asideHidden` / `wwt.asideW`.
- **결함 CSV 열기 방식 변경**(사용자 신고): 앱 창은 Playwright 컨텍스트라 브라우저 다운로드가 제대로 안 된다(네이티브 dialog 와 같은 제약).
  `/api/open { what:'file', dir, name }` 로 **OS 기본 프로그램(엑셀)으로 직접 연다**. 보고서 HTML 안의 링크는 일반 브라우저용으로 그대로 둠.
- 픽스처: `test/switch.json`(계정 전환+마스킹), `test/slow.json`(7초 뒤 그려지는 그리드), mock `/slowgrid` `/logout` + 로그인 쿠키(uid).
  `npm run test:switch` (3/0/0), `npm run test:slow` (3건 중 정상1/실패1/주의1), `npm run lint:test`. gui-check 39 항목.

### 2026-08-28 (3)
- **🔍 메뉴 자동 수집 `discover`** (`src/discover.js`, CLI `discover`, `/api/discover`, GUI 편집 탭 버튼).
  로그인(`scan.js runLoginSteps` 재사용) → 시작 화면부터 `depth` 단계까지 돌며 링크 수집 → `menus[]` 초안.
  `href` 없는 메뉴(`<a href="#" onclick="goPage('/x.do')">`)는 onclick 에서 경로를 정규식으로 뽑는다.
  제외: 외부 origin / 로그아웃·다운로드·엑셀·팝업 / `crawl.exclude` 패턴 / **`forbidden` 에 걸리는 텍스트**.
  이미 시나리오에 있는 URL 은 `dup:true` 로 표시만(GUI 에서 체크 해제된 채로). 이름이 겹치면 뒤에 `(2)`.
  CLI 는 `--append` 일 때만 파일에 쓰고, **원본(raw)에 추가**한다(상속 결과를 복사하지 않게).
  crawl(실행 중 자동 순회)과는 목적이 다르다 — crawl 은 실행, discover 는 목록 만들기.
  - **속성 기반 메뉴 지원**(스타벅스 실측으로 추가): uxl/ub 는 `<a href="#none" menuurl="VOC1001" menupath="VOC 업무>전체 VOC">` 처럼
    href·onclick 이 전혀 없다(클릭 핸들러를 JS 로 바인딩). 그래서 요소·부모의 사용자 정의 속성을 전부 걷어 와서
    `urlFromAttrs()`(이름에 url/link/page 가 든 속성 우선 → 경로처럼 보이면 그대로, 화면ID 처럼 보이면 규칙으로 변환) /
    `nameFromAttrs()`(`>` 가 든 path 속성 → "대메뉴 > 소메뉴") 로 판단한다.
    규칙은 `--pattern "/screen/{}.ub"` 또는 **기존 menus URL 에서 자동 추론**(`inferPattern` — 코드 모양까지 같이 추론해서
    `menuid="MENU0500"` 같은 다른 코드에 속지 않게 한다).
  - 실측(2026-08-28, 스타벅스 dev-ivoc 8888): 포털 한 화면에서 메뉴 54개 수집, 전부 기존 시나리오와 일치(새 것 0),
    ⚠ 표시 4건은 삭제/마감/발송 등 forbidden 단어. 시나리오에만 있는 결재관리 3개(APP0001/0005/0008)는 test01 메뉴트리에 없음.
  - 실측(2026-08-29, 우리은행 localhost:18081): `<a href="#" data-menu-url="vocInterestList" data-menu-nm="...">` 슬러그형.
    메뉴 69개 수집(기존과 64개 일치), 새 것 5개는 전부 개발용 화면(`/AAA` `/genGrid` `/viewTest` `/top1` `/top2`),
    ⚠ 8건은 결재/통보/실행/연장 — 사용자 시나리오에는 "(조회만)" 으로 들어 있는 것들.
  - 이 과정에서 고친 것 3가지:
    1) **로그인 재시도 공용화** — `scan.js loginWithRetry()` (success 판정 + `login.detect` + `login.retries` + `login.after`).
       discover/scan 이 runner 와 달리 재시도를 안 해서 wrb AJAX 로그인 경합에 그대로 걸려 "로그인 화면"을 긁고 있었다.
    2) **슬러그 속성 지원 + 오탐 방지** — 규칙(shape)은 이름에 url/link/page 가 든 속성이나 화면ID 형태 값에만 적용
       (`data-click="showThirdMenu"` 를 주소로 착각하던 문제).
    3) **forbidden 단어 메뉴는 버리지 않고 `danger` 표시** — 조회만 하면 되는 "결재 목록" 류를 통째로 놓치던 문제.
       CLI 는 기본 제외(`--include-danger` 로 포함), GUI 는 체크 해제 상태로 보여 준다.
  - 메뉴 계층 이름(`대 > 중 > 소`)은 `ul>li` 트리일 때만 만들어진다(스타벅스는 menupath 속성, wrb 는 li 구조가 아니라 단일 이름).
  - **SKIP 규칙 완화**(wrb 실측): `excel|download|popup` 을 URL 어디서나 찾으면 `/excelLog`(엑셀다운로드이력)·`/mgmtExcelUpload`
    같은 **정상 화면**이 사라진다. 이제 "마지막 경로 조각이 그 단어일 때"와 파일 확장자만 제외하고, 텍스트로는 로그아웃만 본다.
  - wrb 시나리오(`scenarios/기본/wrb-voc.json`)의 `crawl.exclude` 에 개발용 화면 제외 패턴 추가(2026-08-29, 사용자 요청):
    `/AAA$` `genGrid` `viewTest` `/top[12]$`. `/AAA` 는 **메뉴 7개가 공유하는 미설정 URL**(일일 고객의소리 현황, 대외민원접수부,
    대외민원종결부, 행내VOC종결부, 직원별업무처리현황, 중요증서 관리표, 고객보상처리현황) — 메뉴 테이블에 URL 이 안 채워진 상태.
    적용 후 재수집 결과: 66개 수집 / 새 것 0 / 제외 11.
- **버그 수정**: 증적 탭을 보는 중에 사이드바에서 시나리오/폴더를 바꿔도 목록이 그대로였다.
  `select()`/`selectDir()` 는 runTarget 만 바꾸고 `loadReports()` 를 부르지 않았고, `tab('reports')` 는 탭 전환 때만 부르기 때문.
  → `refreshReports()`(증적 탭이 열려 있을 때만 다시 그림)를 두 곳 + 실행 완료(`done`) 이벤트에 추가.
- `test/gui-check.mjs` 28 항목으로 확장(수집·증적 탭 자동 새로고침 포함).

### 2026-08-28 (2)
- **재시도(flaky)**: `runner.withRetry(attempts, label, runOnce)` — 실패하면 그 항목만 다시 실행. push 는 `capture` 에 모아 두고
  확정된 시도만 `emit`(로그·진행률·onResult). 나중 시도에서 정상이면 `flaky:true` + status='warn' + 1차 실패 사유를 이슈로,
  **증적은 1차 실패 시점 스크린샷을 물려준다**(성공 화면은 의미 없고, 안 물려주면 고아 파일이 남는다).
  `sc.retry`(기본값) / `menu.retry`(덮어쓰기) / `flow.retry`(CRUD 는 기본값 무시 — 데이터 생성 위험).
- **소요시간·느린 화면**: `begin()` 에서 `itemStart` 리셋, `finalize()` 에서 `r.ms` 계산. `sc.slowMs` 초과 시 ⚠️.
  보고서에 `초` 칸 + 총 소요 + 오래 걸린 화면 TOP5. compare 에 `slower`(2배 이상 & 1초 이상 증가)도 추가.
- **깨진 화면**: `checks.js inspectLayout()` — 보이는 `<img>` 중 `complete && naturalWidth===0` → ⚠️, `scrollWidth > clientWidth + slack` → ⚠️.
  `sc.checks = { images: true, layout: false, layoutSlack: 50 }`. layout 은 오탐이 많아 기본 꺼짐. 에러 페이지(fail 있는 화면)에서는 검사 생략.
- **증상 분류(triage)**: `src/triage.js` 규칙 배열(위에서 먼저 걸리는 것이 이김). `emit()` 에서 `r.triage = {type, why}`.
  보고서 표 `분류` 칸(색 태그, title=근거) + 총평 집계 + `report.json.triage`.
- **결함 CSV**: 증적 폴더에 `defects.csv`(UTF-8 BOM, ❌·⚠️ 만). GUI 실행 결과·증적 탭에 링크. 서버 MIME 에 `.csv` 추가.
- `writeReport` 가 `summary`(총평 줄 배열)를 돌려주고 runner/batch 가 그대로 로그로 찍는다 (예전엔 md 를 slice 해서 찍다가 줄이 늘자 깨졌음).
- GUI 편집 탭 "안정성 · 성능" 줄(재시도 / 느린 화면 기준(초) / 깨진 이미지 / 가로 스크롤), 실행 결과 표에 `분류`·`초` 칸.
- 픽스처: `test/checks.json` + mock 서버 `/broken` `/slow` `/flaky`(첫 요청만 500, `?reset=1`), `npm run test:checks`.
- GUI 검증 스크립트를 저장소로: `test/gui-check.mjs` (23 항목).

### 2026-08-28
- **직전 실행 비교** (`src/compare.js`): 실행이 끝나면 같은 폴더의 같은 시나리오(일괄은 같은 폴더의 일괄) 중 가장 최근 증적을 기준으로
  신규 실패 / 해결 / 그대로 실패 / 신규 항목 / 이번 실행 제외를 계산해 보고서 상단·표의 "변화" 칸·`report.json.compare` 에 남긴다.
  기본 켜짐. 끄기: GUI 체크박스, CLI `--no-compare`. 기준 지정: `--compare <증적폴더>`.
  - 기준에서 제외: 로그인 실패로 끝난 실행(`abortedRun`), 일부만 돌린 실행(`report.json.partial` — only/onlyList 사용 시 기록).
    이걸 안 했을 때 "직전 = 로그인 실패한 실행" 이라 전 항목이 신규 실패로 나오는 것을 실제로 겪음.
  - 비교 키: 결과 이름. 상세 항목(`↳ 메뉴 상세 #1 (행 텍스트)`)은 괄호를 떼고 비교(`cmpKey`), 같은 이름이 여러 개면 ` 순번` 을 붙여 구분.
- **실패건만 재실행**: `failedTargets(report.json)` → 이름 목록 → `runScenario(opt.onlyList)` (정확히 일치하는 항목만).
  상세 실패는 부모 메뉴 이름으로 되돌리고, 로그인 항목은 제외. 일괄은 `runBatch(opt.onlyMap)` 로 시나리오 단위로 건너뛴다.
  GUI: 실행 탭 체크박스 + 증적 탭 각 줄 "↻ 실패만 재실행"(그 증적 기준). CLI `--rerun-failed [증적폴더]`.
- **공통 설정 상속 `extends`** (`src/scenario.js`): 문자열/배열, 자기 파일 기준 또는 scenarios 기준 경로, 객체 깊은 병합·배열 교체,
  `menusAdd/menusExclude/crudAdd/crudExclude`, 순환 검사. 실행·녹화·필드수집·목록은 해석된 값을, 편집 탭은 원본을 쓴다.
  - GUI 편집 탭: 🔗 상속 배너, 폼에는 **resolved(실행값)** 을 채우고 저장할 때 부모와 같은 값은 빼서 상속 유지(`window._base`).
    로그인은 폼이 표준 형태로 다시 만들기 때문에 핵심 값만 비교(`normLogin`).
  - 경로 제한: scenarios 폴더 안 **또는 그 시나리오 자신의 폴더 안**. (root 만으로 막았더니 `test/extends` 픽스처가 안 돌아감)
- **시나리오별 매트릭스**: 일괄 실행에서 항목 이름이 2개 이상 겹치면 합산 보고서에 행=항목 / 열=시나리오 표를 그린다.
  시나리오의 `blocked`(정규식 배열)에 걸린 증상은 🚫(권한 차단)로 구분 표시. `report.json.matrix`.
- CLI 단일 실행 증적도 이제 시나리오와 같은 폴더 구조(`reports/<프로젝트>/<폴더>/`)에 남는다 (GUI 와 동일. `--out` 주면 그대로).
- `writeReport(results, outDir, scenario, extra)` — extra: `{ compare, matrix, partial }`.
- 픽스처 추가: `test/extends/` (`_공통.json` + 자식 2개) → `npm run test:batch`.

### 2026-08-27
- **⏺ 녹화 모드** 신설 (`src/recorder.js`, GUI 편집 탭 두 버튼, CLI `record`). 기록: goto/click(+waitForLoad)/dblclick/fill/select/check/press/frame·mainFrame/popup·closePopup/expectDialog. 툴바: 요소 확인(expectVisible)/선택 텍스트 확인(expectText)/캡처/종료. 셀렉터 우선순위 id→name→속성→짧은 텍스트→CSS 경로. `_text/_warn/_note` 참고 키.
  - 잡은 버그: context `page` 이벤트가 `newPage()` 에도 발생(핸들러 이중 부착) / 입력란 Enter 의 폼 자동제출 클릭(`e.detail===0`) 중복 기록 / runner `press` 대상 없을 때 예외 / CRUD 실패 시 path 비어 있던 것.
- **프로젝트/폴더 구조**: `scenarios/<프로젝트>/<폴더>/`. 헤더에 프로젝트 선택·＋새 프로젝트·⋯. 사이드바는 현재 프로젝트 안만, 슬라이드 접기/펴기(localStorage `wwt.collapsed`, `wwt.project`). 폴더/프로젝트 단위 일괄 실행(`src/batch.js`, `/api/run {dir}`), 합산 보고서. 기본 프로젝트 `기본` 자동 보장 + 최상위 파일 자동 이동. 이동/복사 `/api/move` + `moveDialog`. 편집 탭 저장 위치/파일명 → 이동 또는 복사본.
- **증적 탭**: 시나리오 경로 구조대로 저장, 선택한 시나리오/폴더 것만 표시(“전체 보기” = 프로젝트 전체). `report.json.file` 로 매칭, 옛 증적은 폴더+이름으로.
- 편집 탭 설정 카드 접기/펴기(`wwt.cards`).
- 네이티브 dialog 전부 자체 다이얼로그로 교체 (위 주의점).
- 문서: 가이드 §0 구조·§2-8 녹화, 도움말 탭, README, CLAUDE.md. 반입 zip `dist/wigo-web-tester-win-20260827.zip` (37MB, --no-scenarios) 재생성.

### 2026-08-25 (요약)
- 도구 신설 및 GUI 화, WIGO WEB TESTER 로 명명, 반입 번들, `{{password}}` 보안, 증적 캡처 3단계, `detail`(목록→상세), `inputs`(조회 조건 공통/메뉴별 + 화면에서 필드 가져오기), 진행률, `ignore`, `login.detect/retries/after`, `errorStatus/errorPatterns`, `onScreen`, 스타벅스(jqGrid)·우리은행(toastUI) 시나리오로 라이브 검증.

## 6. 남은 일 / 아이디어
- `--browser`(Chromium 동봉) 번들은 안 만든다(미서명이라 보안에 불리). `browsers/` 폴더는 삭제됨. Linux/mac 런타임 미검증.
- 녹화의 중첩 iframe(이름 없는 2단 이상)은 runner 가 selector 로 못 들어감 → name 있는 프레임만 확실.
- 스타벅스 시나리오는 `scenarios/스타벅스/`, 우리은행은 `scenarios/기본/wrb-voc*.json` + `scenarios/우리은행VOC/`. (일부는 아직 `기본/` 에 있음 — 옮기는 건 사용자 몫)
- 순회 속도 전역 기본은 `config.json` = `느림`. 개별 시나리오가 다시 pin 하면 그 값이 이긴다. 프리셋 값 조정은 `src/config.js` SPEED_PRESETS.
- **`config.json` 의 `reuseSession: true`** (2026-08-31, 사용자 요청 "모든 시나리오 다 켜줘") — 전역 기본이 켜짐이라 **모든 프로젝트·시나리오가 로그인 세션을 재사용**한다(시나리오 75개 전부 확인). 끄려면 ⚙ 전체 설정에서 해제하거나, 특정 프로젝트·시나리오만 `reuseSession:false`. 자체 검증은 `--no-config`/`WWT_NO_CONFIG=1` 이라 영향 없음.
- 스타벅스 상세 005: 클릭한 행과 캡처된 상세 VOC번호 불일치(별건, 사내망 필요).
