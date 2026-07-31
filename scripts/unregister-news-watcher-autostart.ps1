[CmdletBinding()]
param([string]$TaskName = "Hanabit News Discord Watcher")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  [pscustomobject]@{ Ok = $true; Removed = $false; TaskName = $TaskName }
  return
}

if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
[pscustomobject]@{ Ok = $true; Removed = $true; TaskName = $TaskName }
