# Claude Code 설정 모음 (웹 메뉴 테스트용)

> 2026-09-19 옛 `D:\ai\webtester\` 최상위에 있던 파일을 이 레포 `setup/` 으로 옮겼다. 표의 `wigo-web-tester\` = 이 레포 루트.

## 구성 (2026-08-22 세팅)
| 항목 | 위치 | 내용 |
|---|---|---|
| Node.js 24 LTS | winget 설치 | Playwright MCP 실행용 |
| Playwright MCP | `%USERPROFILE%\.claude.json` (user 스코프) | `npm i -g @playwright/mcp` 전역 설치 후 `"C:\Program Files\nodejs\node.exe" %APPDATA%\npm\node_modules\@playwright\mcp\cli.js --browser chrome` — PATH 무관하게 절대경로로 실행, 설치된 Chrome 사용, 모든 프로젝트 공통 |
| 전역 규칙 | `%USERPROFILE%\.claude\CLAUDE.md` | 메뉴 테스트 절차·보고 형식 |
| 프로젝트 템플릿 | `setup\CLAUDE.md.template` | 프로젝트별 URL/계정/메뉴/금지행위 |
| 단독 실행 테스터 | `wigo-web-tester\` | **Claude 없는 환경용 데스크톱 프로그램.** `WigoWebTester.bat`/`wigo-web-tester.sh` 더블클릭 → GUI 앱 창. 시나리오(폼 편집 또는 JSON)로 로그인→메뉴 조회→링크 자동수집→CRUD 실행(범위 선택), 실행마다 `reports/<이름>-<시각>/` 에 HTML 보고서+스크린샷 증적. `node tools/bundle.mjs` 로 Node+Chromium 동봉 zip 을 만들어 폐쇄망 반입 (자세한 건 `wigo-web-tester\README.md`, 작성법은 `wigo-web-tester\docs\시나리오-작성-가이드.md`). 2026-08-27: 프로젝트/폴더 구조·⏺ 녹화·일괄 실행 추가. **Claude 인수인계·변경 이력은 `wigo-web-tester\docs\HANDOVER.md`** |

## 새 프로젝트에 적용하는 법
1. `setup\CLAUDE.md.template` → 프로젝트 루트에 `CLAUDE.md` 로 복사, `{{ }}` 채우기
   - 비번 등 민감정보는 `CLAUDE.local.md`(자동 gitignore 대상)에 두는 것을 권장
2. 인텔리제이에서 프로젝트 열고 Claude Code 실행
3. 메뉴 목록이 없으면: `소스 읽어서 CLAUDE.md 메뉴 구조 표 채워줘`
4. 테스트 실행 예:
   - `서버 띄우고 모든 메뉴 한 번씩 열어서 에러 정리해줘`
   - `사원관리 메뉴 조회→등록→수정→삭제 흐름 테스트해줘`
   - `급여 메뉴만 다시 확인해줘`

## 확인/문제 해결
- MCP 상태: `claude mcp list` → `playwright … √ Connected` 이어야 함
- 세션 안에서 `/mcp` 로도 확인 가능
- 프로젝트 세션에서 playwright 못 찾으면: 그 세션을 껐다 켜기 (MCP는 세션 시작 시 로드됨). 그래도 안 되면 `claude mcp list` 결과를 확인
- 패키지 업데이트: `npm update -g @playwright/mcp`
- 브라우저 창을 보면서 하고 싶으면 기본이 headed 모드. 안 보이게 하려면 `--headless` 추가:
  `claude mcp remove playwright -s user` 후
  `claude mcp add --scope user --transport stdio playwright -- "C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@playwright\mcp\cli.js" --browser chrome --headless`
