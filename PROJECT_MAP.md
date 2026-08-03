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
| 오테 썸네일 관리 | `/images/theme-thumbnails` | `public/images/theme-thumbnails/` | 정적 JavaScript + 외부 배치 상태 JSON |
| 이미지 휴지통 | `/images/trash` | `public/images/trash/` | 정적 JavaScript |
| 오늘의 운세 | `/fortune` | `public/fortune/` | 정적 JavaScript |
| 뉴스 검수실 | `/news` | `frontend/news/main.jsx` | React, 빌드 결과는 `public/news/app.js` |
| 모바일 알림 | `/notifications` | `frontend/notifications/main.jsx` | React, 빌드 결과는 `public/notifications/app.js` |
| DC 편집실 | `/dc` | `frontend/dc/main.jsx` | React, 빌드 결과는 `public/dc/app.js` |
| Discord 최초 설정 | `/setup/discord` | `public/setup/discord/` | 정적 JavaScript |

React는 전면 재작성하지 않고 새 상호작용 화면부터 단계적으로 적용한다.
`npm.cmd run news:build`, `npm.cmd run notifications:build`, `npm.cmd run dc:build`가 추적되는 브라우저
번들을 갱신하며, `npm.cmd run check`가 두 빌드를 모두 포함한다.

## 백엔드 지도

진입점은 `src/server.mjs`, 로컬 설정의 로딩·검증은 `src/config.mjs`다.
HTTP 라우트는 검증과 응답만 맡고 실제 동작은 같은 기능 폴더의 서비스가 맡는다.

| 모듈 | 위치 | 책임 |
| --- | --- | --- |
| 데이터베이스 | `src/modules/database/` | SQLite 연결과 순차 스키마 마이그레이션 |
| 이미지 | `src/modules/images/` | 아카이브, 테마, 제작 기록, 화풍, 생성 초안과 1장 실행 |
| 운세 | `src/modules/fortune/` | 날짜별 운세와 안전한 게시 상태 읽기 |
| 뉴스 | `src/modules/news/` | Discord/X 수집, 번역·판정, Codex 심층검토, DC 원고 미리보기·수동 단건 게시와 영수증 |
| DC 편집실 | `src/modules/dc/` | 전용 업로드, SQLite 블록 초안, 텍스트·이미지 혼합 순서, 일반 글 미리보기·단건 게시 영수증 |
| 모바일 알림 | `src/modules/notifications/` | Web Push 구독과 제한된 알림 전송 |
| 시스템 | `src/modules/system/` | allowlist 기반 Codex 상태·긴급 재기동 |

라우트의 현재 기준 목록은 `src/server.mjs`의 `PAGE_ROUTES`와 각
`*-route.mjs` 파일이다. 새 API는 해당 기능 폴더에 라우트·서비스·테스트를 함께 둔다.

## 데이터와 상태 지도

| 저장 대상 | 위치 | 현재 역할 | Git |
| --- | --- | --- | --- |
| 뉴스 운영 대기함 | `state/news/` | 현재 수집·번역·검토의 원본 저장소 | 제외 |
| Hub SQLite | `state/hanabit-hub.sqlite` | 뉴스 원장, 이미지 제작 기록과 직접 업로드 출처, DC 혼합 블록 초안(v6) | 제외 |
| Push 구독·키 | `state/notifications/` | 모바일 Web Push 상태 | 제외 |
| 이미지 생성 초안·작업 | `state/image-generation-*` | Hub가 만든 초안과 1장 작업 상태 | 제외 |
| 직접 업로드 생성 소스 | `state/image-source-uploads/YYYY-MM-DD/` | 사용자가 올린 PNG·JPG·WebP를 오테와 분리해 Responses 주 참조로 보관 | 제외 |
| 이미지·테마·제작 기록 | 외부 설정 루트 | 기존 저장소를 이동 없이 연결 | 외부 |
| 이미지 휴지통 | 외부 `stateRoot/trash/hub-v1/` | 추가 생성 파일의 복원 영수증과 격리 파일 | 외부 |
| 오테 게시 썸네일 | 외부 `daily-image-pipeline-v2/assets/daily-theme-thumbnails/` | 숫자 이름 PNG 공용 자산, 최근 회피 가중 선택, 날짜별 강제 선택 | 외부 |

세부 선택 규칙과 상태 파일 계약은 `docs/daily-theme-thumbnails.md`에 기록한다.
| DC 편집실 | `state/dc-compose/` | 업로드 이미지와 게시 직전 격리 사본·영수증 | 제외 |
| 운세 결과·게시 상태 | 외부 설정 루트 | 읽기 전용 연결 | 외부 |

