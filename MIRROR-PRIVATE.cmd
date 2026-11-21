@echo off
rem MIRROR-PRIVATE.cmd - #6767: makes the public test mirror PRIVATE (project done, or a takedown notice) and sets TEST_REMOTE=off,
rem so the lander tests on the PC again. "node tools\infra\mirror.mjs visibility public" undoes both.
cd /d "%~dp0"
node tools\infra\mirror.mjs visibility private
pause
