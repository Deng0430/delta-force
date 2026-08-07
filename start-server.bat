@echo off
setlocal

cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [ERROR] Dependencies are missing. Run: npm.cmd install
  pause
  exit /b 1
)

echo Starting map-tools server...
echo Local address: http://127.0.0.1:5173
echo Press Ctrl+C to stop the server.
echo.

call npm.cmd run dev -- --host 127.0.0.1 --port 5173

if errorlevel 1 (
  echo.
  echo [ERROR] The server stopped with an error.
  pause
)

endlocal
