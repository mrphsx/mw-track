# MWTRACK (mw-track) — настройка и запуск

Мульти-тенантная CRM для медиабайеров (трафик-арбитраж), витрина продукта — MWTRACK.
Полное архитектурное описание: [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md) и
[14_INFRA_AND_DEPLOY.md](14_INFRA_AND_DEPLOY.md). Этот файл — практический рантайм-гайд:
как поднять всё с нуля и как перезапускать/эксплуатировать уже работающий прод.

## Архитектура этого конкретного сервера

**Важно**: реальный прод устроен НЕ так, как «чистая» Docker-схема в
`docker-compose.prod.yml`/`14_INFRA_AND_DEPLOY.md` — на этом сервере уже годами работает
системный nginx для чужих, не относящихся к mw-track сайтов, и второй nginx в Docker на тех
же портах 80/443 просто не поднимется.

| Компонент | Как запущен | Порт |
|---|---|---|
| `trafficcrm-api` (NestJS) | PM2, процесс на хосте (`node dist/main.js`) | 3001 |
| `trafficcrm-web` (Next.js, apps/web) | PM2, процесс на хосте (`next start`) | 3000 |
| `trafficcrm-admin` (Next.js, apps/admin) | PM2, процесс на хосте (`next start -H 127.0.0.1`) | 3002, только localhost |
| PostgreSQL 16 | Docker (`docker-compose.prod.yml`) | 127.0.0.1:5432 |
| Redis 7 | Docker | 127.0.0.1:6379 |
| MinIO | Docker | 127.0.0.1:9000-9001 |
| nginx | **системный** (apt), НЕ в Docker | 80/443 |
| certbot | **системный** (apt), `certbot --nginx`, автопродление через `certbot.timer` | — |

API/Web/Admin работают на хосте (не в Docker), потому что `NginxService`/`DomainsService`
(`apps/api/src/modules/domains/domains.service.ts`,
`apps/api/src/modules/landings/nginx.service.ts`) сами пишут в `/etc/nginx/sites-enabled/` и
зовут системный `certbot` напрямую — для самостоятельного выпуска SSL под домены, которые
клиенты подключают к своим лендингам. Только Postgres/Redis/MinIO — реально в контейнерах,
и слушают только `127.0.0.1` (наружу не смотрят).

Домены (все за Cloudflare, оранжевое облако): `mw-track.com` (Studio, основной UI),
`old.mw-track.com` (классический UI, тот же процесс на 3000, роутинг по `Host` в
`apps/web/src/middleware.ts`), `api.mw-track.com`, `admin.mw-track.com` (правит на
127.0.0.1:3002 через nginx), `cdn.mw-track.com` (публичный бакет MinIO под `track.js`),
плюс отдельный редирект-домен из `TG_REDIRECT_BASE_URL` (см. `.env.prod`).

## Требования

- Node.js 20.x, npm ≥ 10
- Docker + Docker Compose (для Postgres/Redis/MinIO)
- nginx + certbot, установленные в системе (`apt-get install nginx certbot python3-certbot-nginx`)
- `ffmpeg`/`ffprobe` в системе (`apt-get install ffmpeg`) — нужен `VideoProcessingService` для
  обрезки видео в квадрат под Telegram `video_note` ("кружки"). Не упомянут ни в одном
  Dockerfile/package.json — при переносе на новый сервер об этом легко забыть.

## Настройка с нуля (новый сервер)

```bash
git clone <repo-url> /var/www/mw-track
cd /var/www/mw-track
npm install                      # ставит зависимости во всех workspaces (apps/*)

cp .env.prod.example .env.prod   # затем заполнить реальными значениями — см. ниже
```

Обязательные переменные в `.env.prod` (без них ключевые части не заведутся):
`DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `JWT_SECRET`/`JWT_REFRESH_SECRET`,
`SESSION_ENCRYPTION_KEY` (генерировать один раз — `openssl rand -base64 32` — и никогда не
менять, иначе все уже сохранённые MTProto-сессии личных аккаунтов перестанут расшифровываться),
`TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (my.telegram.org), `APP_URL`/`API_URL`/`NEXT_PUBLIC_API_URL`.
Можно оставить пустыми на первое время (не критично для основного функционала CRM):
TronGrid/Infura/Heleket (крипто-биллинг), `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN`
(Instagram Direct). Полный список с комментариями — в самом `.env.prod.example`.

```bash
# Поднять инфраструктурные контейнеры (Postgres/Redis/MinIO — не api/web!)
docker compose -f docker-compose.prod.yml up -d postgres redis minio

# Применить миграции к боевой базе (НЕ migrate dev — тот интерактивный и для прода не годится)
set -a; source .env.prod; set +a
npx prisma migrate deploy
npx prisma generate

# Собрать все три приложения
npx nest build --project apps/api  # или: cd apps/api && npm run build
cd apps/web && npm run build && cd ../..
cd apps/admin && npm run build && cd ../..
```

nginx/certbot настраиваются вручную один раз под реальные домены (`certbot --nginx -d
mw-track.com -d old.mw-track.com -d api.mw-track.com ...` и т.д., затем `admin.mw-track.com`
отдельным server-блоком, проксирующим на `127.0.0.1:3002`) — это делается один раз при
разворачивании сервера, не автоматизировано скриптом.

```bash
# Запустить всё через PM2
pm2 start ecosystem.config.js
pm2 save                      # обязательно! иначе список процессов не переживёт ребут
pm2 startup                   # один раз — включает systemd-юнит pm2-<user>, автостарт при бута
```

## Повседневная эксплуатация (уже работающий прод)

