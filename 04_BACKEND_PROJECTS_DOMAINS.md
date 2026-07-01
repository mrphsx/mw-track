# 04 — Backend: Projects, Домены, Лендинги

> **Реальная архитектура отличается от черновика ниже**: проект больше НЕ хранит
> `fbPixelId`/`fbAccessToken`/`ttPixelId`/`ttAccessToken` напрямую — он не привязан
> к одной платформе. Вместо этого есть отдельная модель `TrackingPixel`
> (many-to-one к Project), и проект может иметь сколько угодно пикселей любых
> платформ одновременно (несколько FB-аккаунтов, FB+TikTok разом и т.д.), управляемых
> через `PixelsModule` (`POST/GET/PATCH/DELETE /pixels`). См. реальную схему в
> 02_DATABASE.md и реальный код в `apps/api/src/modules/pixels/`. Примеры
> с `dto.fbPixelId` и т.п. ниже — устаревший черновик, оставлен для истории.

## Projects Module

### Projects Service

```typescript
// modules/projects/projects.service.ts

@Injectable()
export class ProjectsService {
  
  async create(companyId: string, dto: CreateProjectDto): Promise<Project> {
    // SubscriptionGuard уже проверил лимит до вызова
    
    const project = await this.prisma.project.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        publicToken: nanoid(32),
        secretKey: `sk_live_${nanoid(48)}`,
        fbPixelId: dto.fbPixelId,
        fbAccessToken: dto.fbAccessToken,
        ttPixelId: dto.ttPixelId,
        ttAccessToken: dto.ttAccessToken,
        allowedDomains: dto.allowedDomains || [],
      }
    });
    
    // Обновить счётчик проектов
    await this.prisma.company.update({
      where: { id: companyId },
      data: { currentProjects: { increment: 1 } }
    });
    
    return project;
  }
  
  async findAll(companyId: string, userId: string, role: UserRole) {
    // OWNER и ADMIN видят все проекты компании
    if (['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      return this.prisma.project.findMany({
        where: { companyId, deletedAt: null },
        include: {
          channels: { select: { id: true, type: true, isActive: true } },
          _count: { select: { clients: true, pushes: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    }
    
    // ADVERTISER видит только назначенные проекты
    return this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        projectAccess: { some: { userId } }
      },
      include: {
        channels: { select: { id: true, type: true, isActive: true } },
        _count: { select: { clients: true, pushes: true } }
      },
    });
  }
  
  async findByPublicToken(publicToken: string): Promise<Project | null> {
    // Этот метод НЕ фильтрует по company_id (публичный)
    return this.prisma.$queryRaw`
      SELECT * FROM "Project" 
      WHERE "publicToken" = ${publicToken} 
      AND "deletedAt" IS NULL
      LIMIT 1
    `.then(rows => rows[0] || null);
  }
  
  async regenerateTokens(projectId: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        publicToken: nanoid(32),
        secretKey: `sk_live_${nanoid(48)}`,
      }
    });
  }
  
  async archive(projectId: string, companyId: string) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date(), status: 'ARCHIVED' }
    });
    
    await this.prisma.company.update({
      where: { id: companyId },
      data: { currentProjects: { decrement: 1 } }
    });
  }
}
```

### Projects Controller endpoints
```
GET    /api/v1/projects              — список проектов
POST   /api/v1/projects              — создать проект
GET    /api/v1/projects/:id          — детали проекта
PATCH  /api/v1/projects/:id          — обновить настройки
DELETE /api/v1/projects/:id          — архивировать
POST   /api/v1/projects/:id/tokens   — перегенерировать токены
GET    /api/v1/projects/:id/snippet  — получить HTML код для вставки
GET    /api/v1/projects/:id/overview — статистика для дашборда
```

### Snippet Endpoint (возвращает готовый код для вставки)

```typescript
@Get(':id/snippet')
async getSnippet(@Param('id') id: string) {
  const project = await this.projectsService.findOne(id);
  
  const snippet = `<!-- TrafficCRM Tracking -->
<script src="${process.env.CDN_URL}/track.js" 
        data-project-id="${project.publicToken}"
        async>
</script>`;

  const apiExample = `// Server-side (Node.js)
const { TrackClient } = require('@trafficcrm/sdk');

const track = new TrackClient({
  projectId: '${project.id}',
  secretKey: '${project.secretKey}',  // KEEP SECRET!
});

// Track purchase
await track.purchase(99.00, 'USD', {
  orderId: 'order_123',
  email: customer.email,
});`;

  return { snippet, apiExample, publicToken: project.publicToken };
}
```

---

## Domains Module — ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.2, 2026-06-28)

