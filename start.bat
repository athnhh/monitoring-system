@echo off
echo.
@echo off
echo.
echo ============================================
echo   Quemahtech Employee Management System
echo ============================================
echo.
echo Installing dependencies...
call npm install
echo.
echo If using Firebase, copy .env.example to .env and fill in credentials.
echo Without .env, the app will use local file storage (data.json).
echo.
echo Starting server...
echo Open http://localhost:3000 in your browser
echo.
node server.js
pause
