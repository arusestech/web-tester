# WIGO Web Tester — 웹 메뉴 테스트 + 증적 생성 프로그램

**AI/Claude 없이 단독 실행**되는 데스크톱 프로그램. 시나리오(JSON) 하나로
**로그인 → 메뉴 순회(조회) → 링크 자동 수집 → CRUD 흐름**을 브라우저로 실행하고,
실행마다 **HTML 보고서 + 모든 화면 스크린샷 + md/json** 증적을 폴더 하나에 남긴다.
Windows / Linux / macOS 지원. 폐쇄망에는 **폴더째 반입**하면 설치 없이 실행.

```
WigoWebTester.bat        ← Windows: 더블클릭 (GUI 앱 창)
wigo-web-tester.sh        ← Linux/macOS (최초 1회 chmod +x *.sh bin/*.sh)
node cli.js               ← 스크립트 파일 없이 (반입 번들). 도구 폴더에서 실행하면 GUI 가 뜬다 → "반입 후 실행" 참고
```

## 화면 구성
| 탭 | 기능 |
|---|---|
| ▶ 실행 | 시나리오 선택 → 범위(조회+CRUD / 조회만 / CRUD만) → 실행. 이전 결과와 비교 / 실패건만 재실행 옵션. 실시간 로그, 결과 표, 중단 버튼, 서버 응답 확인 |
| ✎ 편집 | 폼으로 시나리오 작성/수정 (기본·로그인·메뉴 목록·노이즈 무시·CRUD). **🔍 화면에서 메뉴 수집**(로그인 후 링크를 긁어 메뉴 초안), ⏺ 녹화, 상속(extends) 배너. "JSON 직접 편집" 전환 가능 |
| 📁 증적 | 실행 이력 목록 → 보고서 열기 / 폴더 열기 / ↻ 실패만 재실행 / 삭제 |
| 진행률 | 실행 중 상단·창 제목에 `42% (12/28)` + 진행 막대. 터미널은 로그 앞 `[ 42%]` |
| ? 도움말 | 사용 순서, 셀렉터 찾기, CRUD JSON 예 |

## 폐쇄망 반입 (설치 없이 실행)
인터넷 되는 PC에서 한 번:
```
npm install                                          # 최초 1회
node tools/bundle.mjs --no-runtime --no-scripts      # 권장 (~4MB): exe·bat·sh 가 하나도 없는 zip. 대상 PC 에 Node 20+ 정식 설치 필요(Playwright 1.62 요구). 실행은 node cli.js
node tools/bundle.mjs --no-runtime                   # Node 미동봉 + 실행용 .bat 3개 포함 (~4MB)
node tools/bundle.mjs                                # Node 런타임(node.exe, ~90MB) 동봉 — zip 안에 exe 가 들어가므로 반입 심사에서 막힐 수 있다
node tools/bundle.mjs --no-scenarios                 # 시나리오(계정정보) 제외, example.json 만
node tools/bundle.mjs --browser                      # Chromium 까지 동봉 (~230MB, Chrome/Edge 가 전혀 없는 서버·리눅스용)
node tools/bundle.mjs --all                          # win/linux/mac 런타임 전부
```
어느 옵션이든 `node_modules/.bin`, `node_modules` 안 스크립트(.ps1/.sh/.cmd), 시나리오 폴더의 보조 .bat, 대상 OS 가 아닌 런처는 자동으로 빠진다.
`dist/*.zip.sha256`(zip 해시)과 `SHA256SUMS.txt`(내부 파일별 해시, zip 안에도 포함)를 반입 심사용으로 함께 제출한다.

### 반입 후 실행 (스크립트 파일 없이)
`--no-scripts` 번들에는 .bat/.sh 가 없다. 프로그램 본체는 전부 .js 이고 Node 가 실행기다.
1. **Node 확인**: 명령 프롬프트(cmd) 또는 PowerShell 에서 `node -v` → **`v20` 이상**이 나와야 한다(동봉 Playwright 1.62 가 Node 20 미만을 거부. 개발·검증은 v24 로 했다). 없거나 낮으면 사내 소프트웨어 설치 절차로 Node.js LTS(22 또는 24)를 설치한다. 버전이 낮으면 `cli.js` 가 시작 시 오류 메시지를 내고 종료한다.
2. **압축 해제**: zip 을 원하는 폴더에 푼다 (예 `D:\wigo-web-tester`). 경로에 한글이 있어도 된다.
3. **GUI 실행**: 그 폴더에서 명령 프롬프트를 열고
   ```
   cd /d D:\wigo-web-tester
   node cli.js
   ```
   `cli.js` 는 인자가 없으면 GUI 앱 창을 띄운다. `npm start` 도 같은 동작이다(npm 은 Node 와 함께 설치됨).
   **Node 가 동봉된 번들**(`runtime\win\node.exe` 가 있는 zip)이면 설치 없이 그 파일로 실행한다: `runtime\win\node.exe cli.js` (터미널 실행도 `runtime\win\node.exe cli.js run …`).
   폴더에서 바로 여는 법: 탐색기에서 폴더를 열고 주소창에 `cmd` 를 입력해 Enter → 그 폴더에서 cmd 가 열린다.
