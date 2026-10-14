param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
try {
    $readerExecutable = Join-Path $PSScriptRoot 'release\win-unpacked\UE Reader.exe'
    if (-not (Test-Path -LiteralPath $readerExecutable)) { throw 'Build the desktop app first: npm run package:desktop' }
    Start-Process -FilePath $readerExecutable -WorkingDirectory (Split-Path -Parent $readerExecutable)
} catch {
    Write-Host $_.Exception.Message
    if ($Quiet) { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'UE Reader') | Out-Null }
    exit 1
}
