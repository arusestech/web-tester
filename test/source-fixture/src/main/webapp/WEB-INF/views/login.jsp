<%@ page contentType="text/html; charset=UTF-8" %>
<!-- 로그인 화면. 아이디/비번/버튼 셀렉터가 여기서 뽑혀야 한다 -->
<html><body>
<div class="login-box">
  <form name="loginForm" method="post" action="/demo/login">
    <label for="userId">아이디</label>
    <input type="text" id="userId" name="userId" class="input-text" autocomplete="off"/>
    <label for="userPw">비밀번호</label>
    <input type="password" id="userPw" name="userPw" class="input-text"/>
    <div class="login-idsave"><input type="checkbox" id="loginIdSave"/> <label for="loginIdSave">아이디 저장</label></div>
    <div class="login-btn" id="btnLogin"><a><img src="/img/btn_login.png" alt="로그인"/></a></div>
  </form>
</div>
</body></html>
