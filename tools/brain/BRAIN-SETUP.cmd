@echo off
rem (versioned copy: the live one sits at the Projects root, next to _setup\brain-vm.ps1)
rem BRAIN-SETUP.cmd - one double-click that turns on "the brain" (#86): headless sessions in the sandbox VM that
rem wake on bus mail, keep workers running and page your phone. Safe to run again any time.
rem Step 1 (you): sign in once per Claude account so the brain has a login. Step 2 (automatic): repair + set up the VM.
setlocal
set PROJ=%~dp0
mkdir "%PROJ%_secrets\brain-tokens" 2>nul
where claude >nul 2>nul || (echo Installing Claude Code once... & call npm install -g @anthropic-ai/claude-code)
for %%A in (max pro) do (
  if not exist "%PROJ%_secrets\brain-tokens\%%A.txt" call :token %%A
)
echo.
echo Step 2: setting up the VM (asks for admin once). The log goes to _status\brain-vm.log.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%PROJ%_setup\brain-vm.ps1\"'"
type "%PROJ%_status\brain-vm.log" | findstr /C:"==" /C:"ntfy" /C:"FAILED" /C:"[ok]"
pause
exit /b

:token
echo.
echo === Claude login for the brain: account "%1" ===
set /p YN=Sign in the "%1" account now? (y/n): 
if /i not "%YN%"=="y" exit /b
echo A browser opens. Sign in as the "%1" account. Then copy the token it prints here (it starts with sk-ant-oat).
set CLAUDE_CONFIG_DIR=%PROJ%_secrets\claude-profiles\%1
call claude setup-token
set TOK=
set /p TOK=Paste the token and press Enter: 
if "%TOK%"=="" (echo nothing pasted, skipped & exit /b)
>"%PROJ%_secrets\brain-tokens\%1.txt" echo %TOK%
echo saved.
exit /b
