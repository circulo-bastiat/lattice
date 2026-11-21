@echo off
rem ADD-CLAUDE-ACCOUNT.cmd - add one Claude account to the usage tracker. Once per account, ever.
rem Opens Claude Code in its own login folder; type /login, sign in with that account, then /exit.
set /p NAME=Short name for this account (e.g. max, pro):
set PROJ=%USERPROFILE%\Downloads\Projects
set CLAUDE_CONFIG_DIR=%PROJ%\_secrets\claude-profiles\%NAME%
mkdir "%CLAUDE_CONFIG_DIR%" 2>nul
where claude >nul 2>nul || (echo Installing Claude Code once... & call npm install -g @anthropic-ai/claude-code)
where claude >nul 2>nul || (echo Claude Code would not install - is Node.js installed? & pause & exit /b 1)
mkdir "%PROJ%\_status" 2>nul
if not exist "%PROJ%\_status\active-account.txt" (>"%PROJ%\_status\active-account.txt" echo %NAME%)
echo Type /login, sign in as the "%NAME%" account, then /exit.
claude
node "%PROJ%\mclite\tools\usaged.mjs" --once
node "%PROJ%\mclite\tools\infra\pushprofiles.mjs"
pause
