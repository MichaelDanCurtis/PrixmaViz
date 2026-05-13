@echo off
REM PrixmaViz MCP shim launcher (Windows).
REM
REM Mirrors bin/prixmaviz-mcp for POSIX. Detects platform (windows-x64 only),
REM lazy-downloads the binary from GitHub Releases on first run, caches it at
REM %PRIXMAVIZ_BIN_CACHE% (defaults to %LOCALAPPDATA%\prixmaviz\bin), execs it.
REM
REM Override the binary entirely by setting PRIXMAVIZ_MCP_BIN to an absolute path.
setlocal EnableDelayedExpansion

set "VERSION=0.5.0"
set "REPO=MichaelDanCurtis/PrixmaViz"
set "PLATFORM=windows-x64"

if defined PRIXMAVIZ_MCP_BIN (
  if exist "%PRIXMAVIZ_MCP_BIN%" (
    "%PRIXMAVIZ_MCP_BIN%" %*
    exit /b %ERRORLEVEL%
  )
)

if defined PRIXMAVIZ_BIN_CACHE (
  set "CACHE_DIR=%PRIXMAVIZ_BIN_CACHE%"
) else (
  set "CACHE_DIR=%LOCALAPPDATA%\prixmaviz\bin"
)

set "BIN=%CACHE_DIR%\prixmaviz-mcp-%VERSION%-%PLATFORM%.exe"

if not exist "%BIN%" (
  if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
  set "URL=https://github.com/%REPO%/releases/download/v%VERSION%/prixmaviz-mcp-%PLATFORM%.exe"
  echo prixmaviz-mcp: first-time setup -- downloading %PLATFORM% binary (~115 MB)... 1>&2
  echo   from: !URL! 1>&2
  echo   to:   %BIN% 1>&2
  set "TMP=%BIN%.partial"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '!URL!' -OutFile '!TMP!'"
  if errorlevel 1 (
    echo prixmaviz-mcp: download failed. 1>&2
    exit /b 1
  )
  move /Y "!TMP!" "%BIN%" >nul
  echo prixmaviz-mcp: ready. 1>&2
)

"%BIN%" %*
exit /b %ERRORLEVEL%