SQLite 스키마는 `src/modules/database/hub-database.mjs`, 뉴스 원장 연산은
`src/modules/news/news-ledger.mjs`, 이미지 색인은
`src/modules/images/image-metadata-catalog.mjs`에 있다. 뉴스 테이블은 기존 JSON을
아직 대체하지 않으며, 이미지 테이블은 폴더를 이동하지 않고 안전한 상대 저장 키와
Hub 생성 메타데이터를 웹 제작 기록에 연결한다.

## 뉴스 자동화 흐름

```text
Discord Announcement ─┐
                      ├─> Discord watcher ─> JSON 대기함 ─> 무료 API 원문 번역·판정
X Filtered Stream ─> #x-watch ┘                         │
무료 공식 소스 ────────────────────────> 같은 번역·판정·게시 관문
외신 RSS ─> 제목·설명·링크만 수집 ────> shadow_radar ─> /news 외신 레이더만
                         원문 번역 + 관련 글별 번역을 분리 + 게시가치·정보 성격 태그
                                      애매한 X만 ─> Codex 번역 귀속 감사·심층검토(일 4건)
                                                         │
                                                         ├─> #news-pending
                                                         ├─> 모바일 Push
                                                         └─> /news 필터·사람 검토·실패 재분석
                                                                  │
                                      자동 품질 관문 ready ─> DC 자동 단건 게시·영수증·Push
                                                                  │
                                                DC 원고 미리보기 ─> 사람 확인 ─> 수동 단건 게시
```

X 수집 단계에서는 유료 영상 메타데이터를 요청하지 않는다. 번역·자동 게시 게이트·편집장
대기 또는 사람 승인을 모두 통과해 실제 DC 게시가 확정된 항목만 공식 API에서 영상 정보를
한 번 조회하고, 영상 없음·실패도 영수증으로 남겨 같은 항목에 재청구하지 않는다. 주 게시물에
영상이 없으면 연결된 관련 글을 순서대로 확인해 첫 영상 메타데이터를 사용한다. 이어서
`src/modules/news/x-video-preview.mjs`가 허용된 `video.twimg.com` MP4 한 개를 격리 작업
폴더에 내려받아 프로젝트 고정 ffmpeg로 최대 60초 GIF를 만든다. 640px·12fps부터 시작해
첨부 상한을 넘거나 변환이 무거우면 480px·10fps, 360px·8fps로 안전하게 낮춘다. 변환 성공
시 X 미리보기 이미지 한 장만 GIF로 교체하고, 실패하면 기존 스크린샷으로 복귀해 뉴스 처리를
막지 않는다. `posted` 영수증의 게시 번호와 URL이 확인된 경우에만 임시 MP4와 GIF를 즉시
삭제한다. X 원문 링크는 게시 직전 DC OGP API 응답을 검증해 모바일 게시용 카드 저장 표식으로 만들며,
OGP 조회 실패 시 일반 링크를 유지해 게시 자체는 막지 않는다.

