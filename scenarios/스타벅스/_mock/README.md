# _mock — E2E 사전 목업 데이터 / 원복 SQL

`_` 로 시작하므로 GUI 목록·일괄 실행에서 제외된다. 대상은 공유 개발 MySQL(DB `VOC`. 호스트·포트·계정·비번은 프로젝트 `CLAUDE.local.md` 참고 — 여기 적지 않는다).
CLAUDE.md 목업 원칙: 테스트 전 적용 → 테스트 후 반드시 원복 → 커밋 금지.

| E2E | 적용 전 | 원복 | 이유 |
|---|---|---|---|
| 02 스토어케어 | `e2e02_storecare_insert.sql` + `e2e02_stb_member_stub.sql` | `e2e02_cleanup.sql` | 개발 DB 에 스토어케어/분류 0건. 상태 처리(접수확인 등)가 홈페이지 회원DB `STB_MEMBER` 를 동기 조회 → 임시 테이블 필요 |
| 04 CE | `e2e04_ce_insert.sql` | `e2e04_cleanup.sql` | CE 답변/마감기준월 0건 |
| 09 발송 | (없음 — SMTP 목업 `localhost:1025` 는 build/local config.xml 에 8/25 [TEST MOCK] 적용 상태) | `e2e09_cleanup.sql` | 문자발송 실패 후 SSG_TRAN 잔존, SYS0313 TEST 행 |
| 01/03/05/06/07/08/10 | 불필요 | — | E2E01/03/05 는 화면에서 TEST_ 데이터를 만들고 마지막 단계에서 정리 |

실행 예 (pymysql):
```
python dbq.py < e2e02_storecare_insert.sql
```
`dbq.py` 는 세션 scratchpad 에만 있었음 — 아래 10줄로 재작성 가능:
```python
import sys, io, pymysql
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
c = pymysql.connect(host='<CLAUDE.local.md>', port=<포트>, user='<계정>', password='<비번>', db='VOC', charset='utf8mb4', autocommit=True)
cur = c.cursor()
for stmt in [s for s in sys.stdin.read().split(';\n') if s.strip()]:
    cur.execute(stmt)
    if cur.description: print([d[0] for d in cur.description]); [print(r) for r in cur.fetchall()]
    else: print('affected=', cur.rowcount)
```

주의
- 매장코드 9024 에 부서 3개가 매핑되어 있어 스토어케어/CE 목록·집계가 ×3 으로 보인다(조인 중복 결함, 데이터 오류 아님).
- `STB_MEMBER` 스텁은 매퍼 `FROM STB_MEMBER#   WHERE …` 의 `#` 주석 결함 때문에 행 1개만 넣는다.
