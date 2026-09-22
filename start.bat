@echo off
:: 한글 출력과 실행 위치를 고정합니다.
chcp 65001 > nul
cd /d "%~dp0"

echo ==============================================
echo Starting PooShong Telegram Lawyer AI Bot...
echo ==============================================
echo.

if not exist "node_modules\korean-law-mcp\build\index.js" (
    echo 패키지가 설치되지 않았습니다. 이 폴더에서 npm ci를 먼저 실행해주세요.
    pause
    exit /b 1
)

:: package-lock.json으로 검증한 설치본을 사용하며 실행 중 업데이트하지 않습니다.
call npm start

echo.
pause
