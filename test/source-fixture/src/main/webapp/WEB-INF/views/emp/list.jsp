<%@ page contentType="text/html; charset=UTF-8" %>
<!-- 사원 목록: 조회폼 + jqGrid + 상세(더블클릭) + 위험 버튼 -->
<div class="content">
  <form id="searchForm">
    <table>
      <tr>
        <th>시작일</th><td><input type="text" id="fromDate" name="fromDate" class="datepicker"/></td>
        <th>종료일</th><td><input type="text" id="toDate" name="toDate" class="datepicker"/></td>
        <th>부서</th><td><select id="deptCd" name="deptCd"><option value="">전체</option></select></td>
        <th>사원명</th><td><input type="text" id="empName" name="empName"/></td>
      </tr>
    </table>
    <a href="#" id="btnSearch" class="btn">조회</a>
    <button type="button" id="btnDelete">삭제</button>
    <button type="button" id="btnSend">발송</button>
    <input type="button" value="저장" id="btnSave"/>
  </form>

  <table id="list"></table>
  <div id="pager"></div>
</div>
<script>
  // 메타 화면처럼 마크업에 없고 스크립트에서 id 로만 다루는 버튼
  $('#btnExcelDown').click(function () { fnExcel(); });
  $('#list').jqGrid({
    url: '/demo/emp/selectList',
    ondblClickRow: function (rowId) { goDetail(rowId); }
  });
</script>