4. **터미널 실행**: 아래 "터미널 실행"의 `run.bat …` 을 `node cli.js …` 로 바꿔 쓰면 된다. 예:
   ```
   node cli.js run scenarios\프로젝트A\my.json --mode menus --headless
   node cli.js run scenarios\프로젝트A                # 폴더 일괄
   node cli.js lint scenarios\프로젝트A
   ```
5. **더블클릭이 필요하면** 사내 PC 에서 바탕화면 바로가기를 만든다: 대상 `"C:\Program Files\nodejs\node.exe" cli.js`, 시작 위치 = 도구 폴더. 또는 메모장으로 `WigoWebTester.bat` 을 만들어 아래 두 줄을 넣는다(ASCII 만).
   ```
   @echo off
   cd /d "%~dp0" && start "WIGO Web Tester" /min node cli.js
   ```
`.js` 파일을 탐색기에서 더블클릭하면 Node 가 아니라 Windows Script Host 로 열려 오류가 난다 — 반드시 `node cli.js` 로 실행한다.
브라우저는 PC 의 Chrome 또는 Edge 를 자동으로 쓰므로 따로 설치할 것이 없다.

브라우저 선택 순서: 시나리오 `browser.channel` → Chrome → **Edge** → 동봉 Chromium.
Windows 10/11 은 Edge 가 기본 내장이라 **경량 번들이면 충분**하다.

### 보안 관련 설계
- 프로그램은 **외부 통신 없음** (텔레메트리 없음, GUI 서버는 `127.0.0.1` 전용, 폐쇄망에서 `npm install` 등 인터넷 시도 안 함)
- GUI 서버는 시작 때 **임의 토큰**을 만들어 앱 창에만 전달하고, 모든 `/api/*` 요청에서 검사한다 → 다른 로컬 페이지·CSRF·DNS 리바인딩이 조작하지 못함
- 번들에서 백신 오탐 소지가 있는 스크립트(`playwright-core/bin/*.ps1`, `*.sh`, `xdg-open`)는 제거됨 (런타임 미사용). **미서명 Chromium 은 동봉하지 않고** PC 의 Chrome/Edge 만 사용(경량 번들)
- 순회 속도를 **⚙ 설정 → 느림**으로 두면 짧은 시간의 대량 순회가 WAF·IPS 에 스캐닝으로 오인될 확률이 낮아진다
- **비밀번호는 파일에 두지 않는다**: 시나리오에 `"value": "{{password}}"` 로 두면 실행 직전 GUI 팝업(또는 터미널 숨김 입력, `--secret password=…`, 환경변수 `WWT_password`)으로 받아 메모리로만 사용
- 테스트 브라우저는 실행마다 새 컨텍스트 → 쿠키/세션이 디스크에 남지 않음
- 증적 스크린샷에는 화면의 **개인정보가 그대로 찍히므로** 망 내부 보관·제출 시 마스킹 원칙. 실행 탭 "증적 캡처"(모든 화면/실패만/안 찍음)로 전체 범위를 정하고, 개인정보 화면은 메뉴별 `"screenshot": false` 로 고정
- Playwright 는 브라우저를 `--remote-debugging-pipe` 로 띄우므로 EDR 에 "브라우저 자동화"로 보일 수 있음 → 보안팀에 테스트 도구로 사전 신고 권장
- 라이선스: Node.js(MIT) · Playwright(Apache-2.0) · Chromium(BSD)

