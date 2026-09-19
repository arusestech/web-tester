<%@ page contentType="text/html; charset=UTF-8" %>
<!-- 좌측 메뉴: href · onclick · 속성 세 가지 형태 -->
<ul id="lnb">
  <li><a href="/demo/emp">사원관리</a></li>
  <li><a href="#" onclick="goPage('/board/notice.do')">공지사항</a></li>
  <li><a href="#none" data-menu-url="deptStat" data-menu-nm="부서통계">부서통계</a></li>
  <li><a href="#" onclick="logout()">로그아웃</a></li>
  <li><a href="/demo/emp/excel">엑셀다운로드</a></li>
  <li><a href="javascript:void(0)" onclick="alert('준비중')">준비중</a></li>
</ul>
