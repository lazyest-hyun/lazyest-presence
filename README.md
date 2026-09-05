# lazyest-presence

Mac에서 Microsoft Teams 온라인 상태를 매일 **08:00–21:00**에 주기적으로 요청합니다.
Microsoft 365 CLI 로그인을 재사용하고, 로그인 정보가 없으면 본인 회사 계정의 브라우저 로그인을 진행합니다.

**별도 잠자기 방지 앱 없이, 이 저장소의 내장 덮개 모듈까지 함께 설치할 수 있습니다.**

## AI에게 설치 맡기기

Claude Code나 Codex에 다음을 전달하세요.

> https://github.com/lazyest-hyun/lazyest-presence 를 내 Mac에 설치하고 실행해줘. AGENTS.md와 README.md를 따라 `./bootstrap.sh install --with-lid`로 필요한 도구와 내장 덮개 모듈까지 설치해줘. 기존 Microsoft 로그인이 있으면 재사용하고, 없으면 내 회사 계정으로 브라우저 로그인하게 해줘. 매일 08:00–21:00과 배터리·발열 보호를 유지해줘. Microsoft 로그인과 macOS 승인은 내가 직접 할게. API 갱신과 실제 덮개 실행의 확인 결과를 구분해서 알려줘.

암호·MFA는 해당 로그인 창에서 직접 입력하고, 채팅에 전달하지 마세요.

## 직접 설치

```sh
git clone https://github.com/lazyest-hyun/lazyest-presence.git
cd lazyest-presence
./bootstrap.sh install --with-lid
./bootstrap.sh status
```

macOS 13.5 이상, Apple Silicon·Intel Mac이 대상입니다. 설치기는 전용 Node.js와 Microsoft 365 CLI를 사용자 폴더에 자동 설치하고, 저장소에 포함된 Swift 덮개 모듈을 로컬에서 빌드합니다. Homebrew, Python, 전역 npm 패키지, 다른 잠자기 방지 앱은 필요하지 않습니다.

Git·Swift가 없다면 Apple Command Line Tools가 필요합니다. Git 실행 또는 설치기가 여는 macOS 설치 창을 완료한 뒤 같은 명령을 다시 실행하세요. Microsoft 로그인·MFA와 덮개 모듈의 macOS 관리자 승인은 사용자가 직접 완료합니다. 조직이 도구 설치나 전원 설정을 제한하는 Mac에서는 그 정책을 우회하지 않습니다.

덮개 기능을 나중에 설정하려면 명령을 나눠 실행하세요.

```sh
./bootstrap.sh install    # Teams 자동 갱신만 설치
./bootstrap.sh lid-setup  # 내장 덮개 모듈 설치·활성화
```

설치 후 터미널·AI 작업·저장소를 계속 열어둘 필요는 없습니다. macOS `launchd`가 실행합니다. **본인 Mac 로그인 세션과 네트워크가 유지되어야 하며, 이미 잠들었거나 전원이 꺼진 Mac을 자동으로 깨우지는 않습니다.**

## 로그인 방식

1. 기존 `m365 status`의 사용자 로그인이 있으면 그대로 사용합니다.
2. 없으면 `browser` 로그인, `organizations` 테넌트, 앱 ID `14d82eec-204b-4c2f-b7e8-296a70dab67e`를 사용합니다.
3. `/me`로 본인을 식별하고 본인 presence 조회를 확인합니다. 근무 시간에는 쓰기와 재조회를 검증한 뒤 자동 실행을 등록합니다.

이 앱 ID는 **Microsoft Graph Command Line Tools**의 공개 클라이언트 ID입니다. [Microsoft 앱 목록](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/governance/verify-first-party-apps-sign-in)에서도 확인할 수 있습니다. 각 사용자는 본인 계정으로 로그인합니다.

기본 설치에 새 Entra 앱 등록은 필요하지 않습니다. 로그인과 API 요청이 거부되면 실제 오류 코드로 진단합니다. 일반 Microsoft 365 회사·학교 계정과 Public 클라우드가 대상이며, 조직의 접근 정책에 따라 사용이 제한될 수 있습니다.

여러 계정을 쓰는 경우 명시할 수 있습니다.

