# Hanabit Hub 안정 운영본

## 목적

개발 중인 코드가 `studio.hanabit.one`에 즉시 노출되지 않도록 개발 실행본과
안정 운영본을 분리한다.

| 역할 | 기본 위치 | 포트 |
| --- | --- | --- |
| 기존 Image Studio | 기존 운영 폴더 | 8787 |
| Hanabit Hub 개발 | `hanabit-hub` | 8790 |
| Hanabit Hub 안정 운영 | `hanabit-hub-live` | 8791 |

Cloudflare Tunnel의 `studio.hanabit.one` 원점은 별도 승인 후 8791로 전환한다.
8787은 안정화 기간 동안 로컬 복구 대상으로 유지한다.

## 안정 checkout

안정 운영본은 기본 개발 checkout과 분리된 detached Git worktree로 유지한다.
검증한 커밋만 checkout하며 개발 중인 추적 전 변경사항은 포함하지 않는다.

```powershell
git worktree add --detach `
  C:\Users\YSM\Documents\Hanabit\hanabit-hub-live `
  <검증한-커밋>
```

`config.local.json`과 `state`는 Git에 포함하지 않는다. 안정 운영본의 로컬
설정은 개발 설정과 같은 외부 이미지·파이프라인 경계를 사용하되 서버 포트만
8791로 둔다.

## 실행

의존성을 설치하고 숨김 실행 스크립트를 사용한다.

```powershell
npm.cmd ci
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-hidden.ps1
```

스크립트는 설정 포트가 비어 있는지 확인하고 Node 서버를 숨김 창으로 실행한다.
표준 출력, 오류와 PID는 Git에서 제외된 `state` 아래에 기록한다. Windows
자동 시작은 별도 승인 후 안정 운영 checkout에만 등록한다.

## 로그인 자동 시작

승인된 운영 환경에서는 현재 Windows 사용자가 로그인한 뒤 20초 후 8791을
숨김 실행한다. 이미 Hanabit Hub가 8791에서 실행 중이면 정상 성공으로 끝나며
중복 서버를 만들지 않는다. 다른 서비스가 8791을 사용 중이면 안전하게 실패한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\register-live-autostart.ps1
```

작업 이름은 `Hanabit Hub Live 8791`이며 현재 사용자 세션에서만 실행된다.
실패하면 1분 간격으로 최대 3회 재시도한다. 등록 스크립트는 설정 포트가 정확히
8791인 checkout만 허용한다.

자동 시작만 제거할 때는 서버나 운영 데이터를 삭제하지 않고 다음 스크립트를
사용한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\unregister-live-autostart.ps1
```

## 배포 흐름

1. 개발 checkout의 8790에서 변경사항을 검증한다.
2. `npm.cmd run check`를 통과한 기능을 커밋하고 푸시한다.
3. 안정 checkout을 해당 커밋으로 이동한다.
4. 안정 checkout에서 `npm.cmd ci`와 검증을 실행한다.
5. 8791 서버만 다시 시작하고 health, 이미지 목록, 테마와 생성실을 확인한다.
6. 검증이 끝난 뒤에만 외부 원점에서 사용한다.

안정 checkout 이동에는 강제 reset 대신 다음처럼 명시적인 detached checkout을
사용한다.

```powershell
git fetch origin main
git checkout --detach <검증한-커밋>
```

## 복구

코드 문제는 안정 checkout을 직전 검증 커밋으로 다시 checkout하고 8791만
재시작해 복구한다. Cloudflare 전환 후 외부 문제가 생기면 Tunnel 원점을
8791에서 기존 8787로 되돌린다. 어떤 경우에도 이미지 저장소, Python 파이프라인,
예약 작업 또는 기존 8787 파일을 이동하거나 삭제하지 않는다.
