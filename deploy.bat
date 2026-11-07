@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 1/3: установка (npm install) ===
call npm install
if errorlevel 1 goto fail
echo.
echo === 2/3: проверка входа в Cloudflare ===
call npx wrangler whoami > "%TEMP%\crystal_whoami.txt" 2>&1
findstr /c:"associated with" "%TEMP%\crystal_whoami.txt" >nul
if errorlevel 1 (
  echo Нужен вход: откроется браузер, нажми Allow
  call npx wrangler login
  if errorlevel 1 goto fail
) else (
  echo Уже вошли в Cloudflare.
)
echo.
echo === 3/3: заливка игры и сервера ===
call npx wrangler deploy
if errorlevel 1 goto fail
echo.
echo ГОТОВО! Игра: https://crystal-run-server.ken729710.workers.dev/
echo Проверка сервера: https://crystal-run-server.ken729710.workers.dev/health
pause
exit /b 0
:fail
echo.
echo ОШИБКА. Сделай скриншот этого окна и пришли в чат.
pause
exit /b 1
