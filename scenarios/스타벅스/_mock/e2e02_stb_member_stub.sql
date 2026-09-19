-- [TEST MOCK] E2E-02 홈페이지 회원DB 스텁 (2026-08-27)
-- 스토어케어 상태 처리(StoreCareProcessSO:119)가 HomeInquiry.getCustomerSpNo(STB_MEMBER) 를 동기 호출한다.
-- 로컬은 홈페이지 DB(jdbc/home)가 VOC DB 를 가리키므로 임시 테이블을 만들어 우회한다. 테스트 후 e2e02_cleanup.sql 로 DROP.
-- 주의: 매퍼 쿼리가 `FROM STB_MEMBER#   WHERE ...` 라 MySQL 에서 WHERE 가 주석 처리됨(결함) → 행 1개만 넣는다.
CREATE TABLE STB_MEMBER (USER_ID VARCHAR(50), SCK_MBBR_NO VARCHAR(50)) COMMENT='[TEST MOCK] E2E-02 홈페이지 회원DB 목업 - 테스트 후 DROP';
INSERT INTO STB_MEMBER VALUES ('230419','TEST_SP_230419');
