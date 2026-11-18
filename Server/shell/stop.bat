@echo off
REM 默认只列出 skynet.exe。传入 all 才会结束本机全部 skynet 进程（含其他工程）。
cd /d %~dp0\..
setlocal

if /i "%~1"=="all" goto killall

echo Usage: stop.bat all
echo.
echo   all   kill ALL skynet.exe on this machine
echo.
echo Running skynet processes:
tasklist /FI "IMAGENAME eq skynet.exe" 2>nul | findstr /i skynet.exe
endlocal
exit /b 0

:killall
taskkill /F /IM skynet.exe
if errorlevel 1 (
  echo [ok] no running skynet.exe found
) else (
  echo all skynet stopped.
)
endlocal
