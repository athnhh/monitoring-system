@echo off
echo.
echo ============================================
echo   TEST - Employee Management System
echo ============================================
echo.
echo Installing dependencies...
call npm install
echo.
echo Starting server...
echo Open http://localhost:3000 in your browser
echo.
node server.js
pause