## 터미널 실행 (CI 등)
`run.bat` / `./run.sh` 는 `node cli.js` 와 같다. 스크립트가 없는 반입 번들에서는 `node cli.js run …` 으로 쓴다.
```
run.bat scenarios\my.json --mode menus --headless      # Windows
./run.sh scenarios/my.json --mode all                   # Linux/macOS
run.bat scenarios\프로젝트A                              # 폴더를 주면 그 아래 시나리오 전부 일괄 실행 → 합산 증적
run.bat record scenarios\프로젝트A\my.json --url /emp/list.do --name "사원 등록" --append   # 브라우저 조작을 녹화해 crud 에 추가
run.bat scan-source D:\source\myproject --out scenarios\프로젝트A\초안.json                 # 소스를 읽어 접속·로그인·메뉴·금지버튼 초안 생성 (서버 불필요)
run.bat scan-source D:\source\myproject --out ... --actions                                # + 조회·검색처럼 안전한 버튼을 눌러 동작까지 검사하는 actions 생성
run.bat discover scenarios\프로젝트A\my.json --url /main.do --depth 2 --append              # 화면의 링크를 긁어 메뉴 목록 초안 생성
run.bat discover ... --pattern "/screen/{}.ub"          # 주소 대신 화면ID가 속성에 있는 프레임워크(uxl 등)
run.bat lint scenarios\프로젝트A                          # 시나리오 사전 검사 (이름 중복·필수값 누락 등)
./run.sh cli                                            # 터미널 대화형 (시나리오 선택/작성)
```
옵션: `--mode all|menus|crud` · `--headless` · `--only <이름>` · `--screenshot all|fail|none` · `--out <폴더>` · `--secret 이름=값` (`{{이름}}` 자리표시자, 환경변수 `WWT_이름` 도 가능)
· `--rerun-failed [증적폴더]` (직전 실행의 ❌·⚠️ 항목만) · `--no-compare` / `--compare <증적폴더>` (직전 실행 비교)
종료 코드: 0 정상 / 2 실패 항목 있음 / 3 치명적 오류

## 두 번째 실행부터 — 달라진 것만 보기
- **직전 실행과 자동 비교**: 보고서 맨 위에 `🆕 신규 실패 2 / ✨ 해결 3 / ➖ 그대로 실패 16`, 표에 "변화" 칸.
  같은 폴더의 같은 시나리오 중 가장 최근 증적이 기준 (로그인 실패로 끝난 실행·일부만 돌린 실행은 기준에서 제외).
  끄려면 실행 탭 "이전 결과와 비교" 체크 해제 또는 `--no-compare`.
- **실패건만 재실행**: 실행 탭 "실패건만 재실행" 체크, 또는 증적 탭 각 줄의 **↻ 실패만 재실행**, 또는 `--rerun-failed`.
  109개 메뉴 중 실패 18개만 다시 → 확인 시간이 크게 준다. 일괄 실행이면 실패가 없던 시나리오는 통째로 건너뛴다.
- **시나리오별 매트릭스**: 폴더/프로젝트 일괄 실행에서 여러 시나리오가 같은 항목을 공유하면
  합산 보고서에 **행=항목 / 열=시나리오(역할)** 표가 붙는다. 권한 테스트 결과를 한 장으로 제출할 때 쓴다.

## 오탐 줄이기 · 증적 다듬기
- **재시도(`retry`)**: 실패한 화면만 다시 실행 → 나중 시도에서 정상이면 ❌ 가 아니라 **⚠️ 불안정(flaky)** 으로 기록(증적은 실패 시점 화면). 서버가 잠깐 느려서 나는 가짜 실패를 걸러 준다
- **소요시간 · 느린 화면(`slowMs`)**: 항목마다 걸린 시간을 재서 표의 `초` 칸과 "오래 걸린 화면 TOP 5" 로. 직전보다 2배 이상 느려진 화면은 `🐢 느려짐` 으로 표시
- **깨진 화면(`checks`)**: 깨진 이미지(기본 켬), 가로 스크롤=레이아웃 깨짐(기본 끔)
- **증상 분류**: ❌·⚠️ 마다 `서버 버그 / 권한·세션 / 안전장치 차단 / 시나리오 오류 의심 / 데이터 부족 / 화면 깨짐 / 느림 / 불안정 / 환경 노이즈` 로 규칙 기반 1차 분류 (AI 아님, 최종 판단은 사람이)
- **결함 목록 CSV**: 증적 폴더의 `defects.csv` — ❌·⚠️ 만 뽑아 엑셀에서 바로 열리는 형식(번호·항목·URL·결과·분류·증상·경로·소요·변화·스크린샷)

