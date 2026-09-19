// 자체 검증용 가짜 JSP 사이트: node test/mock-server.js  (포트 3999)
import http from 'node:http';
const items = [{ id: 1, name: '홍길동' }];
let flakyHit = 0; // /flaky 는 첫 요청만 실패 (재시도 기능 검증용)
const html = (b) => `<html><body><div id="menu"><a href="/main">메인</a> <a href="/emp">사원관리</a> <a href="/err">에러메뉴</a> <a href="/jserr">JS에러</a> <a href="/logout">로그아웃</a></div>${b}</body></html>`;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  if (url.pathname === '/login' && req.method === 'GET') return send(200, `<form method=post><input name=userId><input name=password type=password><button type=submit>로그인</button></form>`);
  // 로그인: test 로 시작하는 아이디면 성공하고 쿠키에 사용자를 담는다 (계정 전환 switchUser 검증용)
  if (url.pathname === '/login' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const id = decodeURIComponent((b.match(/userId=([^&]*)/) || [])[1] || '');
      if (/^test/i.test(id)) res.writeHead(302, { Location: '/main', 'Set-Cookie': `uid=${encodeURIComponent(id)}; Path=/` });
      else res.writeHead(302, { Location: '/login' });
      res.end();
    });
    return;
  }
  if (url.pathname === '/logout') { res.writeHead(302, { Location: '/login', 'Set-Cookie': 'uid=; Path=/; Max-Age=0' }); return res.end(); }
  const who = decodeURIComponent((String(req.headers.cookie || '').match(/uid=([^;]*)/) || [])[1] || '');
  if (url.pathname === '/main') return send(200, html(`<div id="content">환영합니다 <b id="uid">${who || '손님'}</b> 님</div><div id="secret">주민번호 900101-1234567</div>`));
  if (url.pathname === '/emp') {
    const q = url.searchParams.get('q') || '', dept = url.searchParams.get('dept') || '';
    const list = items.filter((i) => !q || i.name.includes(q));
    return send(200, html(`<form id="sf"><input name="q" value="${q}"><select name="dept"><option value="">전체</option><option value="10"${dept === '10' ? ' selected' : ''}>영업</option></select><button id="btnSearch">조회</button></form><div id="cond">q=${q} dept=${dept}</div><a href="/emp/new">등록</a><table>${list.map((i) => `<tr><td><a href="/emp/${i.id}">${i.name}</a></td></tr>`).join('')}</table>`));
  }
  const det = url.pathname.match(/^\/emp\/(\d+)$/);
  if (det) { const it = items.find((i) => i.id === +det[1]); return it ? send(200, html(`<h2>사원 상세</h2><div id="detail">이름: ${it.name}</div><a href="/emp">목록</a>`)) : send(404, 'not found'); }
  if (url.pathname === '/emp/new') return send(200, html(`<form method=post action="/emp/save"><input name=empName><button>저장</button></form>`));
  if (url.pathname === '/emp/save') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { items.push({ id: items.length + 1, name: decodeURIComponent(b.split('=')[1].replace(/\+/g, ' ')) }); send(200, html(`<script>alert('저장되었습니다');location.href='/emp'</script>`)); }); return; }
  // ub-control 식 조회 폼 (라벨 추출 검증용): <th><label>..</label></th><td>input</td>, 라디오는 뒤에 label
  if (url.pathname === '/search') return send(200, html(`<form id="searchForm"><table><tr>
    <td><select id="CD_SEARCH_2" name="CD_SEARCH_2"><option value="A">등록일</option></select></td>
    <td><input type=text class="calendar" id="DT_REG_START" name="DT_REG_START"><label> ~ </label><input type=text class="calendar" id="DT_REG_END" name="DT_REG_END"></td>
    <th><label>진행단계</label></th><td><select id="CD_STTUS" name="CD_STTUS"><option value="">전체</option><option value="1">접수</option></select></td></tr>
    <tr><th><label>접수자</label></th><td><input type=text id="NM_EMP" name="NM_EMP" readonly><a href="#" title="search">@@</a><input type=hidden id="ID_EMP" name="ID_EMP"></td>
    <th><label>답변진행</label></th><td><input type=radio id="CD_ANS" name="CD_ANS" value="ALL" checked><label>전체</label><input type=radio id="CD_ANS" name="CD_ANS" value="OVER"><label>초과</label>
    <input type=checkbox id="FG_REQ" name="FG_REQ" value="Y"><label for="FG_REQ">회신여부</label></td></tr></table>
    <span id="searchBtn"><a href="#" title="Search">검색</a></span></form>`));
  // 버튼 동작 검사(actions)용 화면: 정상 버튼 / 죽은 버튼 / JS 에러 버튼 / 에러 알림 버튼 / 팝업 열기 / 금지 버튼
  if (url.pathname === '/buttons') return send(200, html(`<div id="content">
    <button id="btnOk">조회</button>
    <button id="btnDead">반응없음</button>
    <button id="btnJsErr">오류나는버튼</button>
    <button id="btnAlertErr">에러알림</button>
    <button id="btnLayer">검색팝업</button>
    <button id="btnDelete">삭제</button>
    <div id="result"></div>
    <div id="layer" style="display:none">검색 레이어<button class="btn_close">닫기</button></div></div>
    <script>
      document.getElementById('btnOk').onclick = function(){ fetch('/api/list').then(function(r){return r.text()}).then(function(t){ document.getElementById('result').innerHTML = t; }); };
      document.getElementById('btnDead').onclick = function(){ /* 아무것도 안 함 = 죽은 버튼 */ };
      document.getElementById('btnJsErr').onclick = function(){ noSuchFunction(); };
      document.getElementById('btnAlertErr').onclick = function(){ alert('시스템 오류가 발생했습니다'); };
      document.getElementById('btnLayer').onclick = function(){ document.getElementById('layer').style.display='block'; };
      document.getElementById('layer').querySelector('.btn_close').onclick = function(){ document.getElementById('layer').style.display='none'; };
      document.getElementById('btnDelete').onclick = function(){ document.getElementById('result').innerHTML = '지웠습니다(실제로는 실행되면 안 됨)'; };
    </script>`));
  if (url.pathname === '/api/list') return send(200, '<table id="grid"><tr><td>조회 결과 1</td></tr></table>');
  if (url.pathname === '/err') return send(500, `<h1>HTTP Status 500 – Internal Server Error</h1><pre>java.lang.NullPointerException\n\tat com.example.EmpController.list(EmpController.java:42)</pre>`);
  if (url.pathname === '/jserr') return send(200, html('<script>undefinedFn()</script><p>내용</p>'));
  // ---- 2순위 기능 검증용 ----
  // 깨진 이미지 + 화면보다 넓은 내용(가로 스크롤)
  if (url.pathname === '/broken') return send(200, html('<div id="content"><img src="/no-such-image.png" width="80" height="40"><div style="width:3000px">아주 넓은 표 영역</div></div>'));
  // 늦게 그려지는 목록: 로딩 레이어가 떠 있다가 ?ms 뒤에 그리드가 생긴다 (응답은 즉시)
  if (url.pathname === '/slowgrid') {
    const ms = Number(url.searchParams.get('ms') || 7000);
    return send(200, html(`<div id="content"><div id="loading">조회 중...</div><div id="area"></div></div>
      <script>setTimeout(function(){document.getElementById('loading').style.display='none';document.getElementById('area').innerHTML='<table id="grid"><tr><td>결과 1</td></tr></table>';}, ${ms});</script>`));
  }
  // 목록 자리에서 상세를 다시 그리는 화면(URL 이 안 바뀌는 상세): 처음엔 본문이 비어 있다가 ?ms 뒤에 채워진다.
  // 한 번만 읽으면 "빈 화면" 오탐이 난다 — checks.js readText 재시도 검증용. html() 을 쓰면 메뉴 텍스트 때문에 비지 않으므로 직접 만든다
  if (url.pathname === '/repaint') {
    const ms = Number(url.searchParams.get('ms') || 900);
    return send(200, `<html><body><div id="content"></div>
      <script>setTimeout(function(){document.getElementById('content').innerHTML='<h2>상세 화면</h2><p>다시 그린 뒤에는 본문 텍스트가 충분히 들어 있습니다.</p>';}, ${ms});</script></body></html>`);
  }
  // 외부 인터페이스를 호출하는 화면 (연동 안 되는 환경 가정): ext.invalid 는 실제로 못 붙으므로 목업(context.route)이 없으면 ERR
  if (url.pathname === '/iface') return send(200, html('<div id="result">로딩...</div><script>fetch("http://ext.invalid/api/rate").then(function(r){return r.json()}).then(function(d){document.getElementById("result").textContent="rate="+d.rate}).catch(function(e){document.getElementById("result").textContent="ERR:"+e.message})</script>'));
  // 느린 화면 (기본 2.5초, ?ms= 로 조절)
  if (url.pathname === '/slow') { const ms = Number(url.searchParams.get('ms') || 2500); return setTimeout(() => send(200, html('<div id="content">느린 화면</div>')), ms); }
  // 불안정(flaky): 첫 요청만 500, 그 다음부터 정상. ?reset= 로 초기화
  if (url.pathname === '/flaky') {
    if (url.searchParams.has('reset')) { flakyHit = 0; return send(200, html('<div id="content">reset</div>')); }
    return ++flakyHit === 1 ? send(500, '<h1>HTTP Status 500 – Internal Server Error</h1>') : send(200, html('<div id="content">이제 정상</div>'));
  }
  send(404, 'not found');
}).listen(3999, () => console.log('mock on :3999'));
