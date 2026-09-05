#!/bin/bash
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRESENCE_DIR="${LAZYEST_PRESENCE_HOME:-$HOME/Library/Application Support/Lazyest Presence}"
[[ "$PRESENCE_DIR" == /* ]] || PRESENCE_DIR="$ROOT_DIR/$PRESENCE_DIR"
[[ "$(uname -s)" == Darwin && "$(id -u)" != 0 ]] || { echo '일반 macOS 사용자로 빌드하세요.' >&2; exit 2; }
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  /usr/bin/xcode-select --install >/dev/null 2>&1 || true
  echo 'Apple Command Line Tools 설치 창을 열었습니다. 시스템 설치를 완료한 뒤 같은 명령을 다시 실행하세요.' >&2
  exit 2
fi
if [[ "${1:-}" == --check ]]; then
  BUILD_DIR="$(mktemp -d)"
else
  [[ -f "$PRESENCE_DIR/.owner" && ! -L "$PRESENCE_DIR" && "$(cat "$PRESENCE_DIR/.owner")" == lazyest-presence-v1 ]] || {
    echo '먼저 bootstrap.sh prepare를 실행하세요.' >&2; exit 2;
  }
  mkdir -p "$PRESENCE_DIR/power"
  BUILD_DIR="$(mktemp -d "$PRESENCE_DIR/power/build.XXXXXX")"
fi
trap 'rm -rf -- "$BUILD_DIR"' EXIT
cd "$ROOT_DIR"
if [[ "${1:-}" == --check ]]; then
  if ! /usr/bin/xcrun swiftc -swift-version 5 -O -parse-as-library native/PowerPolicy.swift native/PowerPolicyChecks.swift -o "$BUILD_DIR/checks" >"$BUILD_DIR/build.log" 2>&1; then
    echo '전원 안전성 검사 빌드 실패. Apple Command Line Tools를 확인하세요.' >&2; exit 1
  fi
  "$BUILD_DIR/checks"
fi
if ! /usr/bin/xcrun swiftc -swift-version 5 -O -parse-as-library -target "$(uname -m)-apple-macos13.0" \
  native/PowerPolicy.swift native/PresencePower.swift -o "$BUILD_DIR/lazyest-presence-power" >"$BUILD_DIR/build.log" 2>&1; then
  echo '내장 덮개 모듈 빌드 실패. Apple Command Line Tools를 확인하세요.' >&2; exit 1
fi
if ! /usr/bin/codesign --force --sign - --identifier com.lazyest.presence.power --options runtime "$BUILD_DIR/lazyest-presence-power" >>"$BUILD_DIR/build.log" 2>&1 || \
   ! /usr/bin/codesign --verify --strict "$BUILD_DIR/lazyest-presence-power" >>"$BUILD_DIR/build.log" 2>&1; then
  echo '내장 덮개 모듈 서명 검사 실패.' >&2; exit 1
fi
if [[ "${1:-}" == --check ]]; then
  echo 'Native power helper build and signature checks passed'
else
  mv "$BUILD_DIR/lazyest-presence-power" "$PRESENCE_DIR/power/lazyest-presence-power"
  echo '내장 덮개 모듈 빌드 완료. 외부 앱은 설치하지 않았습니다.'
fi