실행 진입점은 `scripts/watch-discord-announcements.mjs`다. 실시간 이벤트와
10분 보충 확인이 같은 중복 방지 저장소를 사용한다. X 인물 명부는
`config/news-x-sources.json`이고 비밀 토큰은 코드나 지도에 기록하지 않는다.
뉴스 재분석은 `POST /api/news/:id/analysis-retry`에서 명시적 확인값을 받은
`translation_failed` 항목에만 허용하며 이미지 분석 API는 호출하지 않는다.
무료 API 뉴스 분석은 공용 Responses API 텍스트 실행기에 요청별 strict JSON Schema를
전달해 원문 번역·관련 글 번역·판정 필드의 구조를 고정한다. 스키마 파일은 실행별 임시
상태에만 만들고 종료 시 제거하며, 스키마를 생략하는 다른 공용 실행기 호출은 종전과 같다.
판정 완료 항목의 새 정책 재판정은 `POST /api/news/:id/reanalysis`, 결정론적 자동 게시
가능성 표시는 `src/modules/news/news-auto-publish-policy.mjs`가 담당한다. 게이트는
원문 전용 번역의 귀속 검증과 AI 해설 주의 문구가 없으면 자동 게시 가능으로 판정하지
않으며, 자동 게시 시작 영수증 이후의 새 항목만 실제 게시자에게 전달한다. 사람의 미리보기
확인 뒤 수동 단건 게시도 `src/modules/news/news-dc-publication.mjs`가 같은 안전 경계로 허용한다.
해설 주의 문구의 단일 원본은
`src/modules/news/news-analysis-notice.mjs`다.
`src/modules/news/news-editorial-governor.mjs`는 최근 뉴스의 직접 링크와 번역 핵심어로
사건을 묶고 대표 원고·15분 연속 게시 대기를 계산하는 편집장이다. 결과는
`news-reader.mjs`가 API에 노출하고, 감시기는 `ready`인 새 원고만 자동 게시 서비스에 전달한다.
같은 사건 병합은 모든 태그에 먼저 적용하되, 서로 다른 `[공식]`과 중요도 높은 `[확정]`은
속보성을 위해 15분 연속 게시 제한을 면제한다. `[사례]`는 확인된 출처·높은 중요도·신뢰도
85% 이상만 자동 후보로 삼고 게시 사이에 6시간을 둔다. 같은 시각에는 정보성 `[유추]`가
`[사례]`보다 우선하며, 일반 활용 사례는 허브에만 보관한다.
`src/modules/news/news-translation-audit.mjs`는 무료 API가 만든 원문 번역과 관련 글 번역의
경계·링크·영문명·수치를 로컬에서 재검사한다. 새 뉴스는 `news-processor.mjs`가 감사 영수증을
저장하고 기존 뉴스는 `news-reader.mjs`가 읽기 전용으로 같은 검사를 적용한다.
DC 원고는 `src/modules/news/news-dc-copy.mjs`가 태그·출처·번역·AI 해설·원문 링크를
결정적으로 조립한다. 그림 이모지와 결합문자를 게시 전에 제거 또는 차단하고, 알려진
`/sk` 위험 경로 링크는 원고에서 제외한다. 실제 게시 진입점은
`scripts/publish-news-to-dc.cjs`이며 `chatgpt` 갤러리의 `뉴스/소식`, `💡 정보`, `잡담`,
`AI창작` 말머리만 허용한다. 모델은 후보를 제안하고 `news-dc-head-text.mjs`의 결정적
라우터가 공식 출처·신뢰 인물 규칙을 적용해 최종 말머리를 선택한다.
원문 이미지가 없는 게시물에는 `assets/news/dc-covers/`의 해당 말머리 PNG 한 장만
게시 단계에서 추가하며, 원문 미디어 기록은 변경하지 않는다. 커버 조회와 미리보기는
`news-dc-covers.mjs`, `news-dc-cover-route.mjs`가 고정 파일 allowlist로 제공한다.
최종 제출은 한 번만 수행하고 불명확한 결과는 자동 재시도하지 않는다.
Codex 검토 실행기와 날짜별 사용 영수증은
`src/modules/news/codex-news-review.mjs`, `state/news/codex-review/`에 있다.
뉴스 카드의 `누구예요?` 설명은 같은 X 인물 명부를 읽는
`src/modules/news/news-source-profiles.mjs`에서 만들며, 이후 게시 문구도 이 공개
프로필을 재사용할 수 있다.

Responses API 공용 텍스트 실행기의 복구 가능한 정본은 `tools/openai-free/`에 있다.
운영 경로는 `config.local.json`으로 계속 외부 주입하며, 정본 동기화는
`scripts/sync-openai-free-runner.ps1`의 고정 allowlist와 명시적 확인 문구를 거친다.
키·DPAPI 암호문·가상환경·실행 결과는 정본과 Git에 포함하지 않는다.
운영 호출은 각 checkout의 추적된 `tools/openai-free/invoke-free-text.ps1`을 사용하고,
외부 Python과 DPAPI 저장소만 `freeTextPythonExecutablePath`,
`freeTextKeyStorePath`로 주입한다. 같은 설정은 뉴스 직접 호출과 이미지 worker 자식
프로세스에 함께 전달된다.

## 이미지와 운세 연결 경계

- 이미지 파일, Python 파이프라인, 생성 자산과 기존 8787은 이동하지 않는다.
- Hub는 `config.local.json`으로 주입된 루트와 고정 실행 파일만 사용한다.
- 이미지 휴지통 쓰기는 `manage-image-trash` allowlist가 켜진 관리자 Hub에서만 허용한다. 오테 본편은 보호하고 추가 생성 이미지만 이동하며, 영구 삭제 시 파일·썸네일 캐시·SQLite 제작 기록을 함께 제거한다.
- 이미지 운영일은 서울 시간 오전 02시에 바뀐다.
- 오테 게시자는 외부 Python 선택기가 고른 날짜별 썸네일을 생성 이미지 앞에 한 장 붙이며, 같은 날짜에는 선택을 바꾸지 않는다.
- 운세 계산·템플릿·예약 게시 코드는 이 저장소의 책임이 아니다.
- 실제 게시, 예약 작업, Tunnel·DNS 변경은 사용자 승인 전 실행하지 않는다.

## DC 편집실 흐름

```text
허브 이미지 ID ─┐
                ├─> SQLite 텍스트·이미지 블록 순서 ─> 미리보기·금지문자 검사
전용 업로드 폴더 ┘                                  │
                                                    v
                          명시적 실제 게시 확인 ─> 격리 작업 폴더로 사본 생성
                                                    │
                                                    v
                                  고정 DC 게시자 ─> 게시 또는 모호함 영수증
```

