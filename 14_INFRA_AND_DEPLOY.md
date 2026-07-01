# 14 — Инфраструктура и деплой

## Задача для Claude Code
Создай все конфиги для Docker, Nginx, CI/CD.

---

## ⚠️ Реальный деплой 2026-06-29 — отличие от схемы ниже

Всё, что описано дальше в этом документе (`docker-compose.prod.yml` с контейнерами
`nginx`+`certbot`, `infra/nginx/nginx.conf`, `infra/nginx/sites/DOMAIN.conf`) — валидная
схема для **выделенного VPS**, на котором кроме TrafficCRM ничего не крутится.

Реальный сервер, на котором сейчас живёт прод TrafficCRM, — **не такой**: на нём уже
годами работает системный nginx (apt-пакет, управляется через `systemctl`), который
держит порты 80/443 для других, не относящихся к TrafficCRM сайтов на этом же хосте.
Поднять второй nginx в Docker на тех же портах физически невозможно (порт занят),
а останавливать системный nginx — означало бы положить чужие живые сайты.

Поэтому на этом проде:
- `api`/`web` запускаются как обычные процессы на хосте (`node dist/main`, `next start`),
  не в Docker — только `postgres`/`redis`/`minio` реально в контейнерах.
- Клиентские домены TrafficCRM (`DomainsService`/`NginxService`,
  `apps/api/src/modules/domains/domains.service.ts` и
  `apps/api/src/modules/landings/nginx.service.ts`) обслуживаются **тем же системным
  nginx** и тем же системным `certbot --nginx` (apt-пакет `certbot`), которым этот
  сервер уже выпускает сертификаты для остальных, не относящихся к TrafficCRM доменов.
  Конфиги пишутся прямо в `/etc/nginx/sites-enabled/<домен>` (внешний блок с
  `server_name`, который и находит `certbot --nginx` для дополнения `ssl_certificate`)
  + `/etc/nginx/trafficcrm-targets/<домен>.conf` (инклюд с реальным `proxy_pass` на
  лендинг — отдельный файл специально, чтобы certbot, переписывающий внешний блок при
  выпуске сертификата, никогда не затирался последующими сменами лендинга через
  `attachLanding`).
- `docker-compose.prod.yml` ниже больше **не содержит** сервисов `nginx`/`certbot` —
  они убраны как нерабочие в такой конфигурации (порт уже занят) и заменены системными.
  Секция "Nginx конфиги"/"infra/nginx/" ниже остаётся в репозитории как образец для
  гипотетического деплоя на чистый выделенный VPS, но не описывает то, что реально
  выполняется в коде сейчас.

Если когда-нибудь TrafficCRM переедет на собственный выделенный сервер без конкурентов
за 80/443 — описанную ниже схему (`docker-compose.prod.yml` + контейнеры nginx/certbot)
можно вернуть, но `NginxService`/`DomainsService` тогда придётся переписать обратно на
`docker compose exec/run` (см. историю в git/15_PHASES.md).

---

## Dockerfile для API

```dockerfile
# apps/api/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/ ./packages/
COPY prisma/ ./prisma/

RUN npm ci --workspace=apps/api

COPY apps/api ./apps/api

RUN npm run build --workspace=apps/api
RUN npx prisma generate

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production

EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
```

---

## Dockerfile для Web

```dockerfile
# apps/web/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/ ./packages/

RUN npm ci --workspace=apps/web

COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

---

## docker-compose.prod.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file: .env.prod
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: node apps/api/dist/worker.js
    env_file: .env.prod
    restart: unless-stopped
    depends_on:
      - api
      - redis
    networks:
      - internal

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    env_file: .env.prod
    restart: unless-stopped
    networks:
      - internal

  nginx:
    image: nginx:1.25-alpine
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infra/nginx/conf.d:/etc/nginx/conf.d:ro
      - nginx_sites:/etc/nginx/sites:rw
      - certbot_certs:/etc/letsencrypt:ro
      - certbot_www:/var/www/certbot:ro
    ports:
      - "80:80"
      - "443:443"
    restart: unless-stopped
    networks:
      - internal
      - external
    depends_on:
      - api
      - web

  certbot:
    image: certbot/certbot
    volumes:
      - certbot_certs:/etc/letsencrypt
      - certbot_www:/var/www/certbot
    entrypoint: /bin/sh -c "trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done"

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - internal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    restart: unless-stopped
    networks:
      - internal

networks:
  internal:
    driver: bridge
  external:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  minio_data:
  nginx_sites:
  certbot_certs:
  certbot_www:
```

---

## Nginx конфиги

```nginx
# infra/nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Логи
    log_format main '$remote_addr - $http_cf_connecting_ip - $request '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';
    access_log /var/log/nginx/access.log main;

    # Оптимизация
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=track:10m rate=300r/m;

    # Включить конфиги сайтов
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites/*.conf;
}
```

```nginx
# infra/nginx/conf.d/main.conf

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name _;
    
    # Certbot challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$host$request_uri;
    }
}

# API
server {
    listen 443 ssl http2;
    server_name api.trafficcrm.io;

    ssl_certificate /etc/letsencrypt/live/api.trafficcrm.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.trafficcrm.io/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;

    # Rate limiting для API
    limit_req zone=api burst=20 nodelay;

    # Без rate limiting для трекинга (высокочастотный)
    location /api/v1/track/ {
        limit_req zone=track burst=100 nodelay;
        proxy_pass http://api:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    }

    location / {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}

# Dashboard (Frontend)
server {
    listen 443 ssl http2;
    server_name app.trafficcrm.io;

    ssl_certificate /etc/letsencrypt/live/app.trafficcrm.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.trafficcrm.io/privkey.pem;

    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# CDN (MinIO публичные файлы)
server {
    listen 443 ssl http2;
    server_name cdn.trafficcrm.io;

    ssl_certificate /etc/letsencrypt/live/cdn.trafficcrm.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cdn.trafficcrm.io/privkey.pem;

    location / {
        proxy_pass http://minio:9000;
        proxy_set_header Host $host;
        
        # Кэширование статики
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```nginx
# Шаблон для клиентских доменов (лендинги)
# Создаются программно через NginxService
# infra/nginx/sites/DOMAIN.conf

