param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDirectory,

    [Parameter(Mandatory = $true)]
    [ValidateSet("sync-openai-free-runner")]
    [string]$Confirm
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repositoryRoot "tools\openai-free"

if (-not [IO.Path]::IsPathRooted($TargetDirectory)) {
    throw "대상 폴더는 절대경로여야 합니다."
}
$targetRoot = [IO.Path]::GetFullPath($TargetDirectory)
if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
    throw "대상 폴더가 존재하지 않습니다."
}
if (-not (Test-Path -LiteralPath (Join-Path $targetRoot "runtime") -PathType Container) -or
    -not (Test-Path -LiteralPath (Join-Path $targetRoot "key-store.ps1") -PathType Leaf)) {
    throw "기존 공용 실행기 폴더만 동기화할 수 있습니다."
}

$allowedFiles = @(
    "invoke-free-text.ps1",
    "invoke-free-text.py",
    "key-store.ps1",
    "requirements.txt"
)

foreach ($name in $allowedFiles) {
    $source = Join-Path $sourceRoot $name
    $target = Join-Path $targetRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "정본 파일이 없습니다: $name"
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Output "공용 무료 텍스트 실행기 코드 동기화 완료"
