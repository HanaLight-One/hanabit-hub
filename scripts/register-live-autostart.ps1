[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$TaskName = "Hanabit Hub Live 8791"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Root)) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $Root = Split-Path -Parent $scriptDirectory
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$configPath = Join-Path $resolvedRoot "config.local.json"
$startScript = Join-Path $resolvedRoot "scripts\start-hidden.ps1"

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "config.local.json이 필요합니다."
}
if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
  throw "scripts\start-hidden.ps1을 찾을 수 없습니다."
}

$config = Get-Content -Raw -Encoding utf8 -LiteralPath $configPath | ConvertFrom-Json
if ([int]$config.port -ne 8791) {
  throw "안정 운영 포트가 8791인 checkout만 자동 시작으로 등록할 수 있습니다."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$actionArguments = (
  '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden ' +
  "-File `"$startScript`" -Root `"$resolvedRoot`""
)

$action = New-ScheduledTaskAction `
  -Execute $powerShellPath `
  -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$trigger.Delay = "PT20S"
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Hanabit Hub 안정 운영본(8791)을 로그인 후 숨김 실행합니다." `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
[pscustomobject]@{
  Ok = $true
  TaskName = $registered.TaskName
  State = $registered.State
  User = $identity
  DelaySeconds = 20
  Port = 8791
}
