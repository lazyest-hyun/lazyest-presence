#!/bin/bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRESENCE_DIR="${LAZYEST_PRESENCE_HOME:-$HOME/Library/Application Support/Lazyest Presence}"
[[ "$PRESENCE_DIR" == /* ]] || PRESENCE_DIR="$ROOT_DIR/$PRESENCE_DIR"
export LAZYEST_PRESENCE_HOME="$PRESENCE_DIR"
RUNTIME_DIR="$PRESENCE_DIR/runtime"
NODE_VERSION="24.20.0"
COMMAND="${1:-help}"
if (($#)); then shift; fi
WITH_LID=0
PASSTHROUGH=()
for OPTION in "$@"; do
  if [[ "$OPTION" == --with-lid ]]; then WITH_LID=1; else PASSTHROUGH+=("$OPTION"); fi
done
set -- "${PASSTHROUGH[@]+${PASSTHROUGH[@]}}"
if ((WITH_LID)) && [[ "$COMMAND" != install ]]; then echo '--with-lid는 install에서 사용하세요.' >&2; exit 2; fi

case "$COMMAND" in
  help|-h|--help)
    cat <<'EOF'
Lazyest Presence — macOS Teams 온라인 유지
  ./bootstrap.sh install    Node·CLI 설치, 본인 로그인, 매일 08:00–21:00 자동 실행
  ./bootstrap.sh install --with-lid  위 설치와 내장 덮개 모듈 설정까지 진행
  ./bootstrap.sh doctor     환경과 로그인 상태 확인 (설정 변경 없음)
  ./bootstrap.sh login      본인 계정으로 다시 로그인
  ./bootstrap.sh status     현재 상태와 최근 갱신 결과
  ./bootstrap.sh start      설치된 스케줄 다시 켜기
  ./bootstrap.sh stop       스케줄과 우리 presence 세션만 중지
  ./bootstrap.sh uninstall  우리 설치 파일만 제거 (공용 Microsoft 로그인은 유지)
  ./bootstrap.sh prepare   실행 도구만 설치 (로그인·스케줄 등록 없음)
  ./bootstrap.sh lid-setup  내장 덮개 모듈 빌드·설치 (최초 macOS 관리자 승인)
  ./bootstrap.sh lid-on     덮개 실행 재개
  ./bootstrap.sh lid-off    덮개 실행 중지, 잠자기 허용
  ./bootstrap.sh lid-status 내장 전원 모듈 상태 확인
  ./bootstrap.sh lid-remove 내장 전원 모듈 제거 (macOS 관리자 승인)

Microsoft 비밀번호와 MFA는 브라우저에서 직접 입력하세요.
덮개 기능은 이 저장소의 모듈을 사용합니다. 다른 잠자기 방지 앱은 필요하지 않습니다.
실제 Microsoft 권한 오류 전에는 새 앱 등록·관리자 동의를 요구하지 않습니다.
내장 덮개 모듈 설치·교체·제거에는 별도로 macOS 관리자 승인이 필요합니다.
EOF
    exit 0 ;;
  install|doctor|login|status|start|stop|uninstall|prepare|lid-setup|lid-on|lid-off|lid-status|lid-remove) ;;
  *) echo "알 수 없는 명령: $COMMAND" >&2; exit 2 ;;
esac

[[ "$(uname -s)" == Darwin ]] || { echo '현재 macOS 전용입니다.' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'sudo 없이 본인의 macOS 사용자 세션에서 실행하세요.' >&2; exit 2; }
IFS=. read -r OS_MAJOR OS_MINOR OS_PATCH <<< "$(/usr/bin/sw_vers -productVersion)"
if ((OS_MAJOR < 13 || (OS_MAJOR == 13 && OS_MINOR < 5))); then
  echo 'macOS 13.5 이상이 필요합니다.' >&2; exit 2
fi
[[ "$PRESENCE_DIR" == /* && "$PRESENCE_DIR" != / && "$PRESENCE_DIR" != "$HOME" ]] || {
  echo '안전하지 않은 설치 경로입니다.' >&2; exit 2;
}

prepare() {
  if [[ -L "$PRESENCE_DIR" ]]; then echo '심볼릭 링크 설치 폴더는 사용하지 않습니다.' >&2; exit 2; fi
  if [[ -d "$PRESENCE_DIR" && ! -f "$PRESENCE_DIR/.owner" && -n "$(ls -A "$PRESENCE_DIR")" ]]; then
    echo '설치 경로에 기존 파일이 있어 덮어쓰지 않습니다.' >&2; exit 2
  fi
  if [[ -f "$PRESENCE_DIR/.owner" && "$(cat "$PRESENCE_DIR/.owner")" != lazyest-presence-v1 ]]; then
    echo '다른 프로그램의 설치 폴더입니다.' >&2; exit 2
  fi
  mkdir -p "$PRESENCE_DIR"
  chmod 700 "$PRESENCE_DIR"
  printf 'lazyest-presence-v1\n' > "$PRESENCE_DIR/.owner"
  if [[ -x "$RUNTIME_DIR/node/bin/node" && "$("$RUNTIME_DIR/node/bin/node" --version)" != "v$NODE_VERSION" ]]; then
    echo '설치된 전용 Node 버전이 다릅니다. stop/uninstall 후 다시 설치하세요.' >&2; exit 2
  fi
  if [[ ! -x "$RUNTIME_DIR/node/bin/node" ]]; then
    case "$(uname -m)" in
      arm64) ARCH=arm64; EXPECTED_SHA=40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8 ;;
      x86_64) ARCH=x64; EXPECTED_SHA=9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4 ;;
      *) echo '지원하지 않는 Mac 아키텍처입니다.' >&2; exit 2 ;;
    esac
    STAGING_DIR="$(mktemp -d "$PRESENCE_DIR/node-download.XXXXXX")"
    trap 'rm -rf -- "$STAGING_DIR"' EXIT
    ARCHIVE="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
    echo "Node.js $NODE_VERSION 설치 중 (사용자 폴더, 관리자 권한 불필요)…"
    /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 300 \
      --silent --show-error "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE" -o "$STAGING_DIR/$ARCHIVE"
    ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$STAGING_DIR/$ARCHIVE" | /usr/bin/awk '{print $1}')"
    [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || { echo 'Node 다운로드 체크섬 불일치. 실행하지 않습니다.' >&2; exit 1; }
    /usr/bin/tar -xzf "$STAGING_DIR/$ARCHIVE" -C "$STAGING_DIR"
    mkdir -p "$RUNTIME_DIR"
    mv "$STAGING_DIR/node-v$NODE_VERSION-darwin-$ARCH" "$RUNTIME_DIR/node"
    rm -rf -- "$STAGING_DIR"
    trap - EXIT
  fi
  export PATH="$RUNTIME_DIR/node/bin:$PATH"
  mkdir -p "$RUNTIME_DIR/cli"
  mkdir -p "$RUNTIME_DIR/preferences/configstore"
  printf '{"disableTelemetry":true,"prompt":false}\n' > "$RUNTIME_DIR/preferences/configstore/cli-m365-config.json"
  for CACHE_NAME in .cli-m365-msal.json .cli-m365-connection.json .cli-m365-all-connections.json; do
    CACHE_FILE="$HOME/$CACHE_NAME"
    if [[ -f "$CACHE_FILE" && -O "$CACHE_FILE" && ! -L "$CACHE_FILE" ]]; then chmod 600 "$CACHE_FILE"; fi
  done
  if [[ ! -f "$RUNTIME_DIR/cli/.dependencies-ready" ]] || \
     ! cmp -s "$ROOT_DIR/package-lock.json" "$RUNTIME_DIR/cli/.dependencies-ready" || \
     [[ ! -f "$RUNTIME_DIR/cli/package-lock.json" ]] || \
     ! cmp -s "$ROOT_DIR/package-lock.json" "$RUNTIME_DIR/cli/package-lock.json" || \
     [[ ! -f "$RUNTIME_DIR/cli/node_modules/@pnp/cli-microsoft365/dist/index.js" ]]; then
    cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$RUNTIME_DIR/cli/"
    rm -f "$RUNTIME_DIR/cli/.dependencies-ready"
    echo 'Microsoft 365 CLI 설치 중 (고정된 의존성, 전역 설치 변경 없음)…'
    "$RUNTIME_DIR/node/bin/node" "$RUNTIME_DIR/node/lib/node_modules/npm/bin/npm-cli.js" ci \
      --prefix "$RUNTIME_DIR/cli" --cache "$RUNTIME_DIR/npm-cache" --ignore-scripts --no-audit --no-fund \
      --fetch-timeout 60000 --fetch-retries 2 --loglevel error
    cp "$ROOT_DIR/package-lock.json" "$RUNTIME_DIR/cli/.dependencies-ready"
  fi
}

case "$COMMAND" in install|login|prepare|lid-setup) prepare ;; esac
[[ "$COMMAND" != prepare ]] || { echo '실행 도구 준비 완료. 로그인과 스케줄은 변경하지 않았습니다.'; exit 0; }
NODE_BIN="$RUNTIME_DIR/node/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  if [[ "$COMMAND" == doctor ]]; then
    echo '실행 도구가 아직 없습니다. ./bootstrap.sh install 이 자동 설치합니다.'
    exit 0
  fi
  echo '설치가 필요합니다: ./bootstrap.sh install' >&2
  exit 2
fi
if ((WITH_LID)) || [[ "$COMMAND" == lid-setup ]]; then
  /bin/bash "$ROOT_DIR/scripts/build-power.sh"
fi
if ((WITH_LID)); then
  "$NODE_BIN" "$ROOT_DIR/src/presence.mjs" install "$@"
  exec "$NODE_BIN" "$ROOT_DIR/src/presence.mjs" lid-setup
fi
exec "$NODE_BIN" "$ROOT_DIR/src/presence.mjs" "$COMMAND" "$@"
