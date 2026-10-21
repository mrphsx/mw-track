#!/usr/bin/env bash
# Выкладка apps/web без поломки уже открытых вкладок (2026-10-21).
# Сборка идёт в .next-build, пока живой сайт работает из .next; затем старые
# хэшированные файлы static/ копируются в новую сборку (открытые вкладки продолжат их
# получать), папки подменяются и процесс перезапускается.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.prod; set +a
cd apps/web
rm -rf .next-build
NEXT_BUILD_DIR=.next-build npx next build
if grep -rlq "localhost:3001" .next-build/static/chunks/*.js; then
  echo "ОШИБКА: в сборку попал localhost:3001 — выкладка отменена" >&2
  exit 1
fi
if [ -d .next/static ]; then cp -rn .next/static/. .next-build/static/; fi
rm -rf .next-prev
if [ -d .next ]; then mv .next .next-prev; fi
mv .next-build .next
pm2 restart trafficcrm-web >/dev/null
echo "web выложен; откат: cd apps/web && mv .next .next-bad && mv .next-prev .next && pm2 restart trafficcrm-web"
