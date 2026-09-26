' Тихая остановка Детектора взрыва мозга
Set WshShell = CreateObject("WScript.Shell")

WshShell.Run "cmd /c taskkill /IM ngrok.exe /F", 0, True
WshShell.Run "cmd /c taskkill /FI ""WINDOWTITLE eq *app.py*"" /F", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :5000') do taskkill /F /PID %a", 0, True

MsgBox "Всё остановлено.", 64, "Готово"