`src/modules/dc/`는 원고·업로드·초안·게시 상태를 관리한다. 기존 이미지 원본과
업로드 원본은 게시 과정에서 이동하지 않으며, 이미지 블록 순서대로 `state/dc-compose/
publication-jobs/` 아래에 격리 사본을 만든 뒤 `scripts/publish-dc-compose.cjs`만
실행한다. 게시자는 `chatgpt` 갤러리, 허용된 말머리, 최대 10장, 이미지 해시,
그림 이모지·결합문자 부재와 워터마크 필드 제외를 다시 검증한다. 성공 영수증 또는
모호함 영수증이 생기면 같은 초안을 자동 재제출하지 않는다.

본문은 최대 25개의 텍스트·이미지 블록으로 구성한다. 게시 작업에는 이미지마다
고정 표식을 정확히 한 번만 넣고, 외부 DC 게시자의 재설치용 호환 패치가 업로드 후
받은 이미지 주소를 해당 표식 위치에 치환한다. 표식 누락·중복이면 게시 전에 실패한다.

작성 중인 제목·블록 내용·혼합 순서는 약 0.9초 뒤 SQLite 초안에 자동 저장한다. 따라서
새로고침하거나 다른 기기로 이동해도 마지막 미게시 초안을 복구하며, 원고를
`localStorage`나 `sessionStorage`에는 보관하지 않는다.

## 어디를 먼저 고칠까

| 원하는 변경 | 첫 진입점 |
| --- | --- |
| 페이지·정적 파일 라우팅 | `src/server.mjs`, `public/` |
| React 뉴스 UI | `frontend/news/main.jsx` |
| React 알림 UI | `frontend/notifications/main.jsx` |
| React DC 편집실 | `frontend/dc/main.jsx`, `src/modules/dc/` |
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
`npm.cmd run check`를 실패시킨다. 마지막 구조 대조일은 **2026-08-02**다.

## 2026-08-01 추가 연결

- 오테 완료 manifest -> 이미지 SQLite 제작 기록: `src/modules/images/image-metadata-catalog.mjs`
- 추가 생성 작업 카드 -> 안전한 프롬프트·선택 인물·최대 3개 저장 화풍 혼합·결과 이미지와 후속 생성 링크:
  `src/modules/images/prompt-only-executor.mjs`, `public/images/create/app.js`
- 추가 생성 자동 선택은 초안 ID로 결정적으로 인물 관계 그룹과 저장 화풍을 고르고,
  worker 시작 전에 실제 인물·화풍 ID를 작업 JSON과 이미지 제작 기록에 확정한다.
- 이미지 카드의 같은 조합·인물 유지·화풍 유지 링크는 옵션 목록을 먼저 만든 뒤 제작 기록의
  인물·화풍 ID를 폼에 복원한다. 사용자는 복원된 인물에 새 인물을 더하거나 뺀 다음,
  원본 이미지를 주 참조로 포함한 1장 작업을 실행할 수 있다.
- 직접 업로드 소스 -> `POST /api/images/source-uploads`가 최대 20MB PNG·JPG·WebP를
  Hub 상태 폴더에 저장하고, 새 장면 초안의 `sourceImageId`와 worker의
  `user_reference_image`로만 전달한다. 제작 기록이 없는 업로드는 이어 만들기가 아니라
  사용자가 고른 프롬프트·인물·화풍을 적용하는 새 장면 참조로 취급한다. 소스 선택창은
  파일 선택과 클립보드 이미지 붙여넣기를 같은 검증 API로 처리하고, 직접 업로드 카드만
  기존 이미지 휴지통으로 이동할 수 있다.
- 이미지 홈 카드 -> 인물·화풍 기반 표시명, 작은 원본 파일명, 제작 기록 요약과 편집·인물 유지·화풍 유지 바로가기:
  `public/images/app.js`
- Codex 공식 사용량 -> 홈 남은량 카드: `src/modules/system/codex-usage.mjs`
- API: `GET /api/system/codex/usage`
- 안전 경계와 상세 계약: `docs/codex-usage-and-daily-manifests.md`
- 전 화면 공용 Codex 잔량 표시: `public/codex-usage-indicator.js`,
  `public/codex-usage-indicator.css` (각 화면 상단 헤더 또는 홈 우측 상단에 장착)
- 무료 뉴스 분석기 무비용 준비 상태: `src/modules/system/free-text-runtime-status.mjs`
- API: `GET /api/system/free-text-runtime` (경로·키·원문 오류는 반환하지 않음)
- 홈 상태 표시: `public/index.html`, `public/app.js`
- Discord/X 감시 로그의 최근 갱신 상태: `src/modules/system/news-watcher-status.mjs`
- API: `GET /api/system/news-watcher` (로그 본문과 내부 경로는 반환하지 않음)