```sh
./bootstrap.sh install --account 'me@example.com'
./bootstrap.sh login --account 'me@example.com'
./bootstrap.sh install --account 'me@example.com'
```

`login`은 Microsoft 365 CLI의 현재 연결을 바꿀 수 있습니다. 기존 CLI를 쓰는 다른 자동화가 있으면 같은 계정을 선택하세요. 설치 이후 계정·연결·앱이 바뀌면 쓰기를 중단합니다. 같은 계정의 재로그인으로 연결이 바뀐 경우 `install`을 다시 실행해 연결을 갱신하세요. 다른 계정으로 바꾸려면 원래 계정에서 `stop`, `uninstall`한 뒤 새 계정으로 설치합니다. `uninstall`은 공용 로그인을 지우지 않습니다.

사용자가 이미 사용하는 앱·테넌트를 직접 지정하려는 경우에만 `--app-id APP_ID --tenant TENANT`를 사용하세요. 기본 설치에 필요하지 않습니다.

## 덮개를 닫고 사용할 때

내장 전원 모듈은 macOS의 시스템 잠자기 설정을 제어합니다. 관리자 권한은 이 모듈 설치·교체·제거에만 필요하며, Microsoft 인증 정보는 전원 모듈에 전달하지 않습니다. 매번 비밀번호를 입력할 필요 없이 `lid-on`, `lid-off`로 제어할 수 있습니다.

- 매일 08:00–21:00에 실제 API 갱신이 성공했을 때만 잠자기 방지를 갱신합니다.
- 전원 갱신 한 번의 유효기간은 3분입니다. 스케줄러가 멈추거나 네트워크·로그인 오류로 갱신하지 못하면 자동으로 잠자기를 허용합니다.
- 전원 모듈은 시간·배터리·발열·현재 로그인 사용자를 약 2초마다 확인합니다. 배터리 사용 중 20% 이하, 심한 발열, 전원 상태 확인 실패, 사용자 전환·로그아웃, 근무 시간 종료 시 자체 설정을 해제합니다.
- 모듈 재시작 시 남은 자체 설정을 먼저 복구합니다. 재부팅 후에는 새로운 정상 갱신 전까지 잠자기를 막지 않습니다.
- 이 기능이 켜진 동안에는 덮개 닫기뿐 아니라 시스템 잠자기 자체가 억제됩니다. 즉시 잠들게 하려면 `lid-off`를 실행하세요. 다른 도구가 이미 설정한 잠자기 방지는 임의로 해제하지 않으며 `external_sleep_setting`으로 알립니다. 잠자기 방지 도구를 동시에 사용하지 마세요.
- 화면 잠금·암호·보안 설정을 끄지 않습니다. 자동 잠금 기능을 추가하지는 않으므로, 자리를 비우기 전 **Control–Command–Q**로 화면을 잠그세요. 가방 안에서는 `lid-off`로 잠자기를 허용하세요.

```sh
./bootstrap.sh lid-status # 설치·활성화·남은 유효기간 확인
./bootstrap.sh lid-off    # 덮개 실행 중지, 자체 잠자기 방지 해제
./bootstrap.sh lid-on     # 설치된 모듈 재활성화
./bootstrap.sh lid-remove # 내장 모듈 제거, macOS 승인 필요
```

`closedLid.active: true`는 모듈이 현재 자체 잠자기 방지를 적용했다는 뜻입니다. 물리적으로 덮개를 닫고 실행한 검증과는 다릅니다. 설정 후 덮개를 5분 이상 닫았다가 열고 `status`를 실행하세요. `history`의 닫힌 시간대에 `lidClosed: true`, `ok: true`, `action: renew`, `availability: Available`이 반복되는지 확인합니다. 다른 사람에게 보이는 Teams 화면은 별도로 확인해야 합니다.

## 스케줄과 배터리

| 항목 | 동작 |
|---|---|
| 매일 08:00–20:58 | 2분마다 본인 `Available` 세션 요청, 유효기간 5분 |
| 21:00 | 이 앱의 세션만 해제. 사용자 상태를 Offline으로 강제하지 않음 |
| 21:00–08:00 | 정기 실행 없음. 로그인·잠자기 복귀로 실행되어도 시간 조건 확인 |
| 배터리 사용 중 20% 이하 | 갱신 중단, 최근 세션 해제 시도 |
| 네트워크 끊김 | 실패 코드만 기록하고 다음 예정 시각에 재시도 |
| 계정·앱·연결 변경 | 다른 계정으로 쓰지 않고 중단 |
| 회의·통화·사용자 지정 상태 | Microsoft의 상태 우선순위를 유지. 초록색을 강제로 덮어쓰지 않음 |

