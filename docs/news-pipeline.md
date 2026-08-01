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
`skip / review / publish` 판정을 JSON으로 반환한다. 일시 실패와 잘못된 JSON은 호출
안에서 한 번만 다시 시도하며, 두 번 모두 실패하면 원문을 보존한 채
`translation_failed`로 닫고 이후 자동 재시도하지 않는다. OpenAI 공식
Announcement는 모델 판정과 무관하게 최소 `publish` 게시 검토 후보로 올린다.

`review`와 `publish` 항목은 하나빛 허브 `/news`와 Discord `#news-pending`에 글과
보존 이미지를 한 번만 표시한다. `skip`은 허브에 보류 상태로 남긴다. 실제 DC 게시는
아직 연결하지 않으며 별도 승인·게시 영수증·중복 방지가 완성될 때까지 자동 전송하지 않는다.

X 계정 allowlist는 `config/news-x-sources.json`에서 관리한다. 현재 Tibo, OpenAI,
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