**Архитектурное решение (зафиксировано 2026-06-27, до начала кода): домены — self-service, без управления Cloudflare со стороны платформы.** Изначальный план этого шага ("Cloudflare + Домены (автоматические)") предполагал, что *платформа* держит Cloudflare API-токен и сама управляет DNS клиента — `CloudflareService.addDomain/verifyDomain`, `dto.useCloudflare`, `Domain.cfZoneId`/`cfRecordId`. Это отклонено: реалистично работает только как платный Cloudflare for SaaS/Enterprise reseller, и не то, что нужно — пользователь явно решил, что клиент сам покупает домен и сам управляет его DNS (в своём Cloudflare-аккаунте или у любого другого провайдера), а платформа только просит домен, показывает инструкцию и проверяет. `cfZoneId`/`cfRecordId` убраны из схемы (миграция `20260628000000_domain_drop_cloudflare_fields`), `CloudflareService` не существует и не нужен.

Реальная реализация: `apps/api/src/modules/domains/`. `NginxService` — общий с лендингами (`apps/api/src/modules/landings/nginx.service.ts`, шаг 1.9), не отдельный сервис, как было в исходном плане выше.

### Domains Service (реальный код, сокращённо)

```typescript
// modules/domains/domains.service.ts

@Injectable()
export class DomainsService {
  constructor(private prisma: PrismaService, private nginx: NginxService, private config: ConfigService) {}

  async create(companyId: string, dto: CreateDomainDto) {
    // domain.@unique в схеме сам бросит P2002 при коллизии — ловим и превращаем в ConflictException
    const domain = await this.prisma.domain.create({
      data: { companyId, domain: dto.domain.toLowerCase(), projectId: dto.projectId, landingId: dto.landingId },
    });
    return this.withInstructions(domain); // + { txtName, txtValue, aRecordTarget: SERVER_PUBLIC_IP }
  }

  async verify(id: string, companyId: string) {
    const domain = await this.findOneRaw(id, companyId);
    if (domain.status === 'ACTIVE') return this.withInstructions(domain); // уже всё проверено

    const txtOk = await this.checkTxtRecord(domain.domain, domain.verificationToken); // dns.resolveTxt(`_verify.${domain}`)
    if (!txtOk) return /* status: PENDING, lastCheckError: 'TXT-запись не найдена или не совпадает' */;

    await this.prisma.domain.update({ where: { id }, data: { status: 'VERIFYING', verifiedAt: domain.verifiedAt ?? new Date() } });

    try {
      // Системный nginx (этот сервер не выделенный — 80/443 уже заняты другими сайтами,
      // поэтому это server_name-блок системного /etc/nginx, не dockerized). Должен
      // существовать ДО certbot — иначе `certbot --nginx` не найдёт, что дополнять.
      await this.nginx.addServerBlock(domain.domain, domain.landingId);
    } catch (error) {
      return /* status: PENDING, sslStatus: 'error', lastCheckError: `Nginx: ${error.message}` */;
    }

    try {
      // Системный certbot, HTTP-01 через --nginx authenticator+installer (тот же бинарь
      // и способ, которым на этом сервере уже выпущены сертификаты для других доменов).
      // Если A/CNAME не указывает на нас — challenge не пройдёт, ошибка попадёт в catch.
      // Этим же шагом доказывается реальная маршрутизация трафика, отдельной проверки A-записи не нужно.
      await this.issueCertificate(domain.domain); // certbot --nginx -d ... -d www.... --redirect
    } catch (error) {
      return /* status: PENDING, sslStatus: 'error', lastCheckError: `Certbot: ${error.message}` */;
    }

    return this.prisma.domain.update({ where: { id }, data: { status: 'ACTIVE', sslStatus: 'active', lastCheckError: null } });
  }

  // Привязать/отвязать лендинг к уже верифицированному домену
  async attachLanding(id: string, companyId: string, landingId: string | null) {
    const domain = await this.findOneRaw(id, companyId);
    if (domain.status === 'ACTIVE') {
      landingId ? await this.nginx.addServerBlock(domain.domain, landingId) : await this.nginx.removeServerBlock(domain.domain);
    }
    return this.prisma.domain.update({ where: { id }, data: { landingId } });
  }

  // Без deletedAt-колонки на Domain (как и у Channel, см. CLAUDE.md) — hostname глобально
  // @unique, soft-delete заблокировал бы повторное добавление того же домена.
  async remove(id: string, companyId: string) {
    const domain = await this.findOneRaw(id, companyId);
    await this.nginx.removeServerBlock(domain.domain).catch(() => {});
    await this.prisma.domain.delete({ where: { id } });
  }
}
```

