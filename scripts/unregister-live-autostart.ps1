[CmdletBinding()]
param(
  [string]$TaskName = "Hanabit Hub Live 8791"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  [pscustomobject]@{
    Ok = $true
    TaskName = $TaskName
    Removed = $false
  }
  return
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
[pscustomobject]@{
  Ok = $true
  TaskName = $TaskName
  Removed = $true
}
