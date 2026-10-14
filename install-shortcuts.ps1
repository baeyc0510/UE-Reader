$ErrorActionPreference = 'Stop'
$readerExecutable = Join-Path $PSScriptRoot 'release\win-unpacked\UE Reader.exe'
if (-not (Test-Path -LiteralPath $readerExecutable)) { throw 'Build the desktop app first: npm run package:desktop' }
$readerDesktop = [Environment]::GetFolderPath('Desktop')
$readerShell = New-Object -ComObject WScript.Shell
$readerShortcut = $readerShell.CreateShortcut((Join-Path $readerDesktop 'UE Reader.lnk'))
$readerShortcut.TargetPath = $readerExecutable
$readerShortcut.Arguments = ''
$readerShortcut.WorkingDirectory = Split-Path -Parent $readerExecutable
$readerShortcut.Description = 'UE Reader desktop app'
$readerShortcut.IconLocation = $readerExecutable + ',0'
$readerShortcut.Save()
$readerOldStop = Join-Path $readerDesktop 'UE Reader - Stop.lnk'
if (Test-Path -LiteralPath $readerOldStop) {
    $readerOldShortcut = $readerShell.CreateShortcut($readerOldStop)
    if ($readerOldShortcut.Arguments.Contains((Join-Path $PSScriptRoot 'launcher.vbs'))) { Remove-Item -LiteralPath $readerOldStop }
}
Write-Host 'Desktop shortcut created: UE Reader. Close the app window to exit.'