**Что проверено живым тестом (2026-06-28):**
- `POST /domains` создаёт домен с `verificationToken`, реальные инструкции (`_verify.<domain>` + значение).
- `POST /domains/:id/verify` без реальной TXT-записи → реальный `dns.resolveTxt` lookup (подтверждено, что исходящий DNS работает из этой среды), корректный `lastCheckError`, статус остаётся `PENDING` (retryable, не залипает).
- Путь после успешного TXT (реальный вызов Certbot через `docker compose run certbot`) **не проверен живьём** — это реальный сетевой запрос к Let's Encrypt, auto-mode классификатор пометил его как "DNS/Domain/Cert Changes" и потребовал отдельного разрешения; пользователь предпочёл пропустить тест (тестовый домен гарантированно не прошёл бы challenge — DNS не указывает на эту песочницу), а не разрешать реальный запрос к внешнему CA без надобности.
- Найден и исправлен попутный баг инфраструктуры: общий tenant-scoping `$use`-middleware в `PrismaService` включал `Domain` в список моделей с авто-инъекцией `deletedAt: null`, хотя у `Domain` (как и у `Channel`) нет такой колонки — любой `findMany`/`findFirst` падал с `Unknown argument`. Поправлено по образцу `Channel`: `Domain` убран из `modelsWithCompany`, `DomainsService` сам явно фильтрует по `companyId`.

### Реальный баг от пользователя — Certbot никогда не мог выпустить сертификат (2026-06-28 → 29)

Пользователь подключил реальный домен (`eby-latam.shop`), TXT прошёл, но verify зависал на `error`: `open /var/www/trafficcrm/apps/api/docker-compose.prod.yml: no such file or directory`. Расследование (2026-06-28) нашло и исправило два реальных бага в исходной docker-based реализации (`nest start --watch`/`dist/main` всегда запускаются с `cwd=apps/api`, не с корня репозитория, где реально лежит `docker-compose.prod.yml`; плюс отдельный сервис `certbot` в этом compose-файле имел `entrypoint`, переопределённый на бесконечный цикл `certbot renew`, из-за чего `docker compose run --rm certbot certonly ...` без `--entrypoint certbot` молча игнорировал команду `certonly` и просто зависал в этом цикле, **никогда не выпуская сертификат**, даже после фикса пути).

