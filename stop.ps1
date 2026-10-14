param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$readerPidFile = Join-Path $PSScriptRoot '.runtime/server.pid'
$readerEntry = Join-Path $PSScriptRoot 'server/index.mjs'
$readerPort = if ($env:PORT) { $env:PORT } else { '4317' }
$readerUrl = "http://127.0.0.1:$readerPort"
try {
    $readerControl = $null
    try { $readerControl = Invoke-RestMethod -Uri "$readerUrl/api/lifecycle" -TimeoutSec 2 } catch { }
    if ($readerControl.service -eq 'ue-reader') {
        if ($readerControl.projectRoot -ne $PSScriptRoot) { throw 'This port belongs to another UE Reader installation.' }
        try {
            Invoke-RestMethod -Uri "$readerUrl/api/shutdown" -Method Post -ContentType 'application/json' -Body (@{ token = $readerControl.token } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
        } catch { throw 'UE Reader could not stop. Complete or cancel any running question, wait for saving to finish, then try again.' }
        $readerProcessId = [int]$readerControl.pid
    } else {
        # Compatibility with a server started before the shutdown API was added.
        $readerListener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort ([int]$readerPort) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $readerListener) { Write-Host 'UE Reader is already stopped.'; exit 0 }
        $readerProcessId = [int]$readerListener.OwningProcess
        $readerProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $readerProcessId" -ErrorAction SilentlyContinue
        if (-not $readerProcessInfo) { Write-Host 'UE Reader is already stopped.'; exit 0 }
        if ($readerProcessInfo.Name -ne 'node.exe' -or -not $readerProcessInfo.CommandLine.Contains($readerEntry)) { throw 'The saved process ID does not belong to this UE Reader. No process was stopped.' }
        $env:UE_READER_CONTROL_URL = $readerUrl
        & node --input-type=module -e "const b=await fetch(process.env.UE_READER_CONTROL_URL+'/api/bootstrap').then(r=>r.json()); if(b.version!==1 || !Array.isArray(b.runningJobs) || b.runningJobs.length) process.exit(1);"
        if ($LASTEXITCODE -ne 0) { throw 'Could not verify the old server is idle. Complete or cancel running requests first.' }
        Stop-Process -Id $readerProcessId
    }
    for ($readerAttempt = 0; $readerAttempt -lt 60; $readerAttempt++) {
        if (-not (Get-Process -Id $readerProcessId -ErrorAction SilentlyContinue)) {
            if ((Test-Path -LiteralPath $readerPidFile) -and [int](Get-Content -LiteralPath $readerPidFile) -eq $readerProcessId) { Remove-Item -LiteralPath $readerPidFile }
            Write-Host 'UE Reader stopped.'
            exit 0
        }
        Start-Sleep -Milliseconds 250
    }
    throw 'UE Reader is still finishing a task. Try again shortly.'
} catch {
    Write-Host $_.Exception.Message
    if ($Quiet) { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'UE Reader') | Out-Null }
    exit 1
}
