# HANABIT NEWS LAB Discord 연결 테스트

현재 단계는 공지를 수집하지 않습니다. Bot 로그인 후 지정 Guild와 네 개 채널을
찾을 수 있는지만 확인하는 일회성 진단 도구입니다.

## 환경변수

저장소 루트의 Git 제외 파일 `.env`에서 아래 한 항목만 직접 입력합니다.

```dotenv
DISCORD_BOT_TOKEN=여기에_Bot_Token_입력
```

Guild, Application 및 Channel ID는 같은 `.env`에 준비되어 있습니다. 토큰을
코드, 이슈, 채팅 또는 로그에 붙여 넣지 마세요.

노트북 화면을 사용할 수 없다면 Owner Only 허브의 `/setup/discord`에서
모바일로 한 번만 저장할 수 있습니다. 이미 토큰이 설정되어 있으면 입력 기능은
자동으로 잠기며 저장된 값은 화면이나 API 응답으로 다시 제공하지 않습니다.

## 실행

연결과 채널 조회만 확인:

```powershell
npm.cmd run news:discord:check
```

연결 확인 후 `#news-log`에 테스트 메시지 한 건을 보내고 종료:

```powershell
npm.cmd run news:discord:test
```

두 명령 모두 계속 실행되는 봇이 아니며 확인을 마치면 연결을 닫습니다.