server {
    listen 443 ssl http2;
    server_name DOMAIN www.DOMAIN;

    ssl_certificate /etc/letsencrypt/live/DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Отдавать лендинг через API
    location / {
        proxy_pass http://api:3001/api/v1/internal/serve-landing/LANDING_ID;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    }
}

server {
    listen 80;
    server_name DOMAIN www.DOMAIN;
    return 301 https://DOMAIN$request_uri;
}
```

---

## Деплой скрипты

```bash
# infra/scripts/deploy.sh
#!/bin/bash
set -e

echo "🚀 Деплой TrafficCRM..."

# Pull последние изменения
git pull origin main

# Сборка образов
docker-compose -f docker-compose.prod.yml build --no-cache api web

# Миграции БД (без остановки сервера)
docker-compose -f docker-compose.prod.yml run --rm api node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$executeRaw\`SELECT 1\`.then(() => process.exit(0));
"

# Запустить миграции
docker-compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL=$DATABASE_URL \
  api npx prisma migrate deploy

# Перезапустить сервисы (zero-downtime для web и api)
docker-compose -f docker-compose.prod.yml up -d --no-deps api worker web

# Перезагрузить nginx
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "✅ Деплой завершён!"
```

```bash
# infra/scripts/setup-ssl.sh
#!/bin/bash
# Получить SSL сертификаты для основных доменов

DOMAINS="api.trafficcrm.io app.trafficcrm.io cdn.trafficcrm.io"
EMAIL="admin@trafficcrm.io"

for DOMAIN in $DOMAINS; do
  docker-compose -f docker-compose.prod.yml run --rm certbot \
    certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN
done

echo "✅ SSL сертификаты получены"
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

```bash
# infra/scripts/backup.sh
#!/bin/bash
# Бэкап PostgreSQL

BACKUP_DIR="/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="trafficcrm_${DATE}.sql.gz"

mkdir -p $BACKUP_DIR

docker-compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U $DB_USER $DB_NAME | gzip > "$BACKUP_DIR/$FILENAME"

# Удалить бэкапы старше 30 дней
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "✅ Бэкап создан: $FILENAME"

# Загрузить в MinIO (опционально)
# docker-compose run --rm minio-client mc cp "$BACKUP_DIR/$FILENAME" minio/backups/
```

---

## GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to server
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/trafficcrm
            bash infra/scripts/deploy.sh
```

---

## Worker точка входа (BullMQ воркеры)

```typescript
// apps/api/src/worker.ts
// Отдельный процесс только для воркеров очередей
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  await app.init();
  console.log('Worker started');
}

bootstrap();
```

```typescript
// apps/api/src/worker.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    PrismaModule,
    TrackingModule,   // содержит TrackingProcessor
    PushesModule,     // содержит PushProcessor
    BillingModule,    // содержит CryptoMonitorProcessor
  ],
})
export class WorkerModule {}
```

---

## Health Check endpoint

```typescript
// modules/health/health.controller.ts
@Controller('health')
export class HealthController {

  @Public()
  @Get()
  async check() {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const db = checks[0].status === 'fulfilled';
    const redis = checks[1].status === 'fulfilled';

    const status = db && redis ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: db ? 'ok' : 'error',
        redis: redis ? 'ok' : 'error',
      }
    };
  }
}
```

---

## Первоначальная настройка сервера Hetzner

```bash
# Выполнить один раз после создания сервера

# 1. Обновить систему
apt update && apt upgrade -y

# 2. Установить Docker
curl -fsSL https://get.docker.com | bash
usermod -aG docker $USER

# 3. Установить Docker Compose
apt install docker-compose-plugin -y

# 4. Создать папку проекта
mkdir -p /opt/trafficcrm
cd /opt/trafficcrm

# 5. Клонировать репозиторий
git clone https://github.com/youruser/trafficcrm.git .

# 6. Создать .env.prod файл
cp .env.example .env.prod
nano .env.prod  # заполнить все переменные

# 7. Создать папки для данных
mkdir -p /backups/postgres
mkdir -p /opt/trafficcrm/infra/nginx/sites

# 8. Первый запуск инфраструктуры
docker-compose -f docker-compose.prod.yml up -d postgres redis minio

# 9. Подождать запуска БД и выполнить миграции
sleep 10
docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker-compose -f docker-compose.prod.yml run --rm api npx prisma db seed

# 10. Получить SSL сертификаты
bash infra/scripts/setup-ssl.sh

# 11. Запустить все сервисы
docker-compose -f docker-compose.prod.yml up -d

# 12. Настроить cron для бэкапов
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/trafficcrm/infra/scripts/backup.sh") | crontab -

echo "✅ Сервер готов!"
```

---

## Мониторинг (опционально, добавить в docker-compose.prod.yml)

```yaml
  # Uptime мониторинг через UptimeRobot (бесплатно)
  # Добавить URL https://api.trafficcrm.io/api/v1/health

  # Bull Board — визуальный интерфейс для очередей
  bull-board:
    image: deadly0/bull-board:latest
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    ports:
      - "3002:3000"  # только для внутреннего доступа, не публичный
    networks:
      - internal
```