시간은 **Mac의 현지 시간**입니다. 공휴일은 별도 제외하지 않습니다. 21시 해제 때 오프라인이거나 Mac이 잠들었다면 마지막 세션은 갱신 후 최대 5분에 만료됩니다. 서버·클라이언트 표시 반영에 지연이 있을 수 있습니다. 끊김 없이 항상 초록색인 것을 보장하지 않습니다.

Graph 세션 ID는 로그인 앱 ID를 사용합니다. 동일 앱 ID로 presence를 갱신하는 다른 도구와 동시에 실행하면 서로 영향을 줄 수 있으므로 함께 사용하지 마세요.

## 관리 명령

```sh
./bootstrap.sh doctor     # 설치·로그인·실제 조회 확인. 상태 쓰기 없음
./bootstrap.sh status     # 현재 Teams 상태, 배터리·덮개, 최근 최대 16회 결과
./bootstrap.sh stop       # 자동 실행·자체 잠자기 방지 중지, 최근 세션 해제 시도
./bootstrap.sh start      # 매일 스케줄 재개
./bootstrap.sh uninstall  # 이 도구의 파일·자동 실행·전원 모듈 제거
./bootstrap.sh prepare    # 실행 도구만 준비. 로그인·스케줄 변경 없음
```

설치 후 저장소를 지웠다면 아래 명령에 `status`, `stop`, `start`, `login`, `lid-setup`, `lid-on`, `lid-off`, `lid-remove`, `uninstall`을 전달하면 됩니다.

```sh
"$HOME/Library/Application Support/Lazyest Presence/lazyest-presence" status
```

업데이트는 저장소에서 `git pull --ff-only` 후 `./bootstrap.sh install --with-lid`입니다. 덮개 기능을 쓰지 않는다면 `--with-lid`를 생략하세요. 동일 계정으로 재설치할 수 있으며 중복 LaunchAgent를 만들지 않습니다.

## 실제 오류가 생겼을 때

- `LOGIN_REQUIRED`: 같은 기본 앱으로 `login`을 한 번 진행하고 `install`을 재시도합니다.
- `PERMISSION_DENIED` / `AADSTS...`: 실제 요청이 거부된 것입니다. 본인 회사 계정·선택한 조직·로그인 동의 화면을 확인하고 같은 방식으로 한 번 재로그인합니다. 계속 실패하면 오류 코드로 해당 조직의 제한을 확인합니다. 무조건 새 앱을 만들거나 관리자 승인을 요청하지 않습니다.
- `ACCOUNT_CHANGED`: 설치 당시와 CLI 연결이 다릅니다. 원래 계정을 선택하고 `install`로 연결을 갱신하세요.
- `NETWORK` / `TIMEOUT`: 네트워크·회사 프록시·인증서 구성을 확인합니다. TLS 검증을 끄지 마세요.
- `POWER_SETUP`: macOS 전원 모듈 승인이 완료되지 않았습니다. `lid-setup`을 다시 실행하고 시스템 승인 창을 확인하세요.
- `POWER_UNAVAILABLE` / `POWER_PERMISSION`: `lid-setup`으로 내장 모듈 설치·사용자 권한을 복구하세요. 다른 앱을 설치할 필요는 없습니다.
- `external_sleep_setting`: 다른 도구가 이미 잠자기를 막고 있습니다. 해당 도구에서 잠자기 방지를 끈 뒤 `lid-on`으로 확인하세요.
- `SCHEDULER_STOPPED`: `start` 후 `lid-on`을 실행하세요.
- `LAUNCHD_FAILED`: GUI에 로그인된 본인 사용자 세션에서 실행하세요. SSH 전용·로그아웃 상태는 대상이 아닙니다.

