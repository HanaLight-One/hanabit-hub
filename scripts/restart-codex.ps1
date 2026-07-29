[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Start-Sleep -Milliseconds 1200

$package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop
$installRoot = [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd("\") + "\"
$processNames = @("codex", "codex-code-mode-host")

$targets = Get-Process -Name $processNames -ErrorAction SilentlyContinue |
  Where-Object {
    try {
      $_.Path.StartsWith(
        $installRoot,
        [StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      $false
    }
  }

foreach ($target in $targets) {
  Stop-Process -Id $target.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 1800

$explorerPath = Join-Path $env:SystemRoot "explorer.exe"
$appId = "shell:AppsFolder\$($package.PackageFamilyName)!App"
Start-Process -FilePath $explorerPath -ArgumentList $appId
