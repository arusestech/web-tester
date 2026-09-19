# 서버 stub 만들기 — 대상 프로젝트 분석 가이드 (Claude 용)

다른 세션의 Claude 가 "이 프로젝트 외부 연동을 목업하고 싶다"는 요청을 받았을 때 따라가는 문서.
목표: 대상 앱(백엔드)이 **부르는 외부 인터페이스**를 소스에서 찾아 `stubServer` 라우트로 만든다.
전제: `stubServer` 는 WIGO 내장 HTTP stub(→ `docs/시나리오-작성-가이드.md` "서버 stub" 절, `src/stub-server.js`). **브라우저 fetch/XHR 는 `mocks` 로 따로** 처리(혼동 주의).

---

## 0. 먼저 무엇을 목업하는지 판별 (중요)
- **백엔드가 부르는 외부 연동**(자바 서버 → 외부 API/SOAP/레거시) → `stubServer` (이 문서).
- **화면(브라우저)이 직접 부르는** fetch/XHR/ajax → 시나리오 `mocks` (편집 폼 "브라우저 호출 목업").
- 브라우저 도구는 서버-투-서버 호출을 못 본다. 그래서 화면 개발자도구 Network 만 봐서는 안 되고 **소스**를 봐야 한다.

## 1. 외부 호출 지점 찾기 (소스 grep)
Java/JSP 기준. 폐쇄망이면 `findstr /S /I`, 아니면 ripgrep(`rg`).
```
rg -n -i "https?://" src            # 하드코딩 URL
rg -n "RestTemplate|WebClient|HttpURLConnection|URLConnection|HttpClient|OkHttp|CloseableHttpClient" src
rg -n "WebServiceTemplate|SOAPConnection|javax\.xml\.ws|@WebServiceClient|wsdl"  src   # SOAP/WS
rg -n "openConnection|HttpsURLConnection|SSLContext"  src
rg -n -i "feign|@FeignClient|retrofit"  src
rg -n -i "\.url|endpoint|host|baseUrl|api[._]url|IF_URL|ifUrl"  src   # 설정 키 이름
```
외부 URL 은 **하드코딩보다 설정에 있는 경우가 많다**:
```
rg -n -i "url|host|endpoint|port"  src/main/resources/*.properties  *.yml  *.xml   WEB-INF
```
메뉴 테이블처럼 **DB 에 URL 을 두는** 사이트도 있다 → 설정/코드에서 그 값을 어디서 읽는지 추적.

## 2. 각 호출에서 뽑을 4가지
호출 1건마다 아래를 정리한다(파일:라인 근거 남기기).
1. **경로(path)**: 외부 base URL 뒤의 경로. 예: `https://ext.bank/if/sms/send` → path `/if/sms/send`.
   - stub 매칭은 **경로 부분일치**면 충분. 애매하면 `re:/if/.*` catch-all 로 시작.
2. **메서드**: GET/POST 등. 코드에서 `postForObject`/`exchange(...POST...)`/`setRequestMethod("POST")` 로 확인. 모르면 생략(전부 매칭).
3. **성공 판정과 응답 필드**: **응답을 파싱하는 코드**를 본다. 무엇을 읽는지 = stub 이 반드시 채워야 하는 것.
   - 예: `if("0000".equals(res.getResultCode()))` → `{ "resultCode": "0000" }` 필수.
   - DTO/VO 필드, `JSONObject.get("...")`, `resultMap.get("...")`, XML 태그명을 그대로 응답 키로.
4. **형식**: JSON 이면 `json`, XML/SOAP 이면 `body` + `contentType`(아래 3-2).

## 3. stubServer 로 옮기기
### 3-1. JSON 인터페이스
```json
"stubServer": {
  "enabled": true, "port": 9900,
  "routes": [
    { "path": "/if/sms/send", "method": "POST",
      "json": { "resultCode": "0000", "resultMsg": "정상", "msgId": "MOCK-{{now}}" } },
    { "path": "/if/store/info",
      "json": { "code": "0000", "store": { "storeId": "1001", "storeNm": "강남점" } } },
    { "path": "re:/if/.*", "json": { "code": "0000", "data": null } }   // 남은 건 catch-all
  ]
}
```
- 코드가 읽는 필드만 정확히 채우면 된다(나머지는 없어도 됨). 성공 코드값은 **소스에서 확인한 실제 값**으로.
- 목록/건수를 파싱하면 배열도 최소 1건 넣는다.

