$script:OpenAIKeyStorePath = if ($env:OPENAI_DPAPI_KEY_PATH) {
    [IO.Path]::GetFullPath($env:OPENAI_DPAPI_KEY_PATH)
}
else {
    Join-Path $PSScriptRoot "runtime\openai-api-key.dpapi"
}

function Import-OpenAIKeyForProcess {
    if (Test-Path Env:OPENAI_API_KEY) {
        return [pscustomobject]@{
            LoadedFromStore = $false
            HadExisting = $true
            PreviousValue = $env:OPENAI_API_KEY
        }
    }
    if (-not (Test-Path -LiteralPath $script:OpenAIKeyStorePath -PathType Leaf)) {
        throw ((
            "OPENAI_API_KEY가 없고 DPAPI 키 저장소도 없습니다: {0}`n" +
            "키 저장 도구를 사용해 최초 한 번 저장하세요."
        ) -f $script:OpenAIKeyStorePath)
    }

    $encrypted = (Get-Content -LiteralPath $script:OpenAIKeyStorePath -Raw).Trim()
    $secureKey = ConvertTo-SecureString $encrypted
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        if ([string]::IsNullOrWhiteSpace($plainKey)) {
            throw "DPAPI 저장소에서 복호화한 API 키가 비어 있습니다."
        }
        $env:OPENAI_API_KEY = $plainKey
    }
    finally {
        if ($keyPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
        }
        Remove-Variable plainKey -ErrorAction SilentlyContinue
        Remove-Variable secureKey -ErrorAction SilentlyContinue
        Remove-Variable encrypted -ErrorAction SilentlyContinue
    }

    return [pscustomobject]@{
        LoadedFromStore = $true
        HadExisting = $false
        PreviousValue = $null
    }
}

function Restore-OpenAIKeyAfterProcess {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$State
    )

    if ($State.LoadedFromStore) {
        Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    }
    elseif ($State.HadExisting) {
        $env:OPENAI_API_KEY = $State.PreviousValue
    }
}
