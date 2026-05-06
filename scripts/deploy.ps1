$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Write-Host "Running StudySphere checks..."
node scripts\check-frontend.js

Write-Host "Deploying StudySphere to Netlify production..."
netlify deploy --prod
