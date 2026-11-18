@echo off
REM Start db / gate / login / world. Logs are in Server\log.
REM stop.bat all kills every skynet.exe on this machine, including other projects.
cd /d %~dp0\..
if not exist log mkdir log

start "" /B skynet.exe etc\dbAppConf    > log\dbApp.log    2>&1
start "" /B skynet.exe etc\gateAppConf  > log\gateApp.log  2>&1
start "" /B skynet.exe etc\loginAppConf > log\loginApp.log 2>&1
start "" /B skynet.exe etc\worldAppConf > log\worldApp.log 2>&1

echo gate  ws://127.0.0.1:8090
echo logs  %cd%\log
echo close this window to stop following logs. The four apps keep running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0follow-logs.ps1"