Но довести этот путь до реального выпущенного сертификата всё равно не удалось: сервер, на котором развёрнут TrafficCRM, **не выделенный** — на нём уже годами работает системный nginx, который держит порты 80/443 для других, не относящихся к TrafficCRM сайтов (`eby-latam.shop` сам по себе уже существует как ЧУЖОЙ сайт на этом хосте, `rprtsltm.site`). Поднять второй (dockerized) nginx на тех же портах физически невозможно — порт уже занят. Вся docker-based схема (`docker-compose.prod.yml`'s `nginx`+`certbot` сервисы, `infra/nginx/sites/DOMAIN.conf`) предполагала, что наш собственный dockerized nginx владеет 80/443 — на этом сервере это никогда не было правдой.

**Решение (2026-06-29): убрать промежуточный Docker-слой полностью, использовать тот же системный nginx + системный certbot, которым этот сервер уже выпускает сертификаты для других проектов.** `docker-compose.prod.yml` больше не содержит сервисов `nginx`/`certbot` (см. `14_INFRA_AND_DEPLOY.md`, раздел "Реальный деплой 2026-06-29"). Переписаны:

- **`NginxService`** (`apps/api/src/modules/landings/nginx.service.ts`): `sitesDir` по умолчанию — `/etc/nginx/sites-enabled` (реальный системный путь, не `infra/nginx/sites` внутри какого-либо контейнера). Файл сайта разбит на два: внешний `sites-enabled/<домен>` (только `listen 80`/`server_name`/`include`, пишется **один раз** — после первого `certbot --nginx` этот файл больше не "наш", certbot сам дописывает в него `ssl_certificate`/`listen 443`/редирект, поэтому `addServerBlock` никогда не перезатирает его повторно, только создаёт при отсутствии) + `trafficcrm-targets/<домен>.conf` (только `location /` с реальным `proxy_pass` на лендинг — этот файл certbot не трогает вообще, поэтому `attachLanding` свободно перезаписывает его при каждой смене лендинга без риска стереть выпущенный сертификат). `reload()` теперь `nginx -t` (обязательная проверка синтаксиса — на этом nginx висят чужие живые сайты, ошибку нельзя проглатывать молча, как раньше в dev-варианте) + `systemctl reload nginx`, без Docker.
- **`DomainsService.issueCertificate`**: `certbot --nginx -d <домен> -d www.<домен> --email ... --agree-tos -n --redirect` — системный бинарь, без `docker compose`, без webroot-тома. `--nginx` находит блок, который `NginxService.addServerBlock` только что создал (по `server_name`), сам дополняет его SSL-директивами и сам перезагружает nginx — нам не нужно делать `reload()` повторно после выпуска.
- **`DomainsService.verify()`**: порядок шагов поменян — теперь `addServerBlock` (создаёт пустой HTTP-блок под домен) вызывается **до** `issueCertificate`, не после. Раньше было наоборот (cert → потом nginx-блок при наличии лендинга) — это никогда не могло сработать с `certbot --nginx`, плагину нужен existing server_name-блок ещё до HTTP-01 challenge.
- Удалён `apps/api/src/common/repo-root.ts` (был добавлен 2026-06-28 для docker-based фикса, стал не нужен — система больше не вызывает `docker compose` вообще, нет relative-path проблемы, которую он решал).

### Живой тест системного nginx/certbot-механизма + третий найденный баг (2026-06-29, после перезапуска api)

После того как сервер освободился, api/web были пересобраны и перезапущены как обычные процессы (не Docker), MinIO поднят (`docker compose up -d`), всем трём dev-контейнерам (`docker-compose.yml`) добавлен `restart: unless-stopped` — раньше без него `minio` после OOM-убийства ядром так и остался лежать часами, не поднявшись сам.

Реальный verify() на `eby-latam.shop` воспроизвёл именно тот сценарий, который описан в "Реальный баг" выше как непроверенный, и нашёл **третий баг**, на этот раз не инфраструктурный, а в самой логике `NginxService`: `eby-latam.shop` на этом сервере — домен **другого, не относящегося к TrafficCRM проекта** (его server_name живёт внутри `/etc/nginx/sites-available/default`, с уже выпущенным сертификатом только на `eby-latam.shop`, без `www`). `addServerBlock` не проверял, не занят ли `server_name` уже каким-то другим, существующим конфигом nginx — просто создал новый файл `sites-enabled/eby-latam.shop` с `server_name eby-latam.shop www.eby-latam.shop`. Nginx, увидев второй блок с тем же именем, **молча его игнорирует** (`conflicting server name "eby-latam.shop" ... ignored`) — наш блок никогда не обслуживал бы трафик. А `certbot --nginx -d eby-latam.shop -d www.eby-latam.shop` затем наткнулся на уже существующий сертификат с другим набором имён и отказался без `--expand` (именно эта ошибка и была показана пользователю: "It contains these names: eby-latam.shop. You requested ... eby-latam.shop, www.eby-latam.shop. ... --expand flag").

**Исправлено**: новый `NginxService.assertNoConflictingServerName(domain)` — перед первым созданием site-файла парсит `nginx -T` и ищет домен в любой существующей `server_name`-директиве (regex с границей слова, не только в файлах TrafficCRM); если конфликт найден — бросает понятную ошибку вместо тихого создания игнорируемого блока. Вызывается только при создании файла впервые (не на повторных `verify()`/`attachLanding()` для уже добавленных TrafficCRM доменов, иначе свой же ранее написанный файл засчитался бы как "конфликт").

Тестовые файлы (`sites-enabled/eby-latam.shop`, `trafficcrm-targets/eby-latam.shop.conf`), оставшиеся от старого (до-фикса) прогона, удалены, `nginx -t`/`systemctl reload nginx` подтвердили отсутствие warning. Настоящий конфиг чужого проекта (`sites-available/default`) не тронут.

**Живым тестом подтверждено**: повторный вызов `DomainsService.verify()` на той же записи `eby-latam.shop` теперь падает на шаге `addServerBlock` (не на Certbot) с чётким `lastCheckError`: `Nginx: Домен eby-latam.shop уже обслуживается другим server_name-блоком в nginx на этом сервере — добавить его через TrafficCRM нельзя без ручного вмешательства в существующий конфиг`. `nginx -t` после теста — чисто, без новых файлов.

### Уточнение: eby-latam.shop — свой домен пользователя, не чужой проект (2026-06-29)

Проверка показала, что вышеописанное "другой проект" было неверным предположением: `eby-latam.shop` реально резолвится через Cloudflare на IP **этого же** сервера (`SERVER_PUBLIC_IP`), сертификат настоящий и валидный — просто старый блок в `sites-available/default` отдавал только дефолтную заглушку Ubuntu (`/var/www/html`), а не контент TrafficCRM. Это домен пользователя, ранее не подключённый ни к чему конкретному. С подтверждения пользователя старые блоки `server_name eby-latam.shop` убраны из `default` (бэкап — `sites-available/default.bak-2026-06-29`), домен отдан под TrafficCRM.

После этого вскрылся **четвёртый баг**: повторный `certbot --nginx -d eby-latam.shop -d www.eby-latam.shop` теперь падал на `"Some challenges have failed"` — нет, не нужен был `--expand` (это была реакция на старый блок выше) — на самом деле `--expand` всё равно нужен в общем случае (certbot матчит запрошенные имена с уже существующими сертификатами по имени лезеренного *lineage* в `/etc/letsencrypt/renewal/`, независимо от текущего nginx-конфига — добавлен в `issueCertificate` навсегда), а конкретно эта ошибка — DNS `NXDOMAIN` для `www.eby-latam.shop`: пользователь добавил A-запись только на голый домен, без `www`. Let's Encrypt не может выпустить сертификат на имя, для которого нет DNS вообще.

**Исправлено два места:**
- `DomainsService.issueCertificate` — добавлен флаг `--expand` навсегда (не специфично для этого домена — общий случай "домен уже когда-то был привязан к сертификату с другим набором имён").
- UI (`apps/web/src/app/(dashboard)/domains/page.tsx`) — инструкция теперь говорит "три записи" и явно показывает отдельную строку A-записи на `www.<домен>` (раньше показывались только TXT + A на голый домен — клиент физически не мог узнать из UI, что `www` тоже обязателен, пока не наткнётся на точно такую же ошибку).

**Полный успешный выпуск сертификата всё ещё не проверен живьём** — ждём, когда пользователь добавит A-запись на `www.eby-latam.shop` в Cloudflare.

### Полный успех + два реальных бага в цепочке "домен → лендинг → клик в Telegram" (2026-06-29)

Пользователь сам добавил и верифицировал другой домен, `jcywkdake.shop`, с обеими A-записями сразу — первый полностью успешный выпуск сертификата через переписанный механизм (`/etc/nginx/sites-enabled/jcywkdake.shop` содержит наш `include .../trafficcrm-targets/jcywkdake.shop.conf`, сертификат реальный). После этого вскрылись два дальнейших разрыва в цепочке "домен активен → лендинг работает → клик ведёт в Telegram":

1. **На `/domains` не было способа привязать лендинг к домену** — колонка "Лендинг" только показывала `d.landingId` как текст, хотя `PATCH /domains/:id/landing` существовал с 2026-06-28. Добавлен `Select` со всеми лендингами компании (не только из одного проекта — `Domain.projectId` опционален, форма создания домена его даже не запрашивает, а `attachLanding` проверяет владение только по `companyId`).
2. **После привязки клик "Вступить" не вёл в Telegram** — не баг конкретно перехода, а `helmet()` в `main.ts` ставит на все ответы API `Content-Security-Policy: script-src 'self'` по умолчанию, что молча блокирует `track.js` (грузится с другого origin — `CDN_URL`). Без `track.js` SDK-обработчик клика (`apps/sdk/src/browser.ts`, который делает `preventDefault()` + асинхронно генерирует свежий `start`-код + открывает Telegram в новой вкладке) не навешивался — переход всё же происходил через обычный `<a href>`, но вся аналитика (`PageView`/`Lead`, пиксели) молча не работала. Исправлено: `LandingRendererService` снимает `Content-Security-Policy` только с HTML-ответов лендингов (`res.removeHeader(...)`), остальной JSON API CSP не трогает. Заодно поправлен `CDN_URL` (`http://localhost:9000` → mixed-content на HTTPS-лендингах) — теперь проксируется через `https://api.<домен>/cdn/` на том же, уже выпущенном сертификате.

**Живым тестом через Playwright на реальном `jcywkdake.shop` подтверждено**: `track.js` грузится без единой ошибки в консоли, клик открывает новую вкладку `https://t.me/<bot>?start=<свежий код>`, `PageView`+`Lead` реально долетают до таблицы `TrackingEvent`.

**Не реализовано / не нужно**: `CloudflareService`, `useCloudflare`, управление DNS клиента с нашей стороны — отклонено архитектурным решением выше.

### Один домен → много лендингов/проектов через путь (2026-06-29)

Пользователь явно запросил: "один домен на несколько проектов и несколько лэндов используя /path/path", удобный UI без длинного дропдауна при большом числе проектов, превью полной ссылки по клику на домен, и чтобы голый домен без пути никуда не вёл.

**Схема**: `Domain.landingId` (прямая связь 1 домен = 1 лендинг) заменена на модель `DomainPath` (`domainId`, `path`, `landingId`, `@@unique([domainId, path])`). Миграция `20260629190000_domain_paths` — применена на живой базе **с явным подтверждением пользователя** (см. `AskUserQuestion`, это DROP COLUMN, необратимо без восстановления из дампа; перед применением сделан `pg_dump` в `backups/pre-domainpath-2026-06-29.sql`). Существующие `Domain.landingId` перенесены в `DomainPath` с `path: "/"` — уже активные домены не отвалились.

**Архитектурное упрощение nginx**: раньше `NginxService.addServerBlock(domain, landingId)` переписывал target-файл (`proxy_pass .../serve-landing/<landingId>`) на каждый `attachLanding()`. Теперь target-файл **домен-агностичен** — всегда `proxy_pass http://127.0.0.1:3001/api/v1/internal/serve-by-domain$request_uri`, пишется один раз (и безусловно перезаписывается при каждом `addServerBlock`, чтобы домены со старым форматом таргета мигрировали на новый). Это значит: добавление/смена/удаление путей — **чистая операция с БД**, без nginx reload и без касания Certbot вообще (раньше смена привязки лендинга тоже трогала nginx).

**Резолвинг запроса** — `InternalController.serveByDomain(Root|Asset)` (новые роуты, по аналогии с уже существующими `serve-landing/:landingId(/*)?`) передают `Host`-заголовок + полный путь в `LandingRendererService.renderByDomain()`, который ищет `Domain` по hostname (без `www.` — один `Domain` обслуживает и голый, и www) со статусом `ACTIVE`, затем матчит путь против всех `DomainPath` этого домена через `matchDomainPath()` (`apps/api/src/modules/domains/domain-path.util.ts` — чистые функции без DI, вынесены из `DomainsService` специально: `DomainsModule` уже импортирует `LandingsModule` за `NginxService`, обратный импорт создал бы циклическую зависимость модулей).

**Семантика матчинга**: путь `/` — особый случай, матчит ЛЮБОЙ путь, не закрытый более специфичным маппингом (сохраняет старое поведение `Domain.landingId` — единая привязка на весь домен, включая собственные суб-пути CUSTOM-лендингов типа `/style.css`); остальные пути матчят только себя и всё, что начинается с `"<path>/"`, более длинные (специфичные) пути проверяются первыми. **Голый домен без единого настроенного пути (включая `/`) отдаёт 404** — раньше `Domain.landingId` неявно отдавал контент на корне для любого подключённого домена.

**API**: `PATCH /domains/:id/landing` (`AttachLandingDto`) удалён целиком, заменён на `GET/POST /domains/:id/paths` + `DELETE /domains/:id/paths/:pathId` (`UpsertDomainPathDto` — один эндпоинт на create/update через `prisma.domainPath.upsert`). Ответы `findAll`/`listPaths`/`upsertPath` сразу включают `landing.project.{id,name}` — фронту не нужен отдельный запрос только чтобы показать подпись пути.

**UI** (`apps/web/src/app/(dashboard)/domains/page.tsx`) — полностью переписан:
- Клик на сам домен (или кнопка "Пути") открывает `DomainPathsDialog`: список существующих путей с **реальной кликабельной полной ссылкой** (`https://domain.com/promo1`, `target="_blank"`) + подписью "Проект — Лендинг", и форма добавления нового пути.
- Выбор лендинга для нового пути — **каскадный** (сначала короткий список проектов, потом лендинги только выбранного проекта), а не один плоский список всех лендингов компании — именно то, что запрошено для случая "много проектов".
- В самой таблице доменов добавлена колонка "Пути" с превью первых 2 путей (мини-ссылки) и "+N ещё" — не обязательно открывать диалог, чтобы увидеть, что куда ведёт.

**Проверено живьём**: после деплоя нового кода target-файл `jcywkdake.shop` (единственный существовавший на тот момент с захардкоженным `serve-landing/<id>`) перегенерирован вызовом `NginxService.addServerBlock('jcywkdake.shop')` напрямую — regression-тест подтвердил, что домен продолжает отдавать тот же лендинг на корне (`200`, тот же `track.js`/deep-link), уже через новый механизм `DomainPath` (path=`/`, перенесённый миграцией). Логика `matchDomainPath`/`normalizeDomainPath` проверена изолированным запуском на синтетических случаях (точное совпадение, суб-путь, несколько путей, путь `/` как фоллбэк, отсутствие маппинга → `null`) — **этим же тестом найден и сразу исправлен реальный баг**: `normalizeDomainPath('//promo1//')` возвращал `'//promo1'` вместо `'/promo1'` (схлопывание повторных слешей применялось после, а не до проверки ведущего слеша). TS-компиляция и ESLint — чисто на api+web.

---

## Landings Module

### Landing Renderer Service

```typescript
// modules/landings/renderer.service.ts

@Injectable()
export class LandingRendererService {
  
  // Выдать HTML лендинга с инжектированными пикселями
  async renderLanding(landingId: string, req: Request): Promise<string> {
    const landing = await this.prisma.landing.findUnique({
      where: { id: landingId },
      include: { project: true }
    });
    
    let html: string;
    
    if (landing.type === 'TEMPLATE') {
      html = await this.renderTemplate(landing);
    } else if (landing.type === 'CUSTOM') {
      html = await this.loadCustomLanding(landing);
    } else {
      throw new Error('External landings are served by client');
    }
    
    // Инжектировать трекинг скрипты
    html = this.injectTracking(html, landing.project);
    
    return html;
  }
  
  private injectTracking(html: string, project: Project): string {
    const trackingScript = `
<script>
  // TrafficCRM Auto-Tracking
  (function() {
    var urlParams = new URLSearchParams(window.location.search);
    var data = {
      fbclid: urlParams.get('fbclid'),
      ttclid: urlParams.get('ttclid'),
      utmSource: urlParams.get('utm_source'),
      utmCampaign: urlParams.get('utm_campaign'),
    };
    
    fetch('${process.env.API_URL}/api/v1/track/${project.publicToken}/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'PageView', pageUrl: window.location.href, ...data })
    });
    
    window._tcrm_token = '${project.publicToken}';
    window._tcrm_data = data;
  })();
