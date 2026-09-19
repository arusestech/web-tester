@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d %~dp0..\..\..
rem 권한 페르소나 24개 (auth-P01~P24) 일괄 실행. 접속 URL 은 프로젝트 설정(_project.json). 로그는 도구 폴더의 logs\ 에 남긴다.
if not exist logs mkdir logs
set L=logs\run_personas_%date:~0,4%%date:~5,2%%date:~8,2%.log
rem 비밀번호는 파일에 넣지 않는다 — 첫 인자로 주거나(run-personas-all.bat 비번) 물어보면 입력
set PW=%~1
if "%PW%"=="" set /p PW=비밀번호:
if "%PW%"=="" (echo [중단] 비밀번호가 없습니다 & exit /b 1)
echo START %TIME% > "%L%"
for %%f in (scenarios\스타벅스\02_권한\auth-P*.json) do (
  echo === %%f !TIME! >> "%L%"
  node cli.js run "%%f" --mode all --headless --screenshot fail --secret password=!PW! >> "%L%" 2>&1
  echo exit=!ERRORLEVEL! >> "%L%"
)
echo ALLDONE !TIME! >> "%L%"
