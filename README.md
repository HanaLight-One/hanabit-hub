# Hanabit Hub

하나빛의 로컬 관리자 허브입니다.

현재 단계에서는 작고 안전한 Node.js 서버와 정적 프런트엔드로 시작합니다.
기존 Image Studio, 이미지 저장소, 생성 파이프라인, 예약 작업은 이동하거나
변경하지 않고 이후 독립 모듈로 연결합니다.

## 시작하기

요구 사항:

- Node.js 22 이상

```powershell
Copy-Item config.example.json config.local.json
npm.cmd run dev
```

기본 개발 주소는 `http://127.0.0.1:8790`입니다. 기존 운영 서버의 8787
포트와 Cloudflare 연결은 전환 승인 전까지 유지합니다.

검증된 커밋만 실행하는 안정 운영본은 별도 checkout과 8791 포트를 사용합니다.
구성과 배포·복구 절차는
[docs/live-runtime.md](./docs/live-runtime.md)를 참고하세요.

## 명령

- `npm.cmd run dev`: 파일 변경을 감지하는 개발 서버
- `npm.cmd start`: 일반 서버 실행
- `npm.cmd run check`: JavaScript 문법과 기본 테스트 확인
- `scripts/start-hidden.ps1`: 현재 checkout의 설정 포트로 서버를 숨김 실행

## 설정

운영 환경에 종속된 경로는 `config.local.json`에만 작성합니다. 이 파일은
Git에 포함되지 않습니다. 새 설정 항목을 추가할 때는 실제 값이 없는
`config.example.json`도 함께 갱신합니다.

Image Studio 코드 이전 계획과 외부 설정 대상은
[docs/image-studio-migration.md](./docs/image-studio-migration.md)에 기록되어
있습니다. 날짜별 테마는 서울 시간 오전 02시를 기준으로 운영일을 구분하며,
`/images`의 전체 보기에는 현재 운영일 테마, 날짜별 보기에는 보관된 그날의
테마를 표시합니다.

현재 Image Studio 이전 단계에서는 `config.local.json`에 기존 이미지·상태·
파이프라인 경로를 기록하되 `integrations.imageStudio.enabled`를 `false`로
유지합니다. 이는 경로 검증과 코드 분리를 위한 준비 설정이며 기존 8787 서버,
Cloudflare Tunnel, 시작프로그램 및 예약 작업을 전환하지 않습니다.

## 안전 원칙

- 저장소·파이프라인·예약 작업의 기존 파일 위치를 옮기지 않습니다.
- 임의 명령 실행이나 임의 경로 접근 API를 만들지 않습니다.
- 서버 작업은 코드에 명시된 allowlist만 허용합니다.
- `.env`, 키, 토큰, 쿠키, 세션, 로그, 상태 파일을 커밋하지 않습니다.
- 배포와 Cloudflare 변경은 별도 승인 후 진행합니다.

구조와 확장 기준은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요.
