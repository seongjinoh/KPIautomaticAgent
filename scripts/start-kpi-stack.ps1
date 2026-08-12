# KPI API + ngrok 터널 한 번에 실행 (Vercel/외부 접속용)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server = Join-Path $Root 'server'
$Policy = Join-Path $Server 'ngrok-traffic-policy.yml'

Write-Host "=== KPI 스택 시작 ===" -ForegroundColor Cyan
Write-Host "프로젝트: $Root"

function Stop-Port($port) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Stop-Port 8787
Stop-Port 4040
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "[1/2] KPI API 시작 (8787)..." -ForegroundColor Yellow
Start-Process -FilePath 'python' -ArgumentList 'kpi_api.py' -WorkingDirectory $Server -WindowStyle Minimized

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 3
    break
  } catch { Start-Sleep -Milliseconds 500 }
}

Write-Host "[2/2] ngrok 시작..." -ForegroundColor Yellow
Start-Process -FilePath 'ngrok' -ArgumentList @(
  'http', '127.0.0.1:8787',
  '--traffic-policy-file', $Policy,
  '--log=stdout'
) -WorkingDirectory $Server -WindowStyle Minimized

Start-Sleep -Seconds 3
$tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 10
$url = ($tunnels.tunnels | Select-Object -First 1).public_url

Write-Host ""
Write-Host "로컬 API : http://127.0.0.1:8787" -ForegroundColor Green
Write-Host "ngrok URL: $url" -ForegroundColor Green
Write-Host "Vercel   : https://kpi-automatic-agent.vercel.app (이 PC 켜져 있어야 함)" -ForegroundColor Green
Write-Host "ngrok 대시보드: http://127.0.0.1:4040" -ForegroundColor DarkGray
Write-Host ""
Write-Host "종료: 작업 관리자에서 python.exe / ngrok.exe 종료" -ForegroundColor DarkGray
