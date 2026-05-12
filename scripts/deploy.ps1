$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Write-Host "Running Minallo checks..."
node scripts\check-frontend.js

Write-Host "Deploying Minallo to Netlify production..."
netlify deploy --prod