</script>
${project.fbPixelId ? `
<!-- Facebook Pixel (Browser) -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${project.fbPixelId}');
  fbq('track', 'PageView');
</script>` : ''}
${project.ttPixelId ? `
<!-- TikTok Pixel (Browser) -->
<script>
  !function (w, d, t) {
    w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
    ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
    ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
    for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
    ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
    ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    ttq.load('${project.ttPixelId}');
    ttq.page();
  }(window, document, 'ttq');
</script>` : ''}`;
    
    // Вставить перед закрывающим </head>
    return html.replace('</head>', `${trackingScript}\n</head>`);
  }
  
  // Серверный роут для отдачи лендинга
  // GET /internal/serve-landing/:landingId
  async serveLanding(landingId: string, req: Request, res: Response) {
    const html = await this.renderLanding(landingId, req);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
```

### Шаблоны лендингов

Создай папку `apps/api/src/modules/landings/templates/`:

```
templates/
├── minimal/          — минималистичный
│   ├── template.html
│   └── preview.jpg
├── gradient/         — яркий градиентный
│   ├── template.html
│   └── preview.jpg
└── dark/             — тёмная тема
    ├── template.html
    └── preview.jpg
```

Каждый `template.html` содержит плейсхолдеры:
```html
<!-- {{CHANNEL_TITLE}} - название канала -->
<!-- {{CHANNEL_DESCRIPTION}} - описание -->
<!-- {{CHANNEL_AVATAR}} - аватар канала -->
<!-- {{SUBSCRIBERS_COUNT}} - количество подписчиков -->
<!-- {{JOIN_BUTTON_TEXT}} - текст кнопки -->
<!-- {{BOT_USERNAME}} - @username бота для deep link -->
<!-- {{PRIMARY_COLOR}} - основной цвет -->
```

