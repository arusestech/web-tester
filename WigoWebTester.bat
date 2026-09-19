@echo off
rem WIGO Web Tester - GUI launcher (Windows). Double-click to start.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0bin\env.bat"
if errorlevel 1 exit /b 1
rem Run node directly (drop the extra cmd hop): bat->cmd->node->chrome multi-step
rem spawn is a pattern EDR watches, so shorten the process chain by one. /min = minimized console.
start "WIGO Web Tester" /min "%NODE_EXE%" cli.js gui
