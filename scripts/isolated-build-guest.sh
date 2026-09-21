#!/usr/bin/env bash
# Invoke ONLY in the new Ubuntu guest, with env -i HOME=/home/builder USER=builder
# PATH=/usr/bin:/bin LANG=C.UTF-8 bash isolated-build-guest.sh deps|build|av
set -Eeuo pipefail
umask 022
BASE=/home/builder/susu155-final44
BUILD_ID=susu155-electron44.4.3-final-20260920
PROJECT=$BASE/project
PHASE=${1:?deps or build or av}
test "$(id -un)" = builder
test "$(uname -s)" = Linux
test -d /home/builder
mkdir -p "$BASE/logs" "$BASE/downloads" "$BASE/toolchain" "$BASE/cache/builder" "$BASE/cache/npm" "$BASE/reports"
exec > >(tee "$BASE/logs/${PHASE}-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
trap 'rc=$?; printf "PHASE=%s EXIT=%s UTC=%s\n" "$PHASE" "$rc" "$(date -u +%FT%TZ)"' EXIT
printf 'PHASE=%s START=%s\n' "$PHASE" "$(date -u +%FT%TZ)"
printf 'BUILD_ID=%s ELECTRON=44.4.3 APP_VERSION=1.5.6 GUI=pending-new-build\n' "$BUILD_ID"
export PATH="$BASE/toolchain/node-v22.23.2-linux-x64/bin:/usr/bin:/bin"
export ELECTRON_BUILDER_CACHE="$BASE/cache/builder"
export npm_config_cache="$BASE/cache/npm"
mkdir -p "$BASE/config"
: > "$BASE/config/npm-user.npmrc"
: > "$BASE/config/npm-global.npmrc"
export npm_config_userconfig="$BASE/config/npm-user.npmrc" npm_config_globalconfig="$BASE/config/npm-global.npmrc"
export npm_config_registry=https://registry.npmjs.org
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export CSC_IDENTITY_AUTO_DISCOVERY=false USE_SYSTEM_7ZA=false
export WINEPREFIX="$BASE/wine-build" WINEARCH=win64 WINEDEBUG=-all
unset CUSTOM_APP_BUILDER_PATH ELECTRON_BUILDER_NSIS_DIR ELECTRON_MIRROR NPM_CONFIG_ELECTRON_MIRROR ESBUILD_BINARY_PATH NODE_OPTIONS NODE_PATH
download() { curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 30 "$1" -o "$2"; }
if [[ "$PHASE" == deps ]]; then
  # Builder 25.1.8 uses upstream rcedit-ia32.exe even for an x64 application.
  sudo -n dpkg --add-architecture i386
  sudo -n apt-get update
  sudo -n env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends wine wine64 wine32:i386 xvfb xauth curl unzip zip xz-utils ca-certificates libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libatk-bridge2.0-0t64 libdrm2 libxss1 libxkbcommon0 clamav clamav-freshclam python3-pefile p7zip-full
  NODE_FILE=node-v22.23.2-linux-x64.tar.xz
  download https://nodejs.org/dist/v22.23.2/SHASUMS256.txt "$BASE/downloads/node-SHASUMS256.txt"
  grep -Fx "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  $NODE_FILE" "$BASE/downloads/node-SHASUMS256.txt"
  download "https://nodejs.org/dist/v22.23.2/$NODE_FILE" "$BASE/downloads/$NODE_FILE"
  printf 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  %s\n' "$BASE/downloads/$NODE_FILE" | sha256sum -c -
  tar -xJf "$BASE/downloads/$NODE_FILE" -C "$BASE/toolchain" --no-same-owner
  node --version
  node "$BASE/toolchain/node-v22.23.2-linux-x64/lib/node_modules/npm/bin/npm-cli.js" --version
  cd "$PROJECT"
  node scripts/isolated-build-verify.cjs lock
  # No lifecycle scripts or npm-generated symlinks; invoke fresh CLIs directly.
  node "$BASE/toolchain/node-v22.23.2-linux-x64/lib/node_modules/npm/bin/npm-cli.js" ci --ignore-scripts --include=dev --include=optional --registry=https://registry.npmjs.org --no-audit --no-fund --bin-links=false
  download https://github.com/electron/electron/releases/download/v44.4.3/SHASUMS256.txt "$BASE/downloads/electron-SHASUMS256.txt"
  grep -E '^790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b [ *]+electron-v44.4.3-win32-x64.zip$' "$BASE/downloads/electron-SHASUMS256.txt"
  download https://github.com/electron/electron/releases/download/v44.4.3/electron-v44.4.3-win32-x64.zip "$BASE/downloads/electron-v44.4.3-win32-x64.zip"
  printf '790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b  %s\n' "$BASE/downloads/electron-v44.4.3-win32-x64.zip" | sha256sum -c -
  python3 scripts/isolated-build-source.py "$BASE/downloads/electron-v44.4.3-win32-x64.zip" "$PROJECT/node_modules/electron/dist" --distribution
  printf electron.exe > node_modules/electron/path.txt
  # Explicit reviewed esbuild lifecycle only, after npm SRI verification.
  node node_modules/esbuild/install.js
  node scripts/isolated-build-verify.cjs tools
  dpkg-query -W wine wine64 xvfb clamav clamav-freshclam > "$BASE/reports/apt-versions.txt"
elif [[ "$PHASE" == build ]]; then
  cd "$PROJECT"
  node scripts/isolated-build-verify.cjs tools
  for file in electron/*.cjs scripts/*.cjs tests/security-*.cjs vite.config.mjs; do node --check "$file"; done
  DANGO_TEST_REAL_PACKS=1 node --test tests/security-quarantine.test.cjs tests/security-preflight.test.cjs
  node node_modules/typescript/bin/tsc --noEmit
  node scripts/preflight-security.cjs --json > "$BASE/reports/preflight-before.json"
  node scripts/apply-portable-patch.cjs
  node node_modules/vite/bin/vite.js build
  xvfb-run -a node scripts/pack-portable.cjs
  node scripts/preflight-security.cjs --json > "$BASE/reports/preflight-after.json"
  node scripts/isolated-build-verify.cjs artifact
elif [[ "$PHASE" == av ]]; then
  mkdir -p "$BASE/clamdb"
  printf 'DatabaseDirectory %s\nDatabaseMirror database.clamav.net\nDatabaseOwner builder\nScriptedUpdates yes\nConnectTimeout 30\nReceiveTimeout 120\n' "$BASE/clamdb" > "$BASE/clamdb/freshclam.conf"
  set +e
  timeout 600 freshclam --config-file="$BASE/clamdb/freshclam.conf" --stdout
  rc=$?
  printf 'FRESHCLAM_EXIT=%s\n' "$rc"
  database="$BASE/clamdb"
  source=manual-freshclam
  # Ubuntu's AppArmor correctly refuses freshclam config under /home. Do not
  # disable it or stop the daemon; retain the denial and use the new guest's
  # official freshclam service database if it has actually downloaded one.
  sudo -n journalctl -u clamav-freshclam.service --no-pager > "$BASE/reports/freshclam-service.log"
  sudo -n journalctl -k --grep=apparmor --no-pager > "$BASE/reports/apparmor.log"
  if [[ $rc != 0 && ( -f /var/lib/clamav/daily.cvd || -f /var/lib/clamav/daily.cld ) && ( -f /var/lib/clamav/main.cvd || -f /var/lib/clamav/main.cld ) ]]; then
    database=/var/lib/clamav
    source=official-freshclam-service
  fi
  if [[ $rc == 0 || "$source" == official-freshclam-service ]]; then
    clamscan --version | tee "$BASE/reports/clamav-version.txt"
    clamscan --database="$database" --version | tee -a "$BASE/reports/clamav-version.txt"
    for db in "$database"/*.cvd "$database"/*.cld; do if [[ -f "$db" ]]; then sigtool --info "$db"; fi; done > "$BASE/reports/clamav-signatures.txt"
    nice -n 15 ionice -c 3 clamscan --database="$database" --recursive --allmatch=yes --infected --max-scantime=600000 --max-filesize=600M --max-scansize=2000M --max-recursion=40 --alert-exceeds-max=yes "$PROJECT" "$BASE/verification" > "$BASE/reports/clamav-scan.txt" 2>&1
    scanrc=$?
    cat "$BASE/reports/clamav-scan.txt"
    printf '{"buildId":"%s","manualDatabaseUpdateExit":%s,"databaseSource":"%s","databaseDirectory":"%s","scanExit":%s,"maxScanTimeMs":600000,"allMatch":true}\n' "$BUILD_ID" "$rc" "$source" "$database" "$scanrc" > "$BASE/reports/antivirus-status.json"
  else
    printf '{"databaseUpdateExit":%s,"scanExit":null,"status":"unavailable: official signature database download failed"}\n' "$rc" > "$BASE/reports/antivirus-status.json"
  fi
  set -e
else
  echo 'Unknown phase' >&2; exit 2
fi
