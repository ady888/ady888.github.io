@echo off
REM Alley Kings launcher - Windows.
REM
REM Serves the game on localhost and opens your browser. The game must be served
REM over HTTP rather than opened as a file, because browsers block WebAssembly
REM and ES modules on file:// origins and the physics engine is a WASM module.

setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8765

echo.
echo   ================================================
echo    ALLEY KINGS
echo   ================================================
echo.

REM 1. Node - best option: it also opens the browser for us.
where node >nul 2>&1
if %errorlevel%==0 (
  echo   Using Node to serve the game.
  echo.
  echo   Leave this window open while you play.
  echo   Press Ctrl+C here when you are finished.
  node serve.mjs
  goto :end
)

REM 2. Python, however it is installed.
where py >nul 2>&1
if %errorlevel%==0 (
  echo   Using Python to serve the game.
  call :serve py -3 -m http.server %PORT% --bind 127.0.0.1 --directory game
  goto :end
)

where python >nul 2>&1
if %errorlevel%==0 (
  echo   Using Python to serve the game.
  call :serve python -m http.server %PORT% --bind 127.0.0.1 --directory game
  goto :end
)

REM 3. Nothing can serve files. Edge ships with Windows, so launch it with local
REM    file access enabled, using a throwaway profile so the flag actually
REM    applies - an already-running browser would otherwise ignore it.
echo   No Node or Python found, falling back to launching Edge directly.
echo.
set "PROFILE=%CD%\.browser-profile"
set "GAMEFILE=file:///%CD:\=/%/game/index.html"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE%" (
  echo   Launching Microsoft Edge.
  echo   Close that browser window when you are finished.
  start "" "%EDGE%" --allow-file-access-from-files --user-data-dir="%PROFILE%" "%GAMEFILE%"
  goto :end
)
if exist "%CHROME%" (
  echo   Launching Google Chrome.
  echo   Close that browser window when you are finished.
  start "" "%CHROME%" --allow-file-access-from-files --user-data-dir="%PROFILE%" "%GAMEFILE%"
  goto :end
)

echo   Could not find a way to run the game automatically.
echo.
echo   Two options:
echo     1. Install Node.js from https://nodejs.org and run this again.
echo     2. Open "alley-kings-single-file.html" in this folder - it needs
echo        nothing at all, but the loose bins and bottles will not move.
echo.
pause
goto :eof

:serve
echo.
echo   Serving at http://localhost:%PORT%/
echo.
echo   Leave this window open while you play.
echo   Press Ctrl+C here when you are finished.
echo.
start "" "http://localhost:%PORT%/"
%*
goto :eof

:end
endlocal
