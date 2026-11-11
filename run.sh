#!/usr/bin/env bash
# Аврора Браузер — запуск браузера
cd "$(dirname "$(readlink -f "$0")")" || exit 1
export ELECTRON_OZONE_PLATFORM_HINT=auto
exec ./node_modules/.bin/electron . --no-sandbox "$@"
