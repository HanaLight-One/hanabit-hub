# 하나빛 허브 프로젝트 지도

새 작업자와 Codex 에이전트는 먼저 이 문서를 읽고, 세부 결정은
`ARCHITECTURE.md`, 실행 방법은 `README.md`와 `docs/`에서 확인한다.
이 지도에는 컴퓨터별 절대경로와 비밀값을 기록하지 않는다.

## 한눈에 보는 흐름

```text
브라우저
  ├─ 정적 화면 ─────────────── public/
  ├─ React 화면 소스 ───────── frontend/ ── Vite 빌드 ──> public/
  └─ 안전한 HTTP API
             │
             v
       src/server.mjs
             │
   ┌─────────┼──────────┬────────────┬──────────────┐
   v         v          v            v              v
 images/   fortune/    news/   notifications/    system/
   │         │          │            │              │
   └─────────┴──────────┴────────────┴──────────────┘
             │
      config.local.json 경계
             │
   외부 이미지·Python·운세 저장소 / Git 제외 state/
```

핵심 원칙은 프론트가 로컬 파일 경로를 모르고 API만 사용하며, 서버는
`config.local.json`에 허용된 외부 루트만 접근하는 것이다.

## 실행 위치와 포트

| 역할 | checkout 이름 | 포트 | 용도 |
| --- | --- | ---: | --- |
| 기존 Image Studio | 기존 운영 폴더 | 8787 | 복구 가능한 기존 운영본, 이동 금지 |
| Hub 개발본 | `hanabit-hub` | 8790 | 개발과 검증 |
| Hub 안정 운영본 | `hanabit-hub-live` | 8791 | 검증된 커밋만 detached checkout |

실제 컴퓨터 경로와 외부 저장소 위치는 추적하지 않는다. 로컬 연결값은
`config.local.json`, 비밀값은 `.env`, 운영 상태는 `state/`에만 둔다.

## 프론트엔드 지도

| 화면 | URL | 소스 | 방식 |
| --- | --- | --- | --- |
| 홈 | `/` | `public/index.html`, `public/app.js` | 정적 JavaScript |
| 이미지 아카이브 | `/images` | `public/images/` | 정적 JavaScript |
| 이미지 생성실 | `/images/create` | `public/images/create/` | 정적 JavaScript |
| 화풍 관리 | `/images/styles` | `public/images/styles/` | 정적 JavaScript |
| 오늘의 운세 | `/fortune` | `public/fortune/` | 정적 JavaScript |
| 뉴스 검수실 | `/news` | `frontend/news/main.jsx` | React, 빌드 결과는 `public/news/app.js` |
| 모바일 알림 | `/notifications` | `frontend/notifications/main.jsx` | React, 빌드 결과는 `public/notifications/app.js` |
| Discord 최초 설정 | `/setup/discord` | `public/setup/discord/` | 정적 JavaScript |

React는 전면 재작성하지 않고 새 상호작용 화면부터 단계적으로 적용한다.
`npm.cmd run news:build`와 `npm.cmd run notifications:build`가 추적되는 브라우저
번들을 갱신하며, `npm.cmd run check`가 두 빌드를 모두 포함한다.

## 백엔드 지도

진입점은 `src/server.mjs`, 로컬 설정의 로딩·검증은 `src/config.mjs`다.
HTTP 라우트는 검증과 응답만 맡고 실제 동작은 같은 기능 폴더의 서비스가 맡는다.

| 모듈 | 위치 | 책임 |
| --- | --- | --- |
| 데이터베이스 | `src/modules/database/` | SQLite 연결과 순차 스키마 마이그레이션 |
| 이미지 | `src/modules/images/` | 아카이브, 테마, 제작 기록, 화풍, 생성 초안과 1장 실행 |
| 운세 | `src/modules/fortune/` | 날짜별 운세와 안전한 게시 상태 읽기 |
| 뉴스 | `src/modules/news/` | Discord/X 수집, 번역·판정, 대기함, 승인과 알림 |
| 모바일 알림 | `src/modules/notifications/` | Web Push 구독과 제한된 알림 전송 |
| 시스템 | `src/modules/system/` | allowlist 기반 Codex 상태·긴급 재기동 |

