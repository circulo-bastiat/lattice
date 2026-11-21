@echo off
rem LOOP-ON.cmd - the brain keeps 5 headless workers running (repo variable FILL_WORKERS; same switch as the phone app).
cd /d "%~dp0"
node tools\go.mjs loop on
pause
