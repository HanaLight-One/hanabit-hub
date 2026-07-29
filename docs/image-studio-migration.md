# Image Studio 코드 이전 기록

## 이전 원칙

Image Studio의 코드는 Hanabit Hub 저장소에서 관리하되 운영 데이터와 기존
파이프라인의 파일 위치는 이동하지 않는다. 새 코드는 `config.local.json`에
주입된 경로를 통해 기존 자원을 연결한다.

## 외부 설정 대상

기존 코드에서 다음 항목을 하드코딩하지 않는다.

- 날짜별 이미지 저장소
- 파일럿 이미지 저장소
- 화풍 설정 저장소
- Image Studio 상태 저장소
- 오늘의 테마 원본 파일과 채널 식별자
- 이미지 생성 작업공간과 워크플로 문서
- Codex 실행 파일
- 운세 결과와 안전한 게시 상태 저장소

실제 값은 `config.local.json`에만 두며 예시 파일에는 빈 문자열만 유지한다.

### 조사된 런타임 의존성

2026-07-29 기준 기존 코드에서 다음 운영 의존성을 확인했다. 실제 컴퓨터 경로는
이 문서에 기록하지 않고 `config.local.json`에서만 관리한다.

| 구분 | 설정 키 | 기존 사용처 |
| --- | --- | --- |
| 날짜별 이미지 | `dailyImagesRoot` | 이미지 목록·원본·다운로드·삭제·복원 |
| 파일럿 이미지 | `pilotImagesRoot` | 이미지 목록·원본·다운로드·삭제·복원 |
| 화풍 설정 | `stylesRoot` | 화풍 카드와 추가생성 컨텍스트 |
| 운영 상태 | `stateRoot` | queue, trash, thumbnails, logs, worker lock |
| 이미지 제작 기록 | `productionRecordsRoot` | 이미지별 제작 기록 API |
| 오늘의 테마 | `topicPath` | Hero 테마와 수집 성공 시각 |
| 운세 결과 | `fortuneOutputRoot` | 운세 TXT·JSON 다운로드 |
| 게시 상태 | `fortunePublisherStateRoot` | 안전한 게시 receipt와 실행 상태 |
| 파이프라인 | `generation.pipelineRoot` | 자산 색인과 Responses bridge |
| 자산 색인 | `generation.assetIndexPath` | 화풍·관계·인물·이미지 앵커 |
| 추가생성 출력 | `generation.outputRoot` | 날짜별 `extra-requests` |
| Python | `generation.pythonExecutablePath` | Responses 작업 프로세스 |
| Responses worker | `generation.responsesWorkerPath` | 무료 API 장면 구성과 이미지 생성 |
| 무료 텍스트 runner | `generation.freeTextRunnerPath` | 장면 JSON 생성 |
| Responses bridge | `generation.codexResponsesBridgePath` | ChatGPT Codex 이미지 도구 연결 |

현재 추가생성은 더 이상 `codex exec`에 의존하지 않는다. 기존 설정의
`workflowPath`와 `codexExecutablePath`는 이전 버전 호환과 조사 기록을 위해
예시에는 남기되 새 worker의 필수 경로로 취급하지 않는다.

### 코드만 복사할 때 깨지는 기능

- `stateRoot`가 바뀌면 기존 큐 이력, 휴지통, 복원 원위치 정보, 썸네일 캐시,
  활동 로그와 worker lock이 새 빈 상태로 갈라진다.
- `dailyImagesRoot` 또는 `pilotImagesRoot`가 비어 있으면 목록, 원본 보기,
  슬라이드, 개별·일괄 다운로드가 동작하지 않는다.
- `stylesRoot` 또는 자산 색인이 없으면 화풍 목록과 화풍·예배당 추가생성이
  동작하지 않는다.
- Python, Responses worker, 무료 텍스트 runner 또는 Responses bridge가 없으면
  큐 JSON은 만들어져도 생성 프로세스를 시작할 수 없다.
- 테마·운세·게시 상태 경로가 없으면 해당 탭은 비어 있거나 준비되지 않은 상태로
  표시된다.
- `sharp`가 설치되지 않으면 썸네일 생성이 실패한다.
- 기존 시작프로그램 CMD와 Windows 예약 작업은 이전 코드 경로를 직접
  가리키므로 코드 복사만으로 실행 주체가 바뀌지 않는다.