## 보고서·화면 사용 팁
- 보고서 위쪽 **전체 / 정상 / 실패 / 주의 / 🆕 신규 실패** 칸을 누르면 그 항목만 보입니다(스크린샷 영역도 함께 걸러집니다). "전체" 로 되돌립니다
- **결함 CSV** 는 앱 창의 브라우저 다운로드가 아니라 **OS 기본 프로그램(엑셀)으로 바로 열립니다**
- 왼쪽 목록은 헤더의 **☰** 또는 **Ctrl+B** 로 접고, 경계선을 **드래그**해 화면 절반까지 넓힐 수 있습니다(더블클릭 = 기본 폭). 폭과 접힘 상태는 기억됩니다
- 편집 탭의 **✓ 검사** 로 저장 전에 흔한 실수(이름 중복·필수값 누락·모르는 동작·평문 비밀번호)를 확인할 수 있고, 저장할 때 오류가 있으면 한 번 더 물어봅니다

## 증적 (실행마다 생성)
```
reports/<프로젝트>/<폴더>/<시나리오명>-<YYYYMMDD-HHMMSS>/   (시나리오와 같은 폴더 구조)
├── report.html        요약 + 직전 실행 비교 + 증상 분류 + 메뉴별 표 + 스크린샷 임베드 (브라우저로 열기)
├── defects.csv        결함 목록 (엑셀에서 바로 열림)
├── report.md / report.json
└── screenshots/       001-로그인.png, 002-메인.png ... (기본: 모든 화면)
```
폴더째 복사/압축하면 제출용 증적이 된다.

## 각 화면에서 자동으로 확인하는 것
- 메인 응답 4xx/5xx
- 톰캣/스프링 에러 페이지 (`HTTP Status 500`, `Exception report`, `Whitelabel`, Java 스택트레이스, SQLException 등) — iframe 내부까지
- JS 예외 → ❌, `console.error` / 4xx·5xx 리소스 / 실패 요청 / 빈 화면 → ⚠️
- `expect` 로 지정한 핵심 요소(테이블/폼/버튼) 표시 여부 → 없으면 ❌
- `alert/confirm` 은 내용 기록 후 자동 수락
- **`forbidden`** 에 해당하는 버튼은 절대 클릭하지 않고 실패로 기록 (실데이터 삭제·발송·결제 방지)
- **`ignore`** 패턴으로 환경 노이즈(CDN 차단, 특정 404, 라이선스 alert 등)를 제외
- 깨진 이미지(로드 실패) → ⚠️ / 가로 스크롤(레이아웃 깨짐, 선택) → ⚠️ / 화면별 소요시간 측정, `slowMs` 초과 시 ⚠️

