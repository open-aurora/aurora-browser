#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
ln -sfn "$ROOT/run.sh" "$BIN_DIR/aurora-browser"
install -m 644 "$ROOT/assets/icon.png" "$ICON_DIR/aurora-browser.png"

desktop_quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\`/\\\`}
  value=${value//\$/\\\$}
  printf '"%s"' "$value"
}

{
  printf '[Desktop Entry]\n'
  printf 'Type=Application\nName=Аврора Браузер\nName[en]=Aurora Browser\n'
  printf 'GenericName=Web Browser\nComment=Минималистичный браузер для Linux\n'
  printf 'Exec=%s %%U\nIcon=aurora-browser\n' "$(desktop_quote "$BIN_DIR/aurora-browser")"
  printf 'Terminal=false\nCategories=Network;WebBrowser;\nStartupWMClass=Aurora\n'
  printf 'MimeType=x-scheme-handler/http;x-scheme-handler/https;\n'
  printf 'Keywords=browser;web;internet;aurora;аврора браузер;\n'
} > "$APP_DIR/aurora.desktop"

chmod 644 "$APP_DIR/aurora.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
fi

printf 'Ярлык установлен: %s\nКоманда запуска: %s/aurora-browser\n' \
  "$APP_DIR/aurora.desktop" "$BIN_DIR"
printf 'Для запуска из терминала убедитесь, что %s есть в PATH.\n' "$BIN_DIR"
