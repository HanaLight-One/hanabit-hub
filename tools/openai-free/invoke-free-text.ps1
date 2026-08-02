param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [string]$Model,

    [string]$JsonSchemaFile,

    [string]$PythonExecutablePath,

    [string]$KeyStorePath,

    [ValidateRange(1, 128000)]
    [int]$MaxOutputTokens = 512
)

$ErrorActionPreference = "Stop"
$hadPreviousKeyStorePath = Test-Path Env:OPENAI_DPAPI_KEY_PATH
$previousKeyStorePath = $env:OPENAI_DPAPI_KEY_PATH
$exitCode = 1
try {
    if ($KeyStorePath) {
        if (-not [IO.Path]::IsPathRooted($KeyStorePath)) {
            throw "키 저장소는 절대경로여야 합니다."
        }
        $env:OPENAI_DPAPI_KEY_PATH = [IO.Path]::GetFullPath($KeyStorePath)
    }
    . (Join-Path $PSScriptRoot "key-store.ps1")

    if ($PythonExecutablePath -and -not [IO.Path]::IsPathRooted($PythonExecutablePath)) {
        throw "Python 실행 파일은 절대경로여야 합니다."
    }
    if ($env:HANABIT_OPENAI_FREE_PYTHON -and
        -not [IO.Path]::IsPathRooted($env:HANABIT_OPENAI_FREE_PYTHON)) {
        throw "Python 실행 환경변수는 절대경로여야 합니다."
    }
    $venvPython = if ($PythonExecutablePath) {
        [IO.Path]::GetFullPath($PythonExecutablePath)
    }
    elseif ($env:HANABIT_OPENAI_FREE_PYTHON) {
        [IO.Path]::GetFullPath($env:HANABIT_OPENAI_FREE_PYTHON)
    }
    else {
        Join-Path $PSScriptRoot "runtime\.venv\Scripts\python.exe"
    }
    $runner = Join-Path $PSScriptRoot "invoke-free-text.py"
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        throw "전용 Python 가상환경이 없습니다. README의 설치 명령을 실행하세요."
    }

    $keyState = Import-OpenAIKeyForProcess
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
}
finally {
    if ($hadPreviousKeyStorePath) {
        $env:OPENAI_DPAPI_KEY_PATH = $previousKeyStorePath
    }
    else {
        Remove-Item Env:OPENAI_DPAPI_KEY_PATH -ErrorAction SilentlyContinue
    }
}

exit $exitCode
