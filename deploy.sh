#!/bin/bash
set -e

cd /var/www/mw-track
git pull origin main

set -a && source .env.prod && set +a

npm install
npx prisma generate
npx prisma migrate deploy

cd apps/api && npm run build && cd /var/www/mw-track
cd apps/web && npm run build && cd /var/www/mw-track

pm2 restart trafficcrm-api trafficcrm-web

echo "Деплой завершён: $(date)"
