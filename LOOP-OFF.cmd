@echo off
rem LOOP-OFF.cmd - the brain starts no more workers (running ones finish their issue).
cd /d "%~dp0"
node tools\go.mjs loop off
pause
