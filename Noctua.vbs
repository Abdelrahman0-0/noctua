' Starts Noctua with no console window. Used by the Desktop / Start Menu shortcuts.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
args = ""
If WScript.Arguments.Count > 0 Then args = " " & WScript.Arguments(0)
sh.Run "cmd /c node app.mjs" & args & " >> noctua.log 2>&1", 0, False