### Upload кастомного лендинга — ✅ РЕАЛИЗОВАНО (Фаза 2, шаг 2.3, 2026-06-28)

Реальная реализация: `StorageService` (`apps/api/src/modules/landings/storage.service.ts`, MinIO-клиент,
бакет приватный — кастомные лендинги отдаются не напрямую из MinIO, а проксируются через тот же
`InternalController`, что и TEMPLATE), `LandingsService.processZipUpload` (используется и из
`createCustom` — новый лендинг сразу из ZIP, и из `uploadCustomLanding` — ре-загрузка в существующий).

Два отличия от псевдокода выше:
- **Защита от zip-slip** не только встроенной в `adm-zip` (>=0.5.2) проверкой, но и явным
  перебором `zip.getEntries()` на `..`/абсолютные пути — не доверяем единственному слою защиты
  при работе с файлом, загруженным произвольным пользователем.
- **Ре-загрузка подчищает старые файлы** (`storage.removePrefix` перед `uploadDirectory`) — иначе
  файлы, отсутствующие в новом архиве, остались бы висеть в бакете и отдавались по старым путям.

```typescript
private async processZipUpload(landing: Landing, file: Express.Multer.File): Promise<Landing> {
  if (!file.originalname.toLowerCase().endsWith('.zip') && file.mimetype !== 'application/zip') {
    throw new BadRequestException('Только ZIP-файлы');
  }
  if (file.size > MAX_ZIP_SIZE) throw new BadRequestException('Максимальный размер ZIP — 50MB');

  const zip = new AdmZip(file.buffer);

  for (const entry of zip.getEntries()) {
    if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
      throw new BadRequestException('Архив содержит недопустимые пути');
    }
  }
  if (!zip.getEntries().some((e) => e.entryName.toLowerCase() === 'index.html')) {
    throw new BadRequestException('ZIP должен содержать index.html в корне архива');
  }

  const extractPath = path.join('/tmp', `landing-${landing.id}-${Date.now()}`);
  try {
    zip.extractAllTo(extractPath, true);
    const basePath = `landings/${landing.id}`;
    await this.storage.removePrefix(basePath); // подчистить файлы прошлой загрузки
    await this.storage.uploadDirectory(extractPath, basePath);
    return this.prisma.landing.update({
      where: { id: landing.id },
      data: { type: 'CUSTOM', customBasePath: basePath, templateId: null, templateData: Prisma.JsonNull },
    });
  } finally {
    await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
  }
}
```

