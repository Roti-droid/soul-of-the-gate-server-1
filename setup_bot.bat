@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Подключение бота доната «Кристальный забег» ===
echo Сначала один раз запусти deploy.bat. Этот файл запускай один раз, чтобы подключить бота.
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo Не найден Node.js. Установи его с https://nodejs.org ^(версия LTS^) и запусти этот файл снова.
  goto fail
)
if not exist node_modules (
  echo === установка ^(npm install^) ===
  call npm install
  if errorlevel 1 goto fail
)
call npx wrangler whoami > "%TEMP%\crystal_whoami.txt" 2>&1
findstr /c:"associated with" "%TEMP%\crystal_whoami.txt" >nul
if errorlevel 1 (
  echo Нужен вход в Cloudflare: откроется браузер, нажми Allow
  call npx wrangler login
  if errorlevel 1 goto fail
)
echo.
node setup_bot.mjs
if errorlevel 1 goto fail
pause
exit /b 0
:fail
echo.
echo ОШИБКА. Сделай скриншот этого окна и пришли в чат.
pause
exit /b 1
