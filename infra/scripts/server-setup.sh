#!/bin/bash
# Первоначальная настройка чистого сервера (Hetzner Ubuntu 24.04 или похожий).
# Выполняется ОДИН раз вручную после создания сервера, под root или с sudo.
# Перед запуском: купить домен, направить A-записи api.yourdomain.com и
# app.yourdomain.com на IP сервера, отредактировать .env.prod и
# infra/nginx/conf.d/main.conf (домены).
set -e

REPO_URL="${1:?Использование: server-setup.sh <git-repo-url>}"

apt update && apt upgrade -y

curl -fsSL https://get.docker.com | bash

mkdir -p /opt/trafficcrm
cd /opt/trafficcrm
git clone "$REPO_URL" .

if [ ! -f .env.prod ]; then
  cp .env.prod.example .env.prod
  echo "Заполните /opt/trafficcrm/.env.prod перед продолжением, затем запустите скрипт снова."
  exit 0
fi

mkdir -p /backups/postgres
mkdir -p /opt/trafficcrm/infra/nginx/sites

# build.args для web читает NEXT_PUBLIC_API_URL из шелл-окружения при парсинге
# compose-файла, а не из env_file — экспортируем явно (см. комментарий в deploy.sh)
set -a
source .env.prod
set +a

docker compose -f docker-compose.prod.yml up -d postgres redis

sleep 10
docker compose -f docker-compose.prod.yml build api web
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml run --rm api npx prisma db seed

bash infra/scripts/setup-ssl.sh

docker compose -f docker-compose.prod.yml up -d

(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/trafficcrm && set -a && . ./.env.prod && set +a && bash infra/scripts/backup.sh >> /var/log/trafficcrm-backup.log 2>&1") | crontab -

echo "Сервер готов."
