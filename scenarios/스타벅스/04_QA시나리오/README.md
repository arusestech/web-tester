# 04_QA시나리오 — QA팀 기능 명세 TC 자동화

원본: 내부 QA팀 `스타벅스 코리아 — Admin 기능 명세서 (상세)` (`output/260916/시나리오.md`, TSV 덤프, **VC_TC_001 ~ VC_TC_1986**, 1,986건).
이 폴더의 시나리오는 그 TC 를 wigo-web-tester 로 실행 가능한 형태로 옮긴 것이다. **TC_ID ↔ 시나리오 항목** 대응은 `_TC매핑.csv` 가 정본.

## 실행
```
run.bat scenarios\스타벅스\04_QA시나리오 --headless --secret password=<test01 비번>     # 전체 일괄 (보류 폴더 제외)
run.bat scenarios\스타벅스\04_QA시나리오\01_VOC업무\voc-all-list.json --only VC_TC_117     # TC 하나만
run.bat lint scenarios\스타벅스\04_QA시나리오                                              # 문법·금지버튼 검사
```
계정 `test01`(시스템관리자). 접속 URL 은 `../_project.json` 상속(dev-ivoc:8888). 실행 결과의 `defects.csv` 항목명 앞 TC_ID 로 QA 문서 행을 찾는다.

## 폴더
| 폴더 | QA 1Depth | TC 범위 |
|---|---|---|
| `00_로그인_대시보드/` | VOC 로그인, 홈 대시보드 | 001~017 |
| `01_VOC업무/` | VOC 업무 (VOC등록·전체 VOC·My/Team·업무요청·매장) | 018~744 |
| `02_VOC조회/` | VOC 조회 (Vital Few·칭찬 파트너·삭제 VOC) | 745~952 |
| `03_스토어케어/` | 스토어 케어 | 953~1010 |
| `04_CE/` | CE | 1011~1092 |
| `05_통계/` | 통계 | 1093~1161 |
| `06_VOC설정/` | VOC 설정 | 1162~1516 |
| `07_VOC컨텐츠/` | VOC 컨텐츠 | 1517~1778 |
| `08_시스템관리/` | 시스템 관리 | 1779~1986 |
| `_보류_CRUD/` | 등록·수정·삭제·저장·발송 등 **데이터를 바꾸는 흐름**. `_` 접두라 목록·일괄에서 제외. 사용자가 내용을 확인하고 폴더명의 `_` 를 떼거나 파일을 옮겨 실행한다 | 전 영역 |

## 작성 규약 (이 폴더 전용)
1. **파일**: `{ "extends": "../_공통.json", "name": "QA <2Depth명>", ... }`. baseUrl/login/browser 는 쓰지 않는다(상속). 한 파일 = QA 2Depth 하나(큰 화면은 목록/상세로 분할).
2. **항목 이름은 반드시 `VC_TC_nnn ` 로 시작** — 보고서·defects.csv 에서 TC 로 역추적하기 위해. 여러 TC 를 한 항목이 덮으면 `VC_TC_121~124 진행단계 필터`, 띄엄띄엄이면 `VC_TC_112,120 …`. 파일 안에서 항목 이름 중복 금지(lint 가 잡음).
3. **무엇을 어디에**
   - 화면 진입 + 핵심 요소 → `menus[]` (`url: /screen/<ID>.ub`, `expect`). 조회 화면은 `inputs`/`search` 로 조회까지.
   - 버튼 눌러 팝업/동작 확인(데이터 변경 없음) → `menus[].actions[]` (`click`, `expect`, `expectText`, `expectDialog`, `popup:true`).
   - 셀렉트 항목·기본값·활성/비활성·필수값 알림·필터 결과 등 **판정 로직이 필요한 것** → `crud[]` 흐름 + `eval`(조건 불일치 시 `throw new Error('...')`).
   - 데이터를 바꾸는 흐름(등록/수정/삭제/저장/발송/마감/업로드) → `_보류_CRUD/<영역>.json` 에 `crud[]` 로. 눌러야 하는 금지 버튼은 `allowForbidden` 에 명시, 테스트 데이터는 `{{qaPrefix}}_{{now}}` 접두. **삭제·발송·마감은 등록한 TEST_QA 데이터에 대해서만.**
   - 자동화 불가(마우스오버 툴팁, 엑셀 파일 내용, 입력 가능 문자/최대 byte, 페이지 이동 UI, 스크롤, 세션 만료 대기, 외부 사이트 내용, 실데이터 값 대조) → 시나리오에 넣지 않고 `_TC매핑.csv` 에 `수동` + 사유.
