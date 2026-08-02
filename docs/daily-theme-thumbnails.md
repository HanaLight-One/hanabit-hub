# 오늘의 테마 대표 썸네일

허브는 오테 배치 폴더를 옮기지 않고 `config.local.json`에 주입된 외부 경로만
사용한다. 운영 경로는 Git에 기록하지 않는다.

## 화면과 API

- 관리 화면: `/images/theme-thumbnails`
- 조회: `GET /api/images/theme-thumbnails`
- 이미지: `GET /api/images/theme-thumbnails/:filename/content`
- 업로드, 설정 변경, 날짜 고정, 삭제는 같은 출처 요청과
  `manage-theme-thumbnails` allowlist가 모두 필요하다.

업로드 파일은 실제 PNG인지 확인한 뒤 현재 가장 큰 숫자의 다음 이름으로
저장한다. 따라서 자산 수는 고정되어 있지 않다. 삭제할 때는 최소 2장을
보존하고, 오늘 사용 중이거나 미래 날짜에 고정된 이미지는 거부한다.

## 외부 배치 계약

외부 `daily_thumbnail.py`는 아래 상태를 읽는다.

- `daily-thumbnail-history.json`: 날짜별 실제 선택 기록
- `daily-thumbnail-catalog.json`: 표시 이름과 기본 가중치(0~10)
- `daily-thumbnail-forced.json`: 날짜별 강제 파일명

선택 우선순위는 `날짜별 강제 선택 → 같은 날짜 기존 기록 → 최근 3종을 피한
가중 랜덤`이다. 기본 가중치 0은 평소 랜덤에서 제외하지만 날짜별 강제 선택은
허용한다. 배치 게시 준비가 실행될 때만 해당 날짜 기록과
`00-theme-thumbnail.png`가 생성된다.

허브 관리 화면을 열거나 설정을 조회하는 것만으로는 오테 생성이나 DC 게시가
실행되지 않는다.