라우트의 현재 기준 목록은 `src/server.mjs`의 `PAGE_ROUTES`와 각
`*-route.mjs` 파일이다. 새 API는 해당 기능 폴더에 라우트·서비스·테스트를 함께 둔다.

## 데이터와 상태 지도

| 저장 대상 | 위치 | 현재 역할 | Git |
| --- | --- | --- | --- |
| 뉴스 운영 대기함 | `state/news/` | 현재 수집·번역·검토의 원본 저장소 | 제외 |
| 뉴스 사건 원장 | `state/hanabit-hub.sqlite` | 스키마 v1 준비 완료, 운영 읽기·쓰기는 아직 미연결 | 제외 |
| Push 구독·키 | `state/notifications/` | 모바일 Web Push 상태 | 제외 |
| 이미지 생성 초안·작업 | `state/image-generation-*` | Hub가 만든 초안과 1장 작업 상태 | 제외 |
| 이미지·테마·제작 기록 | 외부 설정 루트 | 기존 저장소를 이동 없이 연결 | 외부 |
| 운세 결과·게시 상태 | 외부 설정 루트 | 읽기 전용 연결 | 외부 |

SQLite 스키마는 `src/modules/database/hub-database.mjs`, 뉴스 원장 연산은
`src/modules/news/news-ledger.mjs`, 상세 설명은 `docs/database.md`에 있다.
현재 테이블은 뉴스 사건, 출처, 분석, 승인, 게시 영수증이며 기존 JSON을 아직
대체하지 않는다.

## 뉴스 자동화 흐름

```text
Discord Announcement ─┐
                      ├─> Discord watcher ─> JSON 대기함 ─> 무료 API 번역·판정
X Filtered Stream ─> #x-watch ┘                         │
                                                         ├─> #news-pending
                                                         ├─> 모바일 Push
                                                         └─> /news 사람 승인
                                                                  │
                                                        실제 DC 게시기는 아직 미연결
```

실행 진입점은 `scripts/watch-discord-announcements.mjs`다. 실시간 이벤트와
10분 보충 확인이 같은 중복 방지 저장소를 사용한다. X 인물 명부는
`config/news-x-sources.json`이고 비밀 토큰은 코드나 지도에 기록하지 않는다.

## 이미지와 운세 연결 경계

- 이미지 파일, Python 파이프라인, 생성 자산과 기존 8787은 이동하지 않는다.
- Hub는 `config.local.json`으로 주입된 루트와 고정 실행 파일만 사용한다.
- 이미지 운영일은 서울 시간 오전 02시에 바뀐다.
- 운세 계산·템플릿·예약 게시 코드는 이 저장소의 책임이 아니다.
- 실제 게시, 예약 작업, Tunnel·DNS 변경은 사용자 승인 전 실행하지 않는다.

## 어디를 먼저 고칠까

| 원하는 변경 | 첫 진입점 |
| --- | --- |
| 페이지·정적 파일 라우팅 | `src/server.mjs`, `public/` |
| React 뉴스 UI | `frontend/news/main.jsx` |
| React 알림 UI | `frontend/notifications/main.jsx` |
| 이미지 기능 | `src/modules/images/` |
| 뉴스 수집·판정 | `src/modules/news/`, `scripts/watch-discord-announcements.mjs` |
| DB 스키마·원장 | `src/modules/database/`, `src/modules/news/news-ledger.mjs` |
| 외부 경로 설정 | `config.example.json`, 로컬의 `config.local.json` |
| 운영·복구 | `docs/live-runtime.md` |
| 전체 기술 결정 | `ARCHITECTURE.md` |

## 지도 최신화 규칙

다음 중 하나가 바뀌는 커밋은 이 문서를 같은 커밋에서 갱신한다.

- 화면 URL, React 진입점 또는 빌드 결과 위치
- `src/modules/` 아래 기능 경계
- DB 테이블, 상태 저장 위치 또는 운영 원본
- 포트, checkout 역할, 자동화 실행 진입점
- 외부 파이프라인과 Hub 사이의 소유권 경계

`test/project-map.test.mjs`는 백엔드 모듈과 React 진입점이 지도에서 빠지면
`npm.cmd run check`를 실패시킨다. 마지막 구조 대조일은 **2026-08-01**이다.
