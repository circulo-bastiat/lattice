@echo off
rem LOOP-TESTERS-AUTO.cmd - the brain chooses the tester count itself again (FILL_TESTERS=auto).
cd /d "%~dp0"
node tools\go.mjs loop testers auto
pause