**Отдача CUSTOM-лендингов — отдельная задача от загрузки.** TEMPLATE — всегда одна страница, но
CUSTOM состоит из нескольких файлов (`index.html` + css/js/картинки), поэтому:
- `NginxService.renderConfig` пробрасывает реальный путь запроса: `proxy_pass
  http://api:3001/api/v1/internal/serve-landing/${landingId}$request_uri;` (раньше игнорировал
  всё кроме `landingId`).
- `InternalController` получил второй маршрут с wildcard, `serve-landing/:landingId/*`
  (под-путь — в Express `req.params['0']`), плюс уже существовавший `serve-landing/:landingId` для корня.
- `LandingRendererService.renderAndServe(landingId, subPath, req, res)` — для CUSTOM при пустом
  `subPath`/`index.html` отдаёт `index.html` с инжектом трекинга (как у TEMPLATE), для остальных
  путей — стримит файл из MinIO как есть с `Content-Type` по расширению (`res.type()`).
- `renderPreviewHtml` для CUSTOM отдаёт raw `index.html` без инжекта (так же ведёт себя и
  TEMPLATE-предпросмотр — инжект трекинга только при реальной отдаче посетителю).

**Что проверено живым тестом (2026-06-28):** ZIP с `index.html` + `style.css` + `img/logo.png` →
`POST /projects/:id/landings/custom` реально загрузил все 3 файла в MinIO с правильной структурой
(проверено напрямую через `docker exec` в контейнер MinIO); после `publish` —
`GET /internal/serve-landing/:id` вернул `index.html` с инжектированным тег `<script src=".../track.js">`,
`GET .../style.css` и `GET .../img/logo.png` вернули 200 с верным `Content-Type`
(`text/css`/`image/png`), несуществующий путь — 404; ре-загрузка нового ZIP (без `style.css`)
корректно удалила старый файл (стал 404) и заменила `index.html`; ZIP без `index.html` и не-ZIP файл
— оба отклонены `BadRequestException`; ZIP с путём `../../../tmp/evil.txt` — отклонён до распаковки
(файл не попал на диск, проверено через `ls`).

