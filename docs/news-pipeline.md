# HANABIT NEWS LAB 파이프라인

## 최종 흐름

1. Discord Announcement와 향후 X 수집기가 원문을 가져온다.
2. 결정적 코드가 출처 ID, 중복, 상태 전이, 이미지 파일을 관리한다.
3. 교체 가능한 무료 AI 공급자가 영문 번역과 중요도 판정을 수행한다.
4. 검토 가능한 항목은 `news-pending`과 하나빛 허브에 표시한다.
5. 승인된 항목만 DC 게시자가 글과 이미지를 게시하고 영수증을 남긴다.

## 현재 단계

Discord Gateway 감시기가 `#openai-announcements`와 `#x-watch`를 함께 감시한다.
OpenAI 공지의 글, Embed, 링크와 Discord CDN 이미지를 보존하고, `#x-watch`에서는
등록된 X 계정의 `/status/<ID>` 링크만 공식 X oEmbed를 통해 원문으로 보충한다.
X 본문이 다른 X 게시물을 인용·링크하거나 운영자가 같은 Discord 메시지에 보조 X 링크를
함께 넣으면 최대 3개를 공식 oEmbed로 추가 조회해 번역·판정용 문맥으로만 전달한다.
보조 문맥은 기본 원문 번역에 합치지 않으며, 조회 실패도 기본 게시물 수집을 막지 않는다.
같은 Discord 메시지와 같은 X 게시물은 다시 관측해도 중복 생성하지 않는다.

```powershell
# 쓰지 않고 대상 개수만 확인
npm.cmd run news:discord:collect:dry

# 신규 항목을 로컬 대기함에 저장
npm.cmd run news:discord:collect
```

수집 직후 기존 설정의 무료 텍스트 API runner가 한글 번역과
`skip / review / publish` 판정, 중요도, 산정 근거와 편집 조언을 JSON으로 반환한다.
이미지는 사람 검수용으로만 보존하며 현재 무료 분석에는 이미지 픽셀을 전달하지 않는다.
모델은 이미지를 봤다고 가정하지 않고 부모·인용 글의 텍스트 문맥만 사용한다.
따라서 이미지가 보존된 `skip` 항목은 허브의 기본 확인 목록과 `이미지 확인` 필터에
남겨, 텍스트 판정만으로 중요한 밈·스크린샷 문맥을 놓치지 않게 한다.

무료 판정이 `review`, 신뢰도 72% 미만, 부모 문맥이 있는 48자 이하 답글 또는
이미지가 있는 `skip`이면 선택적으로 Codex 심층검토로 승격한다. Codex는 무료 단계가
모은 원문·부모 문맥·번역·판정만 받고 이미지 픽셀은 받지 않는다. 실행은
`--ephemeral`, `--sandbox read-only`, JSON Schema 출력으로 고정하며 하루 최대 4건만
허용한다. 검토 결과가 `publish`여도 실제 게시하지 않고 사람 승인 가능한
`pending_review`까지만 전환한다. 날짜별 영수증은 같은 항목의 토큰 중복 사용을 막는다.

Codex 검토는 컴퓨터별 `config.local.json`에서만 활성화한다.
`executablePath`에는 npm 전역 설치의
`node_modules/@openai/codex/bin/codex.js` 절대경로를 넣는다. PowerShell 래퍼는
Windows 인수 해석 차이를 피하기 위해 사용하지 않는다.

```json
{
  "integrations": {
    "news": {
      "codexReview": {
        "enabled": false,
        "executablePath": "",
        "dailyLimit": 4
      }
    }
  }
}
```

무료 분석은 최초 호출 뒤 최대 두 번 더 시도한다. 세 번 모두 실패한 경우에만
`translation_failed`로 닫고, 이후에는 사람의 명시적 다시 분석 요청을 기다린다.
원문은 그대로 보존하고 로그에는 안전한 실패 종류만 기록한다. 실패 카드의 수동
재분석도 같은 3회 정책을 새로 적용한다. OpenAI 공식
Announcement는 모델 판정과 무관하게 최소 `publish` 게시 검토 후보로 올린다.

판정은 게시 가치와 정보 확실성을 별도 축으로 저장한다. `decision`은
`publish | review | skip`, `evidenceTag`는 다음 다섯 값만 허용한다.

- `official`: 회사 공식 계정이나 공식 Announcement의 직접 발표
- `confirmed`: 구체적 사실 또는 제공 여부가 직접 확인된 정보
- `inference`: 신뢰할 수 있는 당사자의 말과 문맥으로 합리적으로 유추한 초기 신호
- `rumor`: 확인되지 않은 제삼자 주장이나 유출
- `opinion`: 평가·전망·일상 의견이 중심인 글

`inference`는 `review`와 동의어가 아니다. 핵심 인물이 구체적인 기능을 직접 사용했다고
말한 경우처럼 독자가 미리 알 가치가 있으면, 공개 범위를 단정하지 않는 표현과
`[유추]` 태그를 전제로 `publish` 후보가 될 수 있다. 향후 자동 게시기는 이 태그와
출처 등급을 로컬 정책으로 다시 검사해야 하며 모델 결과만으로 게시하지 않는다.

