@echo off
setlocal
cd /d "%~dp0"

if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

:: Fire-and-forget browser opener: fires as soon as the port accepts connections
start "" /b powershell -NoProfile -Command ^
    "$url='http://127.0.0.1:8000';" ^
    "for($i=0;$i -lt 150;$i++){" ^
    "  try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8000); $c.Close(); Start-Process $url; break }catch{}" ^
    "  Start-Sleep -Milliseconds 200" ^
    "}"

uvicorn app.main:app --reload

endlocal