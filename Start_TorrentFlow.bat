@echo off
title TorrentFlow Desktop Server
cd /d "%~dp0"
echo ========================================================
echo   TorrentFlow Interactive Desktop Server
echo   Running directly in your active user session.
echo   Local Address: http://localhost:3000
echo ========================================================
node server.js
pause
