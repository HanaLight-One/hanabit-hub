# 하나빛 허브 SQLite 원장

## 범위

SQLite는 뉴스 사건, 출처, 번역·판정, 승인과 최종 게시 영수증 같은 메타데이터만
관리한다. 이미지 원본, 운세 결과, 외부 파이프라인 파일과 Windows 예약 작업은
이동하지 않는다. 현재 JSON 뉴스 대기함도 그대로 보존하며 아직 운영 읽기·쓰기를
DB로 전환하지 않는다.

DB 파일은 Git에서 제외된 `state/hanabit-hub.sqlite`에 생성한다. Node.js 내장
`node:sqlite`를 사용하므로 별도 ORM이나 네이티브 Node 패키지는 필요하지 않다.

```powershell
npm.cmd run db:init
```

이 명령은 DB가 없으면 생성하고 적용하지 않은 마이그레이션만 순서대로 적용한다.
반복 실행해도 같은 스키마를 다시 만들지 않는다.

## 스키마 버전 1 — 뉴스 원장

- `schema_migrations`: 적용한 스키마 버전
- `news_stories`: 여러 출처가 묶이는 실제 뉴스 사건
- `news_sources`: Discord/X 원문과 플랫폼 고유 ID
- `news_analysis`: 사건별 한국어 번역과 판정
- `news_approvals`: 사람의 DC 게시 승인 영수증
- `news_publications`: 최종 DC 게시 결과와 본문 해시

DB 제약이 플랫폼별 외부 ID 중복, 승인 없는 게시, 사건별 이중 승인과 이중 게시를
차단한다. 애매하거나 실패한 게시를 자동 재시도하는 기능은 포함하지 않는다.

## 스키마 버전 2 — 이미지 제작 기록 색인

- `image_assets`: 공개 이미지 ID, 저장소 종류, 안전한 상대 저장 키와 파일명
- `image_generation_metadata`: 프롬프트, 인물·화풍 선택, 이미지 앵커 토글,
  생성 목적·방식·시간과 작업 ID

이미지 바이너리와 절대경로는 DB에 저장하지 않는다. 현재 Hub 1장 생성 작업의 완료
JSON을 이미지 폴더와 대조해 자동 색인하며, 아카이브 밖의 결과는 거부한다. 기존
이미지에 메타데이터가 없으면 내용을 추측하지 않는다. 자세한 계약은
`docs/production-records.md`를 참고한다.

## 스키마 버전 3 — 오테 manifest 연결

`image_generation_metadata.metadata_source`에 `daily-manifest`를 추가했다. 완료된 운영
manifest만 읽기 전용으로 색인하며 외부 이미지, Python 및 Windows 예약 작업은 수정하지
않는다. 상세 경계는 `docs/codex-usage-and-daily-manifests.md`를 참고한다.
