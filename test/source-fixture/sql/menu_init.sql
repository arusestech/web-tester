-- 메뉴 테이블 초기 데이터 (가장 정확한 메뉴 출처)
INSERT INTO TB_MENU (MENU_ID, UP_MENU_ID, MENU_NM, MENU_URL, USE_YN) VALUES ('M100', NULL, '인사', NULL, 'Y');
INSERT INTO TB_MENU (MENU_ID, UP_MENU_ID, MENU_NM, MENU_URL, USE_YN) VALUES ('M110', 'M100', '사원관리', '/demo/emp', 'Y');
INSERT INTO TB_MENU (MENU_ID, UP_MENU_ID, MENU_NM, MENU_URL, USE_YN) VALUES ('M120', 'M100', '부서관리', '/demo/dept/list', 'Y');
INSERT INTO TB_MENU (MENU_ID, UP_MENU_ID, MENU_NM, MENU_URL, USE_YN) VALUES ('M130', 'M100', '급여대장', '/demo/pay/list.do', 'Y');
