# 스타벅스_로컬목업 — 사외(외부) PC 로컬 기동 확인용

사외 개발 PC 에서 **앱을 로컬에 띄워 놓고** QA 결함 40건 회귀를 돌리기 위한 프로젝트다.
시나리오 본문은 복제하지 않고 `스타벅스/04_QA시나리오/09_결함회귀_260916/` 을 `extends` 로 그대로 쓴다.
이 폴더가 바꾸는 것은 **접속 주소와 stub 뿐**이다.

```
09_결함회귀_260916/*.json   ← 얇은 래퍼 5개 (extends 로 본문 상속)
_project.json               ← baseUrl = http://localhost:8080/voc, stubServer ON
```

## 왜 별도 프로젝트인가

web-tester 는 `--base-url` 옵션이 없고 접속 주소를 **프로젝트 폴더의 `_project.json`** 이 정한다.
그래서 같은 시나리오를 다른 주소로 돌리려면 프로젝트를 나눠야 한다 (SCBK 의 `SIT_IF제외 / SIT_IF포함 / 로컬목업` 과 같은 구성).

| 프로젝트 | 대상 | stub |
|---|---|---|
| `스타벅스/` | 사내 개발서버 `dev-ivoc:8888` | OFF |
| `스타벅스_로컬목업/` | **사외 로컬** `localhost:8080/voc` | **ON** |
| `스타벅스_내부/` | 내부망(반입 후 주소 교체) | OFF |

## 🔴 돌리기 전 — 앱을 먼저 띄워야 한다

현재 이 PC 에는 **8080 에 아무것도 떠 있지 않다.** 시나리오만으로는 못 돈다.
(`hosts` 에 `127.0.0.1 local-ivoc… dev-ivoc…` 가 있어 `dev-ivoc` 도 로컬을 가리키지만, 역시 기동돼 있어야 한다.)

### 준비물 점검 (2026-09-20 확인)

| 항목 | 상태 | 비고 |
|---|---|---|
| JDK 21 | ✅ `D:\source\java\jdk-21` | PATH 기본 java 는 1.6 이라 `JAVA_HOME` 지정 필수 |
| Tomcat 11.0.22 | ✅ `D:\source\tomcat\apache-tomcat-11.0.22` | webapps 비어 있음(ROOT/manager 만) |
| `voc.war` (local 빌드) | ✅ `build-gradle\libs\voc.war` (2026-09-19, 192MB) | 안의 `local-db.properties` 가 `s3.moara.org:33906` 를 가리킴 = local 빌드본 |
| MySQL `s3.moara.org:33906` | ✅ 접속됨 | **공유 개발 DB** — 아래 경고 참고 |
| **Redis `localhost:6379`** | ❌ **없음** | **유일한 실질 블로커.** 포터블 `redis-server.exe` 를 내려받아야 함 |

### 기동 순서

```powershell
# 1) Redis (없으면 모든 요청이 멈춘다 — Spring Session + Redis)
redis-server.exe --port 6379 --save "" --appendonly no

# 2) WAR 배포 (이미 빌드돼 있으면 복사만)
Copy-Item D:\source\IdeaProjects\STARBUCKS-VOC-MASTER\build-gradle\libs\voc.war `
          D:\source\tomcat\apache-tomcat-11.0.22\webapps\voc.war

# 다시 빌드해야 하면
# $env:JAVA_HOME="D:\source\java\jdk-21"; .\gradlew war -Penv=local -x jspc

# 3) Tomcat bin\setenv.bat 에 프로파일 지정 (없으면 사내 Valkey 로 붙으려다 멈춤)
#    set "CATALINA_OPTS=%CATALINA_OPTS% -Dspring.profiles.active=local"
$env:JAVA_HOME="D:\source\java\jdk-21"
D:\source\tomcat\apache-tomcat-11.0.22\bin\startup.bat      # 스프링 초기화 약 15~16초

