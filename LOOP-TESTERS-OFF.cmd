@echo off
rem LOOP-TESTERS-OFF.cmd - the brain starts no testers (FILL_TESTERS=0); workers are unchanged.
cd /d "%~dp0"
node tools\go.mjs loop testers 0
pause
