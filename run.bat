@echo off
rem WIGO Web Tester - terminal launcher (Windows)
rem   run.bat                    GUI
rem   run.bat scenarios\x.json   run directly
rem   run.bat cli                terminal interactive
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0bin\env.bat"
if errorlevel 1 exit /b 1
"%NODE_EXE%" cli.js %*
exit /b %errorlevel%