### Domains Controller endpoints
```
GET    /api/v1/domains              — список доменов компании
POST   /api/v1/domains              — добавить домен
GET    /api/v1/domains/:id          — статус домена
POST   /api/v1/domains/:id/verify   — проверить DNS верификацию
POST   /api/v1/domains/:id/landing  — привязать лендинг
DELETE /api/v1/domains/:id          — удалить домен

GET    /api/v1/projects/:projectId/landings        — список лендингов проекта
POST   /api/v1/projects/:projectId/landings        — создать из шаблона
POST   /api/v1/projects/:projectId/landings/custom  — создать CUSTOM сразу из ZIP (multipart: name + file)
GET    /api/v1/landings/templates    — доступные шаблоны
GET    /api/v1/landings/:id          — детали лендинга
PATCH  /api/v1/landings/:id          — обновить настройки шаблона
POST   /api/v1/landings/:id/upload   — перезалить ZIP в существующий лендинг (multipart: file)
POST   /api/v1/landings/:id/publish  — опубликовать
POST   /api/v1/landings/:id/unpublish — снять с публикации
GET    /api/v1/landings/:id/preview  — предпросмотр HTML (TEMPLATE/CUSTOM)
DELETE /api/v1/landings/:id          — архивировать (soft delete)
```

### Analytics Service (базовые запросы)

```typescript
// modules/analytics/analytics.service.ts

async getProjectOverview(projectId: string, days = 30) {
  const since = subDays(new Date(), days);
  
  const [
    totalClients,
    newClients,
    totalRevenue,
    eventsCounts,
  ] = await Promise.all([
    
    this.prisma.client.count({ where: { projectId } }),
    
    this.prisma.client.count({
      where: { projectId, createdAt: { gte: since } }
    }),
    
    this.prisma.purchase.aggregate({
      where: { projectId },
      _sum: { amount: true }
    }),
    
    // События по дням (для графика)
    this.prisma.$queryRaw`
      SELECT 
        DATE("eventTime") as date,
        "eventName",
        COUNT(*) as count
      FROM "TrackingEvent"
      WHERE "projectId" = ${projectId}
        AND "eventTime" >= ${since}
      GROUP BY DATE("eventTime"), "eventName"
      ORDER BY date ASC
    `,
  ]);
  
  return {
    totalClients,
    newClients,
    totalRevenue: totalRevenue._sum.amount || 0,
    eventsByDay: eventsCounts,
  };
}

async getChannelBreakdown(projectId: string) {
  return this.prisma.client.groupBy({
    by: ['channelType'],
    where: { projectId },
    _count: true,
  });
}
```
