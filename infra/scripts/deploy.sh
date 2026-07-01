#!/bin/bash
set -e

echo "Деплой TrafficCRM..."

git pull origin main

# docker-compose.prod.yml собирает web с --build-arg NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} —
# а это значение compose берёт из переменных шелла/.env при ПАРСИНГЕ файла, а не из
# env_file:.env.prod (тот применяется только к уже запущенному контейнеру). Без явного
# экспорта здесь сборка ушла бы с пустым NEXT_PUBLIC_API_URL.
set -a
source .env.prod
set +a

docker compose -f docker-compose.prod.yml build api web

docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy

docker compose -f docker-compose.prod.yml up -d --no-deps api web

docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "Деплой завершён."
