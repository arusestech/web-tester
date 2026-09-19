<%@ page contentType="text/html; charset=UTF-8" %>
<!-- 부서 관리: 같은 조회 조건(fromDate/toDate)이 반복 → inputs 공통 후보가 된다 -->
<div class="content">
  <form id="searchForm">
    <table>
      <tr>
        <th>시작일</th><td><input type="text" id="fromDate" name="fromDate" class="datepicker"/></td>
        <th>종료일</th><td><input type="text" id="toDate" name="toDate" class="datepicker"/></td>
        <th>부서명</th><td><input type="text" id="deptName" name="deptName"/></td>
      </tr>
    </table>
    <a href="#" id="btnSearch" class="btn">조회</a>
  </form>
  <table id="deptList" class="grid"></table>
</div>
