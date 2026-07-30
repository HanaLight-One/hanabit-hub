[CmdletBinding()]
param(
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Root)) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $Root = Split-Path -Parent $scriptDirectory
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$configPath = Join-Path $resolvedRoot "config.local.json"
$serverPath = Join-Path $resolvedRoot "src\server.mjs"

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "config.local.json이 필요합니다."
}
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw "src\server.mjs를 찾을 수 없습니다."
}

$config = Get-Content -Raw -Encoding utf8 -LiteralPath $configPath | ConvertFrom-Json
$port = [int]$config.port
if ($port -lt 1024 -or $port -gt 65535) {
  throw "설정 포트가 유효하지 않습니다."
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listener) {
  try {
    $health = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$port/api/health" `
      -TimeoutSec 3 `
      -ErrorAction Stop
  } catch {
    throw "$port 포트가 다른 프로세스에서 사용 중입니다."
  }

  if ($health.ok -ne $true -or $health.service -ne "hanabit-hub") {
    throw "$port 포트가 다른 서비스에서 사용 중입니다."
  }

  Set-Content `
    -Encoding ascii `
    -LiteralPath (Join-Path $resolvedRoot "state\hub-$port.pid") `
    -Value $listener[0].OwningProcess

  [pscustomobject]@{
    Ok = $true
    Port = $port
    ProcessId = $listener[0].OwningProcess
    AlreadyRunning = $true
  }
  return
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logRoot = Join-Path $resolvedRoot "state\logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList "src/server.mjs" `
  -WorkingDirectory $resolvedRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logRoot "hub-$port.out.log") `
  -RedirectStandardError (Join-Path $logRoot "hub-$port.err.log") `
  -PassThru

$listening = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $listening = Get-NetTCPConnection `
    -State Listen `
    -LocalPort $port `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -eq $process.Id }
  if ($listening) {
    break
  }
  if ($process.HasExited) {
    break
  }
}

if (-not $listening) {
  throw "서버가 $port 포트에서 시작되지 않았습니다. state\logs를 확인하세요."
}

Set-Content `
  -Encoding ascii `
  -LiteralPath (Join-Path $resolvedRoot "state\hub-$port.pid") `
  -Value $process.Id

[pscustomobject]@{
  Ok = $true
  Port = $port
  ProcessId = $process.Id
  AlreadyRunning = $false
}