4. **셀렉터는 소스 JSP 에서 확인한 것만** 쓴다. 화면 = `WebContent/WEB-INF/jsp/meta/<mod>/<ID>R00.jsp`(마크업·id) + `app/standard/<mod>/<ID>.jsp`(스크립트·그리드·팝업 호출). 팝업 = `page/js/popup.js` → `uxl.openWindow`(**window.open, 새 창**) → 스텝 `click` 에 `"popup": true`, 끝에 `closePopup`. 알림은 `uxl.showMessage`/`alert`/`confirm` = **네이티브** → `expectDialog`. 단 `uxl.error(...)`(로그인 오류 등)는 **레이어**라 `expectText`.
5. **이 프레임워크의 버튼 마크업** `<span id="btnX" class="ub-control button"><a href="#none" title="...">글자</a></span>` → 클릭 셀렉터 `#btnX a`. 조회 버튼 id 가 화면마다 다름(`searchBtn`/`search`/`btnSearch`/`Search`/`SEARCH`). jqGrid: 컨테이너 `#list`, 데이터 행 `#list tr.jqgrow`(더블클릭 상세), 그리드 클래스 `table.ui-jqgrid-btable` 는 데이터가 있어야 생김.
6. **셀렉트 항목 검사 eval 관용구**
   `(()=>{const o=[...document.querySelectorAll('#CD_VOC_STTUS option')].map(x=>x.text.trim());const need=['전체','접수대기','처리중','처리완료'];const miss=need.filter(n=>!o.includes(n));if(miss.length)throw new Error('옵션 누락: '+miss.join(',')+' / 실제: '+o.join('|'));})()`
   기본값: `document.querySelector('#X').value===''` · 비활성: `.disabled` · 표시/숨김: `el.offsetParent!==null` · 그리드 건수: `document.querySelectorAll('#list tr.jqgrow').length` · 그리드 컬럼값 전부 일치: `[...rows].every(r=>r.textContent.includes('처리중'))`.
7. **필터 결과 검증**은 "선택값 = 그리드 해당 컬럼값" 로 한다. 컬럼 위치는 `app/standard` JSP 의 `colModel` 순서(+ jqGrid 는 첫 td 가 rn/체크박스일 수 있음 — `td[aria-describedby="list_컬럼명"]` 셀렉터가 안전).
8. 각 항목·흐름 앞뒤로 `screenshot` 스텝을 넣지 않아도 된다(실패 시 자동 캡처). 확인용 상태 캡처만 `{ "action": "screenshot", "name": "..." }`.
9. 개인정보가 보이는 화면(고객정보·상세)은 파일에 `"mask": ["td[aria-describedby$='NM_CSTMR']", "#DS_CSTMR_CTTPC", ...]` 로 가린다.
10. `_comment_*` 에 근거(파일:줄)·가정·알려진 결함을 적는다. 검증 전 값이라 실행 후 셀렉터 오탐(❌ 핵심 요소 없음/버튼 없음)은 시나리오 오류로 보고 고친다.

## _TC매핑.csv
`TC_ID,1Depth,2Depth,3Depth,자동화,파일,항목명,비고` (UTF-8 BOM).
자동화 = `자동`(그대로 판정) / `부분`(진입·동작은 자동, 값 대조는 사람이 캡처 확인) / `보류(CRUD)`(_보류_CRUD 에 있음, 사용자 승인 후 실행) / `수동`(자동화 안 함, 비고에 사유).

## 알려진 전제
- QA 문서 기대값(셀렉트 항목 목록 등)은 **운영 코드 기준**이다. dev DB 코드가 다르면 ❌ 가 나도 결함이 아니라 데이터 차이일 수 있다 → 보고서에서 "옵션 누락 … 실제: …" 문구로 비교.
- 로그인 오류 TC 는 계정 잠금 방지를 위해 **존재하지 않는 아이디**로 검사(비밀번호 오입력 반복 금지).
- 홈 대시보드 = `POR1001`(포털 탭 안 iframe). 직접 URL 로 진입한다.
