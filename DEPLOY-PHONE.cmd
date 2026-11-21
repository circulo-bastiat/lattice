@echo off
rem DEPLOY-PHONE.cmd - put the latest LANDED phone app on the phone's website (https://owner.github.io/mclite-phone/). Then open the app and pull down.
cd /d "%~dp0"
node tools\phone-web\deploy.mjs
pause
