# HANABIT NEWS LAB 파이프라인

## 최종 흐름

1. Discord Announcement와 향후 X 수집기가 원문을 가져온다.
2. 결정적 코드가 출처 ID, 중복, 상태 전이, 이미지 파일을 관리한다.
3. 교체 가능한 무료 AI 공급자가 영문 번역과 중요도 판정을 수행한다.
4. 검토 가능한 항목은 `news-pending`과 하나빛 허브에 표시한다.
5. 승인된 항목만 DC 게시자가 글과 이미지를 게시하고 영수증을 남긴다.

## 현재 단계

Discord 전용 일회성 수집 명령만 제공한다. 최신 메시지의 글, Embed, 링크와
Discord CDN 이미지를 `state/news/pending/<뉴스 ID>/`에 보존한다. 같은 Discord
메시지는 다시 실행해도 중복 생성하지 않는다.

```powershell
# 쓰지 않고 대상 개수만 확인
npm.cmd run news:discord:collect:dry

# 신규 항목을 로컬 대기함에 저장
npm.cmd run news:discord:collect
```

아직 무료 AI 번역·판정, X 수집, Hub 화면, Discord `news-pending` 전송,
DC 게시는 수행하지 않는다.
