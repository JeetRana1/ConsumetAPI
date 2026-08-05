$ErrorActionPreference = 'Stop'
$logFile = Join-Path $PSScriptRoot 'run.log'
$attempt = 0
while ($true) {
    $attempt++
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "[$timestamp] Starting consumet-api (attempt $attempt)..."
    try {
        $process = Start-Process -NoNewWindow -FilePath 'node' -ArgumentList 'dist/main.js' -Wait -PassThru
        $exitCode = $process.ExitCode
        Add-Content -Path $logFile -Value "[$timestamp] Process exited with code $exitCode"
    } catch {
        Add-Content -Path $logFile -Value "[$timestamp] Failed to start: $_"
    }
    Start-Sleep -Seconds 3
}