허브의 자동 게시 게이트는 현재 판정 전용이다. `official`, 또는 확인된 핵심 출처의
고신뢰 `confirmed`와 `inference`만 `eligible`로 표시한다. `rumor`, `opinion`, 낮은
중요도·신뢰도, 기존 승인·게시 항목은 사람 확인 또는 차단으로 남긴다. 게이트는 실제
게시자나 승인 API를 호출하지 않는다.

승인·게시 전 기존 카드는 `POST /api/news/:id/reanalysis`의 같은 출처 확인 요청으로
새 정책을 다시 적용할 수 있다. 분석 세대를 올리고 이전 번역·판정을 교체하며, Codex
영수증도 세대별로 분리해 옛 결과를 재사용하지 않는다. 이 동작은 무료 API와 필요한
경우 Codex 일일 상한을 실제로 사용하므로 화면에서 명시적으로 확인한다.
현재 정책 버전의 태그가 저장되면 버튼과 API를 다시 잠가 반복 토큰 사용을 막는다.

`review`와 `publish` 항목은 하나빛 허브 `/news`와 Discord `#news-pending`에 글과
보존 이미지를 한 번만 표시한다. React 뉴스 검수실에서는 원문·번역·판정·이미지를 확인한 뒤
두 단계 버튼으로 DC 게시 승인을 남길 수 있다. 승인은 `approved_for_dc` 상태와 시각만
원자적으로 기록하며 게시 코드를 실행하지 않는다. `skip`은 허브에 보류 상태로 남긴다.
실제 DC 게시는 아직 연결하지 않으며 별도 게시 영수증과 중복 방지가 완성될 때까지
자동 전송하지 않는다.

X 계정 명부는 `config/news-x-sources.json`에서 관리한다. 각 출처는 계정명뿐 아니라
출처 종류, 소속과 소속 상태, 역할, 담당 분야, 신뢰등급, 마지막 확인일, 자동 감시 여부를
가진다. `enabled`이면서 소속 종료 상태가 아닌 계정만 스트림 allowlist에 포함한다.
현재 Tibo, OpenAI,
OpenAI Developers, Sam Altman, Romain Huet, Greg Brockman 계정만 허용한다. 임의 호스트,
임의 계정과 상태 게시물이 아닌 X URL은 수집하지 않는다.

공식 oEmbed는 답글의 부모 게시물 ID를 제공하지 않는다. 따라서 부모 글이 필요한 답글은
현재 `#x-watch` 메시지에 부모 X 링크를 함께 붙이면 보조 문맥으로 읽는다. 향후 공식 X API
자격을 추가할 때 수집 경계는 유지한 채 부모·인용 관계 자동 조회를 교체할 수 있다.

## 실시간 감시

`news:discord:watch`는 Discord Gateway의 새 메시지 이벤트를 즉시 수집한다.
시작·재접속 시 각 채널의 최근 10건을 보충 확인하고, 장시간 연결의 안전망으로 10분마다
같은 보충 확인을 반복한다. 모든 경로는 동일한 Discord 메시지 ID 중복 방지를
사용한다.

승인된 Windows 운영 환경에서는 `Hanabit News Discord Watcher` 로그인 예약
작업이 현재 사용자 로그인 25초 후 감시기를 실행하며 실패 시 1분 간격으로 최대
10회 재시작한다.

## X 자동 감지 준비

공식 X Filtered Stream 어댑터는 allowlist 계정의 새 게시물을 감지해 해당 링크와
답글·인용 원문 링크를 같은 `#x-watch` 메시지에 전달한다. 이후 단계는 기존 Discord
수집·무료 API 번역·판정 경계를 그대로 사용한다. 리포스트는 규칙에서 제외하며 실제
DC 게시 잠금은 변경하지 않는다.

X API는 사용량 기반 유료 서비스이므로 기본값은 반드시 비활성이다.

```dotenv
X_STREAM_ENABLED=false
X_BEARER_TOKEN=
```

설정된 출처로 만들 규칙은 외부 변경 없이 먼저 확인할 수 있다.

```powershell
npm.cmd run news:x:rules:preview
```

Bearer Token과 X API 크레딧을 준비하고 사용자가 과금형 감시 활성화를 승인한 뒤에만
아래 명령으로 `hanabit-news-v1` 태그의 규칙을 등록·교체한다. 다른 태그의 규칙은
삭제하지 않는다.

```powershell
npm.cmd run news:x:rules:sync
```

마지막으로 `X_STREAM_ENABLED=true`로 바꾸고 Discord 감시기를 다시 시작한다. 토큰이
없거나 활성화 값이 false이면 X API 요청을 전혀 보내지 않는다. 인증 실패는 비밀값을
출력하지 않고 연결을 닫으며, 일시적인 연결 실패만 제한된 지수 백오프로 재접속한다.

스트림 연결이 실제로 확인되면 `#news-log`에 감시 계정 수와 연결 상태를 알린다.
재연결, 크레딧·사용 한도 제한, 인증 중단도 상태가 바뀔 때 한 번만 고정 문구로
알리며 X API의 원문 오류나 인증값은 Discord에 보내지 않는다.
