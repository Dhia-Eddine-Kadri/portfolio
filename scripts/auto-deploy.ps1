$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$watchPaths = @(
  "frontend",
  "backend",
  "netlify.toml"
)

$deployScript = Join-Path $PSScriptRoot "deploy.ps1"
$debounceSeconds = 8
$lastChange = Get-Date
$pending = $true
$deploying = $false

function Request-Deploy {
  $script:lastChange = Get-Date
  $script:pending = $true
}

function Start-Deploy {
  if ($script:deploying) { return }
  $script:pending = $false
  $script:deploying = $true
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $deployScript
  } catch {
    Write-Host "Deploy failed: $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    $script:deploying = $false
  }
}

$watchers = @()
foreach ($relativePath in $watchPaths) {
  $fullPath = Join-Path $root $relativePath
  if (Test-Path $fullPath -PathType Container) {
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $fullPath
    $watcher.IncludeSubdirectories = $true
    $watcher.EnableRaisingEvents = $true
  } elseif (Test-Path $fullPath -PathType Leaf) {
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = Split-Path $fullPath -Parent
    $watcher.Filter = Split-Path $fullPath -Leaf
    $watcher.IncludeSubdirectories = $false
    $watcher.EnableRaisingEvents = $true
  } else {
    continue
  }

  Register-ObjectEvent $watcher Changed -Action { Request-Deploy } | Out-Null
  Register-ObjectEvent $watcher Created -Action { Request-Deploy } | Out-Null
  Register-ObjectEvent $watcher Deleted -Action { Request-Deploy } | Out-Null
  Register-ObjectEvent $watcher Renamed -Action { Request-Deploy } | Out-Null
  $watchers += $watcher
}

Write-Host "Watching Minallo for changes. Press Ctrl+C to stop."
Write-Host "Initial deploy will run after a short debounce."

while ($true) {
  Start-Sleep -Seconds 1
  if ($pending -and -not $deploying) {
    $elapsed = (Get-Date) - $lastChange
    if ($elapsed.TotalSeconds -ge $debounceSeconds) {
      Start-Deploy
    }
  }
}