**Перезапустить всё** (api + web + admin; PM2 сам подхватит текущий `.env.prod` и уже
собранные `dist`/`.next` — код заново НЕ собирает):

```bash
pm2 restart trafficcrm-api trafficcrm-web trafficcrm-admin
```

**Полный чистый перезапуск** (если один из процессов "потерялся" из списка PM2 — см.
раздел "Грабли" ниже — а не просто завис):

```bash
pm2 delete trafficcrm-api trafficcrm-web trafficcrm-admin
pm2 start /var/www/mw-track/ecosystem.config.js
pm2 save
```

**Перезапустить один сервис**: `pm2 restart trafficcrm-api` (аналогично `-web`/`-admin`).

**Задеплоить изменения кода** (после `git pull`/правок):

```bash
cd /var/www/mw-track
npm install                                    # если менялись зависимости
npx prisma migrate deploy                      # если появились новые миграции
cd apps/api && npm run build && cd ../..
cd apps/web && set -a && source ../../.env.prod && set +a && npm run build && cd ../..  # см. "Грабли" про NEXT_PUBLIC_*
cd apps/admin && npm run build && cd ../..
pm2 restart trafficcrm-api trafficcrm-web trafficcrm-admin
```

**Логи**: `pm2 logs trafficcrm-api` (живой хвост) или файлы напрямую —
`logs/api-{out,error}.log`, `logs/web-{out,error}.log`, `logs/admin-{out,error}.log`
(путь настроен в `ecosystem.config.js`).

**Статус**: `pm2 list` — колонка `↺` (restart count) резко растущая = процесс падает в
цикле, смотреть `pm2 logs <имя> --err --lines 50`.

**Проверка живости** (без реального трафика):
```bash
curl -s http://127.0.0.1:3001/api/v1/health          # API
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: mw-track.com' http://127.0.0.1:3000/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/   # Admin
```

**Инфраструктурные контейнеры** (Postgres/Redis/MinIO) обычно не требуют ручного
перезапуска — `restart: unless-stopped` в `docker-compose.prod.yml` поднимает их
самостоятельно при ребуте докер-демона:
```bash
docker compose -f docker-compose.prod.yml ps        # статус
docker compose -f docker-compose.prod.yml restart postgres redis minio
```

## Грабли, о которые уже спотыкались на этом сервере

- **`pm2 resurrect` после ребута сервера не обязательно поднимает ВСЕ процессы** — только те,
  что были в списке на момент последнего `pm2 save`. Если добавили новый PM2-процесс
  (например `trafficcrm-admin`) и забыли `pm2 save` после — при следующем ребуте сервера он
  просто не появится, без единой ошибки в логах. Правило: **после любого `pm2 start`
  нового процесса — сразу `pm2 save`.**
- **PM2's `env_file` ненадёжен на этой версии PM2** — `ecosystem.config.js` сам парсит
  `.env.prod` через пакет `dotenv` и передаёт как `env: {...}` в конфиге каждого приложения
  (не полагается на встроенный `env_file`). Если правите `ecosystem.config.js` — не
  возвращайтесь к `env_file`, оно тихо не сработает.
- **`NEXT_PUBLIC_*` переменные запекаются в JS-бандл во время `next build`**, не читаются
  заново при `next start`. Если пересобираете `apps/web`/`apps/admin` без предварительного
  `source .env.prod` — в собранный бандл зашьётся `localhost` вместо реального
  `NEXT_PUBLIC_API_URL`, и фронтенд у реальных пользователей перестанет достучаться до API.
  Всегда `set -a; source .env.prod; set +a` перед `npm run build` в `apps/web`/`apps/admin`.
- **`⚠ "next start" does not work with "output: standalone"`** — безобидное предупреждение в
  логах `trafficcrm-web`/`trafficcrm-admin`, известное и не мешающее реальной работе
  (оба приложения фактически стартуют и отвечают 200); `next.config.mjs` объявляет
  `output: 'standalone'` (для гипотетического Docker-деплоя), а реальный запуск идёт через
  обычный `next start`, не `node .next/standalone/server.js`. Не пытаться "исправить" без
  явного запроса — оба режима работают, это просто несовпадение конфигурации с командой
  запуска, не поломка.
- **`SESSION_ENCRYPTION_KEY` менять нельзя** — все уже сохранённые зашифрованные MTProto-сессии
  личных Telegram-аккаунтов (`Channel.tgSessionEncrypted`) станут нерасшифровываемыми,
  каждый подключённый личный аккаунт придётся переподключать заново.
- **Postgres/Redis/MinIO слушают только `127.0.0.1`** — это сознательное решение (не должны
  быть доступны из интернета), не "чинить" на `0.0.0.0` без явной причины.
- **`ffmpeg` не в Dockerfile/package.json** — если переносите/пересоздаёте сервер, легко
  забыть `apt-get install ffmpeg`; без него ломается обрезка видео под Telegram-"кружки".

## Где искать документацию дальше

- [00_MASTER_OVERVIEW.md](00_MASTER_OVERVIEW.md) — карта всех спек-документов, начинать отсюда.
- [15_PHASES.md](15_PHASES.md) — что реально готово, а что ещё в планах (источник истины).
- [14_INFRA_AND_DEPLOY.md](14_INFRA_AND_DEPLOY.md) — полная архитектурная спека
  (гипотетическая чистая Docker-схема) + блок "Реальный деплой 2026-06-29" вверху документа,
  описывающий именно то, что реально работает на этом сервере (то же самое, что и в этом файле,
  но подробнее по каждому куску).
- [CLAUDE.md](CLAUDE.md) — хронология того, что и почему менялось в проекте, для ИИ-агентов
  и как human-readable журнал решений.