### 상태 보존 방식

전환 전까지 기존 `stateRoot`를 그대로 외부 설정으로 참조한다. queue, trash,
thumbnails, logs 및 worker lock을 저장소 안으로 복사하거나 Git에 추가하지
않는다. 새 코드의 쓰기 기능을 병행 검증할 때는 운영 `stateRoot`가 아니라 별도
임시 상태 루트를 사용한다. 최종 전환 시에도 같은 상태 루트를 연결해야 기존
휴지통과 큐 이력이 유지된다.

### 서버와 Tunnel 영향

기존 운영 서버와 Cloudflare Tunnel 원점은 8787을 계속 사용한다. 이 저장소의
기본 개발 서버는 8790이며, 코드와 설정 모듈을 추가하는 것만으로 8787 또는
Tunnel에는 변화가 없다. 시작프로그램, 예약 작업 또는 Tunnel 원점 변경은 병행
검증 이후 사용자 승인과 복구 절차를 마련한 별도 작업으로 수행한다.

### 이번 이전에서 분리한 코드

- 외부 경로 검증: `src/modules/images/image-studio-config.mjs`
- 상태 디렉터리 파생과 준비 상태 검사:
  `src/modules/images/image-studio-runtime.mjs`
- 추가생성의 결정적 화풍·인물 선택과 compact context 작성:
  `src/modules/images/image-studio-queue-context.mjs`
- 날짜별 이미지 목록과 안전한 이미지 ID:
  `src/modules/images/image-archive.mjs`

이 단계에서는 기존 서버·화면·Python·PowerShell·CMD를 실행 경로에서 교체하지
않는다. 위 모듈을 임시 경로 테스트로 검증한 뒤 API와 화면을 순차적으로 옮긴다.

### 이전된 읽기 전용 API

```text
GET /api/images
GET /api/images/:imageId/content
GET /api/images/:imageId/thumbnail
GET /api/images/:imageId/download
```

이미지 목록은 날짜, 앨범, 그룹, 파일명, 크기, 수정시각과 불투명 이미지 ID를
반환한다. 절대경로와 상대경로는 반환하지 않는다. 원본·썸네일·다운로드·제작 기록은
같은 이미지 ID를 사용하는 후속 API 주소로 연결한다. 원본 API는 이 ID를 허용된
이미지 저장소 안에서만 해석하고 파일 시스템 경로를 응답에 포함하지 않는다.
다운로드 API는 같은 경계를 사용하며 안전한 첨부 파일명과 `no-store` 캐시 정책을
적용한다. 썸네일 API는 원본을 변경하지 않고 `stateRoot/thumbnails/hub-v1`
아래에 최대 480px WebP 캐시를 생성하며 수정시각 버전이 포함된 URL을 사용한다.

### 이전된 읽기 전용 화면

```text
/images
```

첫 화면은 날짜 필터, 썸네일 카드, 원본 보기, 개별 다운로드와 제작 기록 패널을
제공한다. 데스크톱에서는 우측 패널, 모바일에서는 하단 시트로 표시한다. 삭제,
복원, 추가생성과 기타 쓰기 기능은 운영 검증 전까지 노출하지 않는다.

## 단계

1. 운영일과 테마 기록처럼 독립적인 기능을 허브 모듈로 먼저 구현한다.
2. 이미지 제작 기록의 검증과 로컬 보관 형식을 마련한다.
3. 기존 Image Studio의 API 동작을 회귀 테스트로 기록한다.
4. 파일 접근 코드를 설정 기반 어댑터로 옮긴다.
5. 기존 화면을 `/images` 아래에서 새 API와 연결한다.
6. 8790에서 읽기 전용 기능부터 병행 검증한다.
7. 생성, 휴지통, 복원 기능을 차례로 검증한다.
8. 사용자 승인 후에만 8787 시작 경로를 새 저장소로 전환한다.

## 날짜별 테마

이미지와 테마의 날짜는 서울 시간 기준 운영일로 묶는다. 운영일은 오전 02시에
바뀌므로 00:00부터 01:59:59까지 관측한 테마는 전날 기록에 속한다.

테마 기록은 허브의 로컬 상태 저장소에 날짜별 JSON으로 보관한다. API와 화면에는
날짜, 테마, 최초 확인 시각과 마지막 확인 시각만 제공하며 저장 경로는 노출하지 않는다.
