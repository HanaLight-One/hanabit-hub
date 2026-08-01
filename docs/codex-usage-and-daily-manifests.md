# Codex 사용량과 오테 제작 기록

## Codex 사용량

홈 화면은 로컬 Codex App Server의 공식 `account/rateLimits/read` 응답을 사용한다.
`GET /api/system/codex/usage`는 사용률, 남은률, 한도 구간, 초기화 시각만 반환한다.
인증 토큰, 세션 본문, 계정 파일은 읽거나 웹 응답에 포함하지 않는다. 조회에 실패하면
재로그인이나 재기동을 자동 실행하지 않고 확인 불가 상태만 표시한다.

구현 위치:

- `src/modules/system/codex-usage.mjs`
- `src/modules/system/codex-usage-route.mjs`
- `public/index.html`, `public/app.js`

## 오테 제작 기록

Hub는 `generation.workspaceRoot/outputs/daily-v2/YYYY-MM-DD/manifest.json`을 읽기 전용으로
색인한다. `complete`, `production_eligible=true`, `test_run=false`인 manifest에서 완료된
작업만 처리하고, 결과 이미지가 날짜 폴더와 설정된 이미지 아카이브 경계 안에 있을 때만
SQLite 제작 기록과 연결한다.

SQLite 스키마 v3은 `metadata_source=daily-manifest`를 추가한다. 이미지 원본은 계속 외부
폴더에 두고 DB에는 아카이브 상대 키, 프롬프트, 등장인물, 관계 그룹, 화풍/렌더링,
이미지 앵커 사용 여부, 생성 시각, 소요 시간과 재시도 횟수만 저장한다.

이 연결은 원본 manifest, 이미지, Python 코드, Windows 예약 작업을 변경하거나 실행하지
않는다. 불완전·시험·경로 이탈 manifest는 건너뛴다.