## 시나리오 JSON 구조
| 키 | 설명 |
|---|---|
| `name`, `baseUrl` | 이름 / 접속 URL (컨텍스트 경로까지, 예 `http://localhost:8080/voc`) |
| `extends` | 공통 설정 상속. `"_공통.json"` 또는 배열. 객체는 깊게 병합, 배열은 교체. `menusAdd`/`menusExclude`(정규식)/`crudAdd`/`crudExclude` 로 목록 가감. 권한 페르소나처럼 계정만 다른 시나리오를 한 벌로 관리할 때 |
| `blocked` | "권한 없음" 으로 볼 증상 정규식 배열(예 `["권한이 없", "403"]`). 매트릭스에서 🚫 로 구분 표시 (상태는 그대로) |
| `retry` | 실패한 화면 재시도 횟수(기본 0). 나중 시도에서 정상이면 ❌ 대신 ⚠️ 불안정(flaky). 메뉴별 `retry` 로 덮어씀. CRUD 흐름은 흐름에 직접 넣은 경우만 |
| `slowMs` | 이 시간(ms)을 넘으면 ⚠️ 느린 화면. 소요시간은 항상 측정·기록 |
| `checks` | `{ images: true, layout: false }` — 깨진 이미지 / 가로 스크롤(레이아웃 깨짐) 검사 |
| `mask` | 스크린샷에서 회색으로 덮을 요소(개인정보). 시나리오 공통 + 항목별을 합쳐 적용, iframe 안까지 |
| `timeout` / `expectTimeout` / `loading` | 느린 화면 대응 — 요소 대기 시간(메뉴별 지정 가능), 핵심 요소 대기 시간, 로딩 표시가 사라질 때까지 대기 |
| 메뉴 `waitFor` | 이 요소가 나타날 때까지 기다린 뒤 판정 (늦게 그려지는 그리드) |
| 스텝 `switchUser` | 흐름 중 계정 전환 — 결재 상신→승인→회신을 한 시나리오로. `login.userField`, `login.logoutUrl` 과 함께 |
| `browser` | `channel`(chrome/msedge/생략=내장 Chromium), `headless`, `slowMo`, `viewport` |
| `evidence.screenshotAll` | 기본 true. false 면 실패 화면만 캡처. 실행 시 `--screenshot`/GUI "증적 캡처" 가 이를 덮어씀 |
| 항목별 `screenshot` | 메뉴·crud 흐름·detail 에 `true`(항상) / `false`(실패해도 안 찍음). 전역 설정보다 우선 |
| `inputs` | 조회 조건: `{ common: { 필드: 값 }, search: "조회버튼" }` — 화면에 같은 이름 입력란이 있으면 채우고 조회 클릭. 메뉴별 `inputs`(덮어쓰기) / `search: false` |
| 메뉴 `detail` | 목록 → 상세 진입: `{ selector, rows, expect, dblclick, popup, frame, back, waitFor }`. 상위 `rows` 건을 클릭해 상세 화면을 `↳ 메뉴 상세 #n` 항목으로 따로 검사 |
| `forbidden[]` | 정규식. 클릭 대상 버튼 텍스트/title 이 매칭되면 클릭하지 않고 실패 처리 |
| `ignore` | `{ console:[], resources:[], dialogs:[], text:[] }` 정규식 — 경고에서 제외할 노이즈 |
| `login` | `url`, `steps`, `success`(`urlContains`/`urlNotContains`/`text`/`selector`). 실패 시 즉시 중단 |
| `menus[]` | `name`, `url` 또는 `steps`(클릭 진입), `expect`(핵심 요소 셀렉터 배열), `detail`(상세 진입), `screenshot` |
| `crawl` | `enabled` 시 `startUrl` 에서 `selector` 로 링크를 모아 같은 origin 링크 방문. `exclude`, `maxPages` |
| `crud[]` | `name`, `steps`, `allowForbidden[]`(이 흐름에서만 금지 해제, 예 `["저장"]`) |

### steps 액션
| action | 필드 | 설명 |
|---|---|---|
| `goto` | `url` | 이동 |
| `click` | `selector` \| `text` \| `role`+`name`, `popup:true` | 클릭. `popup` 이면 새 창을 잡아 이후 조작 대상으로 전환 |
| `fill` / `type` | 대상, `value` | 입력 |
| `select` / `check` | 대상, `value` | 셀렉트 / 체크박스 |
| `press` | (`selector`), `key` | 키 입력 |
| `frame` / `mainFrame` | `name` 또는 `selector` | iframe 진입 / 복귀 |
| `closePopup` | | 팝업 닫고 원래 창으로 |
| `wait` / `waitFor` / `waitForLoad` | `ms` / 대상 / `state` | 대기 |
| `expectVisible` / `expectText` / `expectNotText` / `expectUrl` | 대상 / `text` / `contains` | 검증 |
| `expectDialog` | `text` | 방금 뜬 alert/confirm 메시지 확인 |
| `screenshot` | `name` | 스크린샷 |
| `eval` | `script` | 페이지에서 JS 실행 |
| `note` | 아무 필드 | 주석 (실행 안 함) |

자세한 작성법·소스에서 셀렉터/메뉴 찾는 법: **`docs/시나리오-작성-가이드.md`**. 실제 예제: `scenarios/starbucks-voc.json`.

## 폴더 구조
```
WigoWebTester.bat / wigo-web-tester.sh   GUI 실행 (--no-scripts 번들엔 없음 → node cli.js)
run.bat / run.sh                  터미널 실행 (= node cli.js)
bin/env.*                         Node/브라우저 경로 결정 (동봉 런타임 우선)
cli.js                            진입점 — 인자 없으면 GUI
src/server.js  ui/index.html      GUI
src/runner.js  checks.js  report.js  wizard.js
scenarios/                        시나리오 JSON (git 제외, example 만 포함). <프로젝트>/<폴더>/<이름>.json 으로 정리 — GUI 트리에서 프로젝트·폴더 단위 일괄 실행
reports/                          증적 (실행마다 폴더)
tools/bundle.mjs                  반입용 번들 생성
runtime/  browsers/               번들 시 동봉되는 Node / Chromium
```

## 자체 검증
```
npm run mock      # 가짜 JSP 사이트 (포트 3999) — 별도 터미널
npm test          # test/mock.json → 정상 4 / 실패 4 (일부러 심은 에러) 면 OK
```
