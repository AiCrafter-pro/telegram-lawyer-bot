@echo off
:: Change code page to UTF-8 to prevent Korean/foreign character encoding issues (E.g. broken text in console)
chcp 65001 > nul

echo ==============================================
echo Starting PooShong Telegram Lawyer AI Bot...
echo ==============================================
echo.

echo Checking and applying korean-law-mcp updates...
call npm install korean-law-mcp@latest --no-fund --no-audit
echo.
echo Update completed. Preparing to start the bot...
echo.

:: Run the bot
node bot.js

echo.
pause
