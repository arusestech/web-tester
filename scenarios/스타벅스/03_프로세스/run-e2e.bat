@echo off
chcp 65001 >nul
cd /d %~dp0..\..\..
rem 스타벅스 E2E 10건 순서 실행 (계정이 바뀌는 단계마다 파일 1개). 실패(exit 2) 시 중단.
rem 사전: E2E02 → _mock\e2e02_storecare_insert.sql + e2e02_stb_member_stub.sql, E2E04 → _mock\e2e04_ce_insert.sql
rem 사후: _mock\e2e02_cleanup.sql, e2e04_cleanup.sql, e2e09_cleanup.sql
rem 비밀번호는 파일에 넣지 않는다 — 첫 인자로 주거나(run-e2e.bat 비번) 물어보면 입력
set PW=%~1
if "%PW%"=="" set /p PW=비밀번호:
if "%PW%"=="" (echo [중단] 비밀번호가 없습니다 & exit /b 1)
set D=scenarios\스타벅스\03_프로세스
set OPT=--mode crud --screenshot all --secret password=%PW%
for %%f in (E2E01-1 E2E01-2 E2E01-3 E2E01-4 E2E02-1 E2E02-2 E2E02-3 E2E02-4 E2E02-5 E2E03-1 E2E03-2 E2E04-1 E2E04-2 E2E04-3 E2E04-4 E2E05-1 E2E05-2 E2E05-3 E2E06-1 E2E06-2 E2E06-3 E2E07-1 E2E07-2 E2E07-3 E2E07-4 E2E08-1 E2E08-2 E2E09-1 E2E09-2 E2E10-1 E2E10-2 E2E10-3 E2E10-4) do (
  echo === %%f
  node cli.js run "%D%\%%f.json" %OPT%
  if errorlevel 2 (echo [STOP] %%f 실패 & exit /b 2)
)
echo ALL DONE
