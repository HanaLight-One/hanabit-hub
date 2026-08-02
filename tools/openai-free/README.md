# 공용 무료 텍스트 실행기 정본

이 폴더는 하나빛 Hub가 사용하는 Responses API 텍스트 실행기의 **복구 가능한
Git 정본**이다. 운영 중인 외부 실행 경로는 즉시 이동하지 않으며, 검증된 정본을
명시적으로 동기화할 때만 갱신한다.

## Git에 포함하지 않는 것

- API 키와 환경변수 값
- DPAPI 암호문
- Python 가상환경
- 프롬프트, 출력, 메타데이터와 로그

이 값들은 `runtime/` 또는 운영 환경에만 둔다. `runtime/`은 이 폴더의
`.gitignore`로 제외된다.

## 실행 계약

`invoke-free-text.ps1`은 프롬프트와 출력 경로를 필수로 받는다.
`-JsonSchemaFile`을 제공한 요청만 Responses API의 strict Structured Outputs를
사용하며, 생략한 기존 텍스트 호출은 자유 형식 응답을 유지한다.
`-PythonExecutablePath`와 `-KeyStorePath`를 지정하면 코드 정본과 외부 실행환경을
분리할 수 있다. 이미지 worker는 같은 값을 각각 `HANABIT_OPENAI_FREE_PYTHON`,
`OPENAI_DPAPI_KEY_PATH` 환경변수로 전달받는다.

```powershell
.\invoke-free-text.ps1 `
  -PromptFile .\runtime\prompt.txt `
  -Output .\runtime\answer.json `
  -JsonSchemaFile .\runtime\answer-schema.json `
  -PythonExecutablePath <외부 Python 절대경로> `
  -KeyStorePath <외부 DPAPI 키 파일 절대경로>
```

Python 환경은 다음처럼 재구성한다.

```powershell
python -m venv .\runtime\.venv
.\runtime\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

키 저장과 운영 경로 전환은 별도 승인·검증 단계다. 정본 동기화 스크립트는 코드와
의존성 선언만 allowlist로 복사하며 `runtime/`과 키 파일은 건드리지 않는다.
