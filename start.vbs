' Тихий запуск Детектора взрыва мозга
Set WshShell = CreateObject("WScript.Shell")

ProjectDir = "C:\Users\Ольга\Desktop\Новая папка"
NgrokPath  = "C:\Users\Ольга\Desktop\ngrok\ngrok.exe"

' 1. Запускаем Flask (явно переходим в папку проекта)
WshShell.Run "cmd /c cd /d """ & ProjectDir & """ && python app.py", 0, False

' 2. Ждём, пока Flask поднимется
WScript.Sleep 4000

' 3. Запускаем ngrok
WshShell.Run """" & NgrokPath & """ http 5000", 0, False

' 4. Ждём, пока ngrok откроет туннель
WScript.Sleep 4000

' 5. Забираем публичную ссылку из локального API ngrok
PublicUrl = ""
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:4040/api/tunnels", False
http.Send

If http.Status = 200 Then
    Dim response, pos1, pos2
    response = http.responseText
    pos1 = InStr(response, "https://")
    If pos1 > 0 Then
        pos2 = InStr(pos1, response, """")
        PublicUrl = Mid(response, pos1, pos2 - pos1)
    End If
End If
On Error GoTo 0

' 6. Копируем ссылку в буфер обмена
If PublicUrl <> "" Then
    WshShell.Run "cmd /c echo " & PublicUrl & "| clip", 0, True
End If

' 7. Открываем браузер на панели учителя
If PublicUrl <> "" Then
    WshShell.Run PublicUrl & "/teacher", 1, False
Else
    WshShell.Run "http://localhost:5000/teacher", 1, False
End If

' 8. Уведомление
MsgBox "Детектор взрыва мозга запущен!" & vbCrLf & vbCrLf & _
       "Ссылка для учеников (уже в буфере обмена):" & vbCrLf & _
       PublicUrl & vbCrLf & vbCrLf & _
       "Вставь её в чат класса или покажи QR в панели учителя.", _
       64, "Всё готово!"