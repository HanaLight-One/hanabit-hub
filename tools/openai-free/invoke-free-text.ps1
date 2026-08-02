param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [string]$Model,

    [string]$JsonSchemaFile,

    [ValidateRange(1, 128000)]
    [int]$MaxOutputTokens = 512
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "key-store.ps1")

$venvPython = Join-Path $PSScriptRoot "runtime\.venv\Scripts\python.exe"
$runner = Join-Path $PSScriptRoot "invoke-free-text.py"
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw "전용 Python 가상환경이 없습니다. README의 설치 명령을 실행하세요."
}

$keyState = Import-OpenAIKeyForProcess
$exitCode = 1
try {
    $arguments = @(
        $runner,
        "--prompt-file", [IO.Path]::GetFullPath($PromptFile),
        "--output", [IO.Path]::GetFullPath($Output),
        "--max-output-tokens", $MaxOutputTokens
    )
    if ($Model) {
        $arguments += @("--model", $Model)
    }
    if ($JsonSchemaFile) {
        $arguments += @("--json-schema-file", [IO.Path]::GetFullPath($JsonSchemaFile))
    }
    & $venvPython @arguments
    $exitCode = $LASTEXITCODE
}
finally {
    Restore-OpenAIKeyAfterProcess -State $keyState
}

exit $exitCode
