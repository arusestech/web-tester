@echo off
rem Resolve Node runtime + bundled browsers. Sets NODE_EXE. Called by WigoWebTester.bat / run.bat
rem No network access is attempted here (closed-network safe).
set "ROOT=%~dp0.."
set "NODE_EXE="
if exist "%ROOT%\runtime\win\node.exe" set "NODE_EXE=%ROOT%\runtime\win\node.exe"
if "%NODE_EXE%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do if "%NODE_EXE%"=="" set "NODE_EXE=%%i"
)
if "%NODE_EXE%"=="" (
  echo [ERROR] Node.js not found. Install Node 20+ or use the bundle that includes runtime\win\node.exe.
  exit /b 1
)
if exist "%ROOT%\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%\browsers"
if not exist "%ROOT%\node_modules\playwright" (
  echo [ERROR] node_modules\playwright missing. Use the bundled zip, or run "npm install" on a PC with internet.
  exit /b 1
)
exit /b 0