설치·진단 출력에는 이메일, 사용자 ID, 연결 ID와 개인 설치 경로를 표시하지 않습니다. `status`에는 상태 갱신 시각과 배터리·덮개 정보가 포함되므로 필요한 항목만 공유하세요. 원시 CLI 오류·설정 파일·인증 캐시는 이슈나 채팅에 첨부하지 마세요.

## 설치 위치와 보안

- 실행 코드·전용 Node·CLI·설정·최근 결과: `$HOME/Library/Application Support/Lazyest Presence/`
- 자동 실행: `$HOME/Library/LaunchAgents/com.lazyest.presence.plist`
- 선택한 내장 전원 모듈: `/Library/PrivilegedHelperTools/com.lazyest.presence.power`, `/Library/LaunchDaemons/com.lazyest.presence.power.plist`
- 전원 모듈의 로컬 통신·복구 표식: `/var/run/com.lazyest.presence.power/`, `/var/db/com.lazyest.presence.power/`. root 소유이며 요청은 설치 사용자 UID로 제한합니다. 로그인 정보나 임의 명령을 받지 않습니다.
- 사용자 설치 폴더 700, 설정·상태 파일 600. 상태 파일에 토큰을 저장하지 않습니다.
- Microsoft 인증은 Microsoft 365 CLI의 기존 사용자별 인증 저장소를 사용합니다. CLI가 관리하는 로컬 파일에는 인증 정보가 포함될 수 있으므로 보호하고 공유하지 마세요. 이 도구는 원시 인증 캐시를 읽거나 복사하지 않습니다.
- 전용 CLI 설정에서 사용 통계 전송을 끄고 디버그 출력을 비활성화합니다. 공용 CLI의 설정은 변경하지 않습니다.
- Node 24.20.0은 nodejs.org에서 HTTPS로 받고 저장소에 고정된 SHA-256을 검사합니다. CLI 11.9.0과 하위 의존성은 lockfile로 고정하고 설치 스크립트를 실행하지 않습니다. 시스템의 Node·npm·m365를 교체하지 않습니다.
- 앱 비밀키, 테넌트 전체 권한, 원격 서버, 메시지 전송, 화면 잠금 해제가 없습니다. 본인 계정과 조직의 사용 정책 안에서 사용하세요.

소스 파일은 소스 위치를 기준으로 상대 참조합니다. 사용자 데이터 경로는 설치하는 사람의 홈 디렉터리에서 계산하므로 작성자의 개인 경로가 포함되지 않습니다. `launchd` 실행에 쓰는 절대 경로는 설치할 때 해당 Mac에서 생성하며 Git이나 배포 ZIP에 넣지 않습니다.

별도 설치 위치가 필요하면 `LAZYEST_PRESENCE_HOME`을 지정할 수 있습니다. 상대 경로는 저장소 루트를 기준으로 해석합니다. 이 위치도 소스 저장소 밖에 두고 공개 파일에 포함하지 마세요.

## 개발 및 검증

```sh
npm test
npm run check:public
./scripts/build-power.sh --check
```

Node 내장 테스트로 실행하므로 테스트용 npm 설치나 Microsoft 계정이 필요하지 않습니다. 시간 경계, 계정 변경, 로그인 재사용, 배터리 제한, 네트워크 실패, 세션 해제와 설치 경로 보호를 검증합니다. 실제 Microsoft 쓰기는 테스트에서 호출하지 않습니다. Swift 검사는 배터리·시간·발열·유효기간 경계와 전원 모듈 전체 빌드를 확인하며 시스템 설정은 바꾸지 않습니다.

공개 파일 검사는 Git 추적 파일의 개인 절대 경로, 실제 이메일 형태, 인증 자료 패턴, 런타임 파일과 Markdown의 이스케이프되지 않은 물결표를 차단합니다. 자동 검사는 모든 종류의 민감정보를 판별하지 못하므로 공개 전 변경 내용을 함께 검토하세요. 의존성 버전과 무결성 잠금은 재현 가능한 설치를 위해 유지합니다.

참고: [Microsoft setPresence API](https://learn.microsoft.com/en-us/graph/api/presence-setpresence?view=graph-rest-1.0), [상태 우선순위와 만료](https://learn.microsoft.com/en-us/graph/manage-presence-state), [CLI 로그인](https://pnp.github.io/cli-microsoft365/cmd/login/).
