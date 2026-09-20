# 04_QA시나리오 — QA팀 기능 명세 TC 자동화

원본: 내부 QA팀 `스타벅스 코리아 — Admin 기능 명세서 (상세)` (`starbucks_voc/QA 관련/260916/`, TSV 덤프).
이 폴더의 시나리오는 그 TC 를 wigo-web-tester 로 실행 가능한 형태로 옮긴 것이다. **TC_ID ↔ 시나리오 항목** 대응은 `_TC매핑.csv` 가 정본.

## ⚠️ TC 번호가 두 벌이다 (2026-09-20 확인)

| 문서 | 건수 | 이 폴더에서의 위치 |
|---|---|---|
| `시나리오.md` (2026-09-01) | 1,986 | **아래 `00_`~`04_` 폴더가 이 번호로 작성됨** |
| `test.md` (2026-09-16) | 1,989 | **정본.** `VC_TC_088`·`VC_TC_727`·`VC_TC_1861` 3건이 삽입되어 이후 번호가 +1/+2/+3 밀림 |

1,989건 중 **1,899건의 번호가 밀렸다.** 같은 번호가 다른 TC 를 가리키므로 주의 —
예: `VC_TC_445` 는 구문서 "분류 자동완성", 신문서 "My VOC 파트너검색 팝업 확인".

**→ 2026-09-20 에 이 폴더의 모든 파일을 신번호로 재번호했다.** (항목명·주석 토큰 133개, 8개 파일)
이제 이 폴더 안의 `VC_TC_nnn` 은 전부 **test.md(260916) 기준**이다.
구번호와의 대조가 필요하면 `_TC매핑.csv` 의 `TC_ID`(신) ↔ `구번호(시나리오.md)` 열을 본다.

> ⚠️ 재번호로 항목명이 바뀌었으므로 **재번호 이전 실행 결과와의 "직전 실행 비교"(신규 실패/해결)는 한 번 어긋난다.**
> 재번호 후 첫 실행은 전체를 새로 기준 삼는다고 보면 된다.

재번호 스크립트: `starbucks_voc/tools/qa_renumber_tc.py` (dry-run 기본, `--apply` 로 적용).
QA 문서가 또 갱신되면 같은 방식으로 돌린다.

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
| `09_결함회귀_260916/` | **QA 260916 기준 TO-BE DEV FAIL 40건**(Major 24 / Minor 16) 회귀 검증. **신번호(test.md) 기준.** 데이터를 바꾸는 흐름을 사용자 승인 하에 `allowForbidden` 으로 포함했으므로, 돌리기 전 그 폴더 README 의 "🔴 실행 전 반드시 볼 것" 을 읽을 것 | 40건 |

> **진행 상태 (2026-09-20)**: 위 표는 설계안이고, 실제로 만들어진 것은
> `00_로그인_대시보드`, `01_VOC업무`(my-voc·store-req-share·voc-all-list·voc-register), `02_VOC조회`(vital-few), `04_CE`(ce-opinion-view), `09_결함회귀_260916` 뿐이다.
> `03_스토어케어`·`05_통계`·`06_VOC설정`·`07_VOC컨텐츠`·`08_시스템관리`·`_보류_CRUD` 는 **미작성**.
> 전체 1,989건 중 자동화 상태: **결함회귀 40 / 기존 116 / 미작성 1,833** — 내역은 `_TC매핑.csv`.
> 위 표의 "TC 범위" 는 구번호 기준 설계값이라 신번호와 최대 3 씩 어긋난다(폴더 구분 용도로만 본다).

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
`TC_ID,구번호(시나리오.md),1Depth,2Depth,3Depth,TO-BE DEV 결과,결함등급,자동화,파일,항목명,비고` (UTF-8 BOM, 1,989행).
- `TC_ID` = **test.md(260916) 신번호가 정본**, `구번호` = 시나리오.md(260901) 번호. 빈 칸이면 260916 에 새로 추가된 TC.
- `자동화` = `결함회귀`(09_ 폴더에서 검증) / `기존(구번호)`(00_~04_ 폴더에 있으나 항목명이 구번호라 재번호 필요) / `미작성`.
- 생성 스크립트: QA 문서 두 벌을 Procedure+기대결과 내용으로 정렬해 구↔신 번호를 대조한다. QA 문서가 갱신되면 다시 생성할 것.

## 알려진 전제
- QA 문서 기대값(셀렉트 항목 목록 등)은 **운영 코드 기준**이다. dev DB 코드가 다르면 ❌ 가 나도 결함이 아니라 데이터 차이일 수 있다 → 보고서에서 "옵션 누락 … 실제: …" 문구로 비교.
- 로그인 오류 TC 는 계정 잠금 방지를 위해 **존재하지 않는 아이디**로 검사(비밀번호 오입력 반복 금지).
- 홈 대시보드 = `POR1001`(포털 탭 안 iframe). 직접 URL 로 진입한다.
