# Hanabit Hub

하나빛의 로컬 관리자 허브입니다.

현재 단계에서는 작고 안전한 Node.js 서버를 유지하면서 `/news`부터 React로
단계적으로 전환합니다. 다른 화면은 기존 정적 프런트엔드를 그대로 사용합니다.
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
- `npm.cmd run news:build`: React 뉴스 검수실 번들 생성
- `npm.cmd run notifications:build`: React 모바일 알림 설정 화면 번들 생성
- `npm.cmd run db:init`: Git 제외 상태 폴더에 SQLite 뉴스 원장 스키마 준비
- `scripts/start-hidden.ps1`: 현재 checkout의 설정 포트로 서버를 숨김 실행
- `scripts/register-live-autostart.ps1`: 승인된 8791 운영본을 로그인 자동 시작으로 등록
- `scripts/unregister-live-autostart.ps1`: 8791 로그인 자동 시작 작업만 제거
- `scripts/restart-codex.ps1`: 허용된 긴급 제어 API가 호출하는 Codex 전용 재기동 도우미
- `npm.cmd run news:discord:check`: HANABIT NEWS LAB Guild·채널 연결만 확인
- `npm.cmd run news:discord:test`: 연결 확인 후 `#news-log`에 테스트 메시지 1건 전송
- `npm.cmd run news:discord:collect:dry`: 최근 Discord 공지 수집 대상을 쓰기 없이 확인
- `npm.cmd run news:discord:collect`: 신규 Discord 공지를 로컬 뉴스 대기함에 저장
- `npm.cmd run news:x:rules:preview`: X 자동 감지 규칙을 외부 변경 없이 미리 확인
- `npm.cmd run news:x:rules:sync`: 승인 후 Hanabit 소유 X Filtered Stream 규칙만 등록
- `npm.cmd run news:discord:watch`: Gateway 새 공지를 실시간 감시하고 재접속 시 보충
- `scripts/register-news-watcher-autostart.ps1`: 뉴스 감시기 로그인 자동 시작 등록
- `scripts/unregister-news-watcher-autostart.ps1`: 뉴스 감시기 작업만 중지·삭제

## 설정

운영 환경에 종속된 경로는 `config.local.json`에만 작성합니다. 이 파일은
Git에 포함되지 않습니다. 새 설정 항목을 추가할 때는 실제 값이 없는
`config.example.json`도 함께 갱신합니다.

Image Studio 코드 이전 계획과 외부 설정 대상은
[docs/image-studio-migration.md](./docs/image-studio-migration.md)에 기록되어
있습니다. 날짜별 테마는 서울 시간 오전 02시를 기준으로 운영일을 구분하며,
`/images`의 전체 보기에는 현재 운영일 테마, 날짜별 보기에는 보관된 그날의
테마를 표시합니다.

Owner Only 허브의 `/images/styles`에서는 설정된 운영 화풍 폴더의 TXT를
내려받거나 새 파일로 추가할 수 있습니다. 업로드가 성공하면 기존 Python 색인
빌더를 실행해 생성기 목록을 갱신합니다. 같은 이름의 파일 덮어쓰기와 삭제는
지원하지 않습니다.

현재 Image Studio 이전 단계에서는 `config.local.json`에 기존 이미지·상태·
파이프라인 경로를 기록하되 `integrations.imageStudio.enabled`를 `false`로
유지합니다. 이는 경로 검증과 코드 분리를 위한 준비 설정이며 기존 8787 서버,
Cloudflare Tunnel, 시작프로그램 및 예약 작업을 전환하지 않습니다.

운세 모듈은 `integrations.fortune`에 기존 `fortune.txt` 출력 루트와 게시자 상태
루트를 절대경로로 주입하면 `/fortune`에서 날짜별 본문과 정제된 게시 상태를
읽기 전용으로 제공합니다. 생성식·템플릿·로그·원본 데이터·게시 동작에는
접근하지 않습니다.

## 안전 원칙

- 저장소·파이프라인·예약 작업의 기존 파일 위치를 옮기지 않습니다.
- 임의 명령 실행이나 임의 경로 접근 API를 만들지 않습니다.
- 서버 작업은 코드에 명시된 allowlist만 허용합니다.
- 뉴스 DC 승인은 게시 대기 영수증만 저장하며 실제 게시자를 실행하지 않습니다.
- Codex 긴급 재기동은 `allowedActions`에 `restart-codex`가 있을 때만 활성화되며,
  임의 명령·경로·인수를 받지 않습니다.
- `.env`, 키, 토큰, 쿠키, 세션, 로그, 상태 파일을 커밋하지 않습니다.
- 배포와 Cloudflare 변경은 별도 승인 후 진행합니다.

구조와 확장 기준은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요.
Discord 뉴스 수집기의 일회성 연결 테스트는
[docs/news-lab-discord.md](./docs/news-lab-discord.md)를 참고하세요.
뉴스 수집부터 번역·판정·게시까지의 경계는
[docs/news-pipeline.md](./docs/news-pipeline.md)를 참고하세요.
모바일 Web Push의 연결 방법과 현재 자동화 범위는
[docs/mobile-notifications.md](./docs/mobile-notifications.md)를 참고하세요.
뉴스 사건 원장과 SQLite 마이그레이션 경계는
[docs/database.md](./docs/database.md)를 참고하세요.