# 4) 기동 확인
#    http://localhost:8080/voc/screen/BCO0001.ub → 200 + 로그인 폼
```

### 실행

```powershell
cd D:\private-ai\web-tester
$env:WWT_password = "<test01 비번>"
.\run.bat scenarios\스타벅스_로컬목업\09_결함회귀_260916 --screenshot fail
```

한 건만: `.\run.bat scenarios\스타벅스_로컬목업\09_결함회귀_260916\04_VOC설정.json --only VC_TC_1306`

## ⚠️ 공유 개발 DB 다.

로컬 기동이라도 DB 는 **`s3.moara.org:33906/VOC` 공유 MySQL** 이다. 내 PC 안에서만 도는 게 아니다.
결함회귀 40건 중 **데이터를 바꾸는 8건**(`VC_TC_655·1204·1236·1245·1267·1327·1339·1408·1083`)은 그 공유 DB 에 반영된다.
처음 돌릴 때는 **조회만 하는 것부터** 확인하는 편이 안전하다:

```powershell
# 데이터를 바꾸지 않는 것만 (페이징·편집창·목록·팝업)
.\run.bat scenarios\스타벅스_로컬목업\09_결함회귀_260916\04_VOC설정.json --only VC_TC_1306
.\run.bat scenarios\스타벅스_로컬목업\09_결함회귀_260916\05_컨텐츠_시스템관리.json
```

정리 대상과 각 흐름이 무엇을 바꾸는지는 `스타벅스/04_QA시나리오/09_결함회귀_260916/README.md` 의
"🔴 실행 전 반드시 볼 것" 표에 정리돼 있다.

## 외부연동 — 사외에서는 대부분 막혀 있다

`config.xml` 의 연동 대상은 전부 사내 주소다(`10.x`, `*.istarbucks.co.kr`). 사외에서는 나가지 않는다.

| 연동 | 사외 로컬에서 | 40건에 미치는 영향 |
|---|---|---|
| 첨부 저장(S3) | local 빌드는 `framework.aws.s3.enabled=false` → **로컬 디스크** 저장 | 없음. 업로드 TC(099·651·1427) **돌아간다** |
| OpenSearch | `ElasticUtil` 이 SQL `format=jdbc` 응답만 파싱 → 사외 ES 로는 ES 조회 화면 동작 안 함 | 40건에는 ES 화면이 없다(전체 VOC·공지·지식은 대상 밖) |
| CTI / MSR / 홈페이지 / EP / 메일 | 접속 불가 | 40건은 대부분 DB 만 쓴다. 화면 진입 시 연동 호출이 있으면 그 화면만 느려지거나 경고가 뜰 수 있음 |

`_project.json` 의 `stubServer` 를 **ON** 으로 켜 두었다(앱이 같은 PC 에 있어야 stub 이 의미가 있다).
다만 **앱이 stub 을 부르게 하려면 `config.xml` 의 `external.system.*` URL 을 `localhost:9900` 으로 바꿔야 한다.**
바꾸지 않으면 stub 은 떠 있어도 아무도 부르지 않는다 — 40건은 그래도 대부분 돌아가므로,
먼저 그냥 돌려 보고 연동 때문에 막히는 화면이 나올 때 그 키만 바꾸는 쪽을 권한다.

앱만 붙여 손으로 확인하고 싶으면 stub 을 단독으로 띄울 수 있다:
```powershell
.\run.bat stub scenarios\스타벅스_로컬목업\09_결함회귀_260916\01_대시보드_VOC업무.json
```

## 🔎 2026-09-20 전수 실행 결과 (40건)

기동은 정상(로그인 200, `readyz` = DB UP / Redis UP). 일괄 48항목 중 정상 19 / 실패 27 / 주의 2.
**실패의 대부분은 결함이 아니라 사외 로컬 DB 의 데이터 부족**이다. 결함 판정은 내부망에서 해야 한다.

### ✅ 해소 확인 (사외에서도 정상 동작)
`057` 분류 드롭다운 겹침 · `099`·`651`·`1427` 첨부 업로드 · `1323`·`1335` 양식 편집창 · `1327`·`1339` 양식 저장 ·
`1507` 연락처 팝업(Page Not Found 해소) · `1702` Web VOC FAQ(Page Not Found 해소) · `1891` 사용자접속로그 목록

### 🔴 결함 재현 (사외 로컬에서도 그대로 나옴 — 데이터와 무관)
| TC | 확인된 현상 |
|---|---|
| `007` | 평균통화시간이 `0분 0초` (AS-IS 는 `00분 00초`) — QA 보고와 동일 |
| `1206` | 사용여부 기본값이 `""` (옵션은 `Y:Yes|N:No` 로 정상 존재) |
| `1204` | 유형코드에 한글 3글자(`한글코`)를 넣었는데 **저장됨** — QA 보고와 동일 |
| `1236`·`1245` | 저장 직후 목록이 비었는데 **재접속하니 행이 보임** — QA 보고("저장 완료 시 목록 사라지며 재접속 시 표시")와 정확히 동일 |
| `058`·`448`·`769`·`924` | 분류 자동완성 선택 후 대분류가 자동 입력되지 않음(4개 화면 공통). 목록은 떴고 클릭도 됐다 — 내부에서 재확인 권장 |

### 🧹 이 실행이 남긴 테스트 데이터 (정리 대기)
배분관리 2건 + 스토어케어 분류 1건. **내부망 검증 후 정리**하기로 했다(2026-09-20 결정).
목록·지우는 법은 `스타벅스/04_QA시나리오/09_결함회귀_260916/README.md` 의 "🧹 정리 대기" 표에 있다.
현재 상태만 보려면(조회 전용): `run.bat scenarios\스타벅스_로컬목업\_확인_테스트잔재.json --headless`

### ⚪ 환경(로컬 데이터 부족)으로 판정 불가
포털 메뉴 0개(`1781`) · 목록 0건(`676`·`683`·`953`·`1008`·`1083`·`1267`·`1306`·`1387`·`1408`·`1458`) ·
조직 데이터 없음(`445`·`655`·`1921`·`1986`) · 검색어 미지정(`941`~`943`)

## 결과

증적은 `reports/스타벅스_로컬목업/09_결함회귀_260916/…` 에 쌓인다.
`스타벅스/` 프로젝트와 폴더가 분리되므로 **사내 개발서버 실행 결과와 섞이지 않는다**(직전 실행 비교도 각자 기준).
