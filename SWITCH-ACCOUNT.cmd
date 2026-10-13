@echo off
rem SWITCH-ACCOUNT.cmd - choose which Claude account the loop budgets its usage against.
set PROJ=%USERPROFILE%\Downloads\Projects
echo Accounts:  default
dir /b "%PROJ%\_secrets\claude-profiles" 2>nul
set /p NAME=Use which account:
mkdir "%PROJ%\_status" 2>nul
>"%PROJ%\_status\active-account.txt" echo %NAME%
node "%PROJ%\mclite\tools\go.mjs" usage
pause