### 3-2. SOAP/XML 인터페이스
`json` 대신 `body`(문자열)+`contentType`. 최소 응답 봉투만.
```json
{ "path": "/ws/CustomerService", "method": "POST", "contentType": "text/xml; charset=utf-8",
  "body": "<?xml version=\"1.0\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><ns:sendResponse xmlns:ns=\"urn:voc\"><result>0000</result></ns:sendResponse></soap:Body></soap:Envelope>" }
```
코드가 파싱하는 태그명·네임스페이스를 맞춘다.

### 3-3. 실패/지연/차단도 표현
- 장애 상황 재현: `"status": 500` 또는 업무오류 코드 `{"resultCode":"9999"}`.
- 타임아웃 흉내: `"delayMs": 5000`.
- 아예 못 붙는 상황: `"abort": true`(브라우저 mocks 전용) — stubServer 는 라우트를 안 만들면 404 로 응답(미매칭 로그 남음).

### 3-4. 동적 값
등록 응답의 채번 ID 등은 `{{now}}` `{{seq}}` `{{uuid}}` `{{today}}`. 시나리오 `vars` 값도 `{{이름}}` 으로 참조 가능.

## 4. 어디에 둘지 — 프로젝트(환경) 단위 on/off
- **로컬 프로젝트 → 켬(목업), 개발/운영 프로젝트 → 끔(실제)**. `stubServer` 는 프로젝트 상속 키다.
- `_project.json`(🔧 프로젝트 설정 다이얼로그)에 넣고 `enabled` 로 토글. 시나리오는 상속받는다.
- 시나리오 자신에 두면 그 시나리오만. 예시는 꺼둔 채(`enabled:false`) `_comment_stubServer` 로 설명(→ starbucks-voc.json 참고).

## 5. 대상 앱이 stub 을 보게 (환경 세팅 — 도구 밖, 사용자 몫)
stub 만 띄운다고 되는 게 아니라 **앱이 그 주소로 부르게** 해야 한다. 다음 중 가능한 방법을 사용자에게 안내:
1. **설정 변경(권장)**: `application.properties`/`config.xml`/DB 의 외부 연동 URL 을 `http://<이 PC>:9900` 로 바꾸고 앱을 로컬 프로파일로 재기동.
2. **hosts 우회**: 외부 도메인 → `127.0.0.1`(stub 포트). HTTPS 면 인증서 문제로 손이 더 감(그래서 1번 권장).
3. **앱의 목업 프로파일**: 앱에 이미 목업 모드/mock 빈/피처 플래그가 있으면 그걸 켜는 게 최선(개발팀 확인).

## 6. 검증
- 단독으로 stub 만 띄우고 확인: `run.bat stub scenarios\<프로젝트>\<시나리오>.json` → 다른 터미널에서 `curl http://localhost:9900/if/sms/send`(또는 앱에서 호출) → 응답·미매칭 로그 확인. Ctrl+C 종료.
- 시나리오 실행으로 확인: 외부 호출을 유발하는 흐름(예: 문자발송 버튼)을 CRUD 로 태우고, 그 화면이 성공 메시지/데이터를 보이는지. stub 로그에 `stub POST /if/... → 200` 이 찍히면 앱이 stub 을 탄 것.
- 매칭 안 되면 stub 이 `→ 404 (매칭 없음)` 을 로그로 남긴다 → path/method 를 실제 호출에 맞춰 수정.

## 7. 흔한 함정
- **경로만으로 매칭**하므로, 쿼리스트링·컨텍스트가 붙어도 부분일치면 잡힌다. 너무 넓게 잡으면 catch-all 이 다른 것까지 먹으니 구체 라우트를 위에, `re:/if/.*` 를 마지막에.
- **응답 형식 불일치**가 제일 흔한 실패: 코드가 XML 을 기대하는데 json 을 주거나, 성공 코드값이 틀림 → 소스의 파싱부를 반드시 확인.
- **HTTPS 외부**: 앱이 https 로만 부르면 stub(http)로 못 온다 → 설정에서 http 로 바꾸거나(가능하면), 프록시/인증서 필요.
- stub 은 **실행 중에만** 뜬다(테스트 자동 실행 시) — 앱이 상시 붙어야 하면 `run.bat stub` 로 상시 띄운다.
- 서버-투-서버가 아니라 화면 fetch 였다면 `stubServer` 가 아니라 `mocks` 다.
