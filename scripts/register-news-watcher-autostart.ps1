[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$TaskName = "Hanabit News Discord Watcher"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Root)) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $Root = Split-Path -Parent $scriptDirectory
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$envPath = Join-Path $resolvedRoot ".env"
$watchScript = Join-Path $resolvedRoot "scripts\watch-discord-announcements.mjs"
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  throw ".env is required."
}
if (-not (Test-Path -LiteralPath $watchScript -PathType Leaf)) {
  throw "Discord news watcher script was not found."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$actionArguments = '"' + $watchScript + '"'
$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument $actionArguments `
  -WorkingDirectory $resolvedRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$trigger.Delay = "PT25S"
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "HANABIT NEWS LAB Discord Announcement watcher" `
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
  DelaySeconds = 25
  RestartCount = 10
}
