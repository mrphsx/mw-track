# 07 — Лендинг Билдер: Шаблоны, Кастомные, Внешние

> **Реальная архитектура отличается от черновика ниже**: `project.fbPixelId`/
> `project.ttPixelId` больше не существуют. `LandingRendererService.injectTrackingScripts`
> читает `project.pixels` (активные `TrackingPixel`, любых платформ, в любом
> количестве) и инжектит ОДИН `fbq('init', ...)` на каждый FB-пиксель + один общий
> `fbq('track','PageView',...)`, и аналогично `ttq.load(...)` на каждый TikTok-пиксель
> + один общий `ttq.page()`. См. реальный код в `landing-renderer.service.ts`.

## Задача для Claude Code
Реализуй полную систему лендингов: встроенные шаблоны с редактором, загрузка ZIP, отдача HTML с инжектированными пикселями.

---

## Структура шаблонов

Создай папку `apps/api/src/modules/landings/templates/` с тремя шаблонами.

### Шаблон 1: Minimal

```html
<!-- templates/minimal/template.html -->
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{META_TITLE}}</title>
  <meta name="description" content="{{META_DESCRIPTION}}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: {{BG_COLOR}};
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 40px rgba(0,0,0,0.08);
    }
    .avatar {
      width: 80px; height: 80px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto 20px;
      display: block;
    }
    .avatar-placeholder {
      width: 80px; height: 80px;
      border-radius: 50%;
      background: {{PRIMARY_COLOR}};
      margin: 0 auto 20px;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 32px; font-weight: bold;
    }
    h1 { font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 12px; }
    p { font-size: 15px; color: #666; line-height: 1.6; margin-bottom: 8px; }
    .subscribers {
      display: inline-flex; align-items: center; gap: 6px;
      background: #f5f5f5; border-radius: 20px;
      padding: 6px 14px; font-size: 13px; color: #888;
      margin-bottom: 32px;
    }
    .btn {
      display: block; width: 100%;
      background: {{PRIMARY_COLOR}};
      color: white; border: none; border-radius: 14px;
      padding: 16px 24px;
      font-size: 16px; font-weight: 600;
      cursor: pointer; text-decoration: none;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .privacy { font-size: 12px; color: #bbb; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    {{#if CHANNEL_AVATAR}}
    <img src="{{CHANNEL_AVATAR}}" alt="{{CHANNEL_TITLE}}" class="avatar">
    {{else}}
    <div class="avatar-placeholder">{{CHANNEL_INITIAL}}</div>
    {{/if}}
    
    <h1>{{CHANNEL_TITLE}}</h1>
    <p>{{CHANNEL_DESCRIPTION}}</p>
    
    {{#if SUBSCRIBERS_COUNT}}
    <div class="subscribers">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      {{SUBSCRIBERS_COUNT}} подписчиков
    </div>
    {{/if}}
    
    <a href="https://t.me/{{BOT_USERNAME}}?start={{START_CODE}}" 
       class="btn"
       data-track="Lead"
       data-tg-bot="{{BOT_USERNAME}}">
      {{JOIN_BUTTON_TEXT}}
    </a>
    
    <p class="privacy">Нажимая кнопку, вы соглашаетесь с условиями использования</p>
  </div>
  
  <!-- TRACKING_PLACEHOLDER -->
</body>
</html>
```

### Шаблон 2: Gradient (яркий)

```html
<!-- templates/gradient/template.html -->
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{META_TITLE}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, {{GRADIENT_FROM}} 0%, {{GRADIENT_TO}} 100%);
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .container { max-width: 460px; width: 100%; text-align: center; }
    .avatar {
      width: 100px; height: 100px; border-radius: 50%;
      border: 4px solid rgba(255,255,255,0.5);
      object-fit: cover; margin: 0 auto 24px; display: block;
    }
    h1 { color: white; font-size: 28px; font-weight: 800; margin-bottom: 16px; text-shadow: 0 2px 10px rgba(0,0,0,0.2); }
    p { color: rgba(255,255,255,0.85); font-size: 16px; line-height: 1.6; margin-bottom: 32px; }
    .stats {
      display: flex; justify-content: center; gap: 32px; margin-bottom: 36px;
    }
    .stat { color: white; }
    .stat-value { font-size: 24px; font-weight: 700; }
    .stat-label { font-size: 12px; opacity: 0.7; margin-top: 2px; }
    .btn {
      display: inline-block;
      background: white;
      color: {{GRADIENT_FROM}};
      border-radius: 50px;
      padding: 18px 48px;
      font-size: 17px; font-weight: 700;
      text-decoration: none;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(0,0,0,0.25); }
  </style>
</head>
<body>
  <div class="container">
    {{#if CHANNEL_AVATAR}}
    <img src="{{CHANNEL_AVATAR}}" alt="" class="avatar">
    {{/if}}
    
    <h1>{{CHANNEL_TITLE}}</h1>
    <p>{{CHANNEL_DESCRIPTION}}</p>
    
    {{#if SUBSCRIBERS_COUNT}}
    <div class="stats">
      <div class="stat">
        <div class="stat-value">{{SUBSCRIBERS_COUNT}}</div>
        <div class="stat-label">подписчиков</div>
      </div>
    </div>
    {{/if}}
    
    <a href="https://t.me/{{BOT_USERNAME}}?start={{START_CODE}}"
       class="btn"
       data-track="Lead"
       data-tg-bot="{{BOT_USERNAME}}">
      {{JOIN_BUTTON_TEXT}}
    </a>
  </div>
  
  <!-- TRACKING_PLACEHOLDER -->
</body>
</html>
```

### Шаблон 3: Dark

```html
<!-- templates/dark/template.html -->
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{META_TITLE}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d0d0d;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 20px;
      padding: 48px 40px;
      max-width: 420px; width: 100%;
      text-align: center;
    }
    .badge {
      display: inline-block;
      background: {{PRIMARY_COLOR}}22;
      color: {{PRIMARY_COLOR}};
      border: 1px solid {{PRIMARY_COLOR}}44;
      border-radius: 20px;
      padding: 4px 14px; font-size: 12px; font-weight: 600;
      margin-bottom: 20px; letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .avatar {
      width: 72px; height: 72px; border-radius: 50%;
      border: 2px solid {{PRIMARY_COLOR}};
      object-fit: cover; margin: 0 auto 20px; display: block;
    }
    h1 { color: white; font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; line-height: 1.7; margin-bottom: 28px; }
    .btn {
      display: block; width: 100%;
      background: {{PRIMARY_COLOR}};
      color: white; border: none; border-radius: 12px;
      padding: 15px 24px;
      font-size: 15px; font-weight: 600;
      cursor: pointer; text-decoration: none;
    }
    .divider { height: 1px; background: #2a2a2a; margin: 24px 0; }
    .footer { color: #444; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Закрытый канал</div>
    
    {{#if CHANNEL_AVATAR}}
    <img src="{{CHANNEL_AVATAR}}" alt="" class="avatar">
    {{/if}}
    
    <h1>{{CHANNEL_TITLE}}</h1>
    <p>{{CHANNEL_DESCRIPTION}}</p>
    
    <a href="https://t.me/{{BOT_USERNAME}}?start={{START_CODE}}"
       class="btn"
       data-track="Lead"
       data-tg-bot="{{BOT_USERNAME}}">
      {{JOIN_BUTTON_TEXT}}
    </a>
    
    <div class="divider"></div>
    <div class="footer">{{SUBSCRIBERS_COUNT}} участников уже внутри</div>
  </div>
  
  <!-- TRACKING_PLACEHOLDER -->
</body>
</html>
```

---

## Landing Service — полная реализация

```typescript
// modules/landings/landings.service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import { nanoid } from 'nanoid';

@Injectable()
export class LandingsService {
  
  private readonly templatesDir = path.join(__dirname, 'templates');
  
  // Получить список доступных шаблонов
  async getTemplates(): Promise<TemplateInfo[]> {
    return [
      {
        id: 'minimal',
        name: 'Minimal',
        description: 'Чистый минималистичный дизайн',
        previewUrl: `${process.env.CDN_URL}/templates/minimal/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'BG_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'gradient',
        name: 'Gradient',
        description: 'Яркий градиентный фон',
        previewUrl: `${process.env.CDN_URL}/templates/gradient/preview.jpg`,
        customizableFields: ['GRADIENT_FROM', 'GRADIENT_TO', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'dark',
        name: 'Dark',
        description: 'Тёмная премиум тема',
        previewUrl: `${process.env.CDN_URL}/templates/dark/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
    ];
  }
  
  // Создать лендинг из шаблона
  async createFromTemplate(projectId: string, dto: CreateLandingFromTemplateDto) {
    return this.prisma.landing.create({
      data: {
        projectId,
        companyId: dto.companyId,
        name: dto.name,
        type: 'TEMPLATE',
        templateId: dto.templateId,
        templateData: {
          PRIMARY_COLOR: dto.primaryColor || '#2AABEE',
          BG_COLOR: dto.bgColor || '#f0f4f8',
          GRADIENT_FROM: dto.gradientFrom || '#667eea',
          GRADIENT_TO: dto.gradientTo || '#764ba2',
          JOIN_BUTTON_TEXT: dto.buttonText || 'Вступить в канал',
          CHANNEL_TITLE: dto.channelTitle || '',
          CHANNEL_DESCRIPTION: dto.channelDescription || '',
          CHANNEL_AVATAR: dto.channelAvatar || '',
          SUBSCRIBERS_COUNT: dto.subscribersCount || '',
        },
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        status: 'DRAFT',
      }
    });
  }
  
  // Загрузить кастомный ZIP лендинг
  async uploadCustomLanding(
    landingId: string,
    fileBuffer: Buffer,
    originalName: string
  ) {
    // Валидация ZIP
    let zip: AdmZip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch {
      throw new BadRequestException('Невалидный ZIP файл');
    }
    
    const entries = zip.getEntries();
    const hasIndex = entries.some(e => e.entryName === 'index.html' || e.entryName === './index.html');
    if (!hasIndex) {
      throw new BadRequestException('ZIP должен содержать index.html в корне');
    }
    
    // Загрузить в MinIO
    const basePath = `landings/custom/${landingId}`;
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      
      const content = entry.getData();
      const mimeType = this.getMimeType(entry.entryName);
      
      await this.storageService.upload(
        `${basePath}/${entry.entryName}`,
        content,
        mimeType
      );
    }
    
    return this.prisma.landing.update({
      where: { id: landingId },
      data: {
        type: 'CUSTOM',
        customBasePath: basePath,
        status: 'DRAFT',
      }
    });
  }
  
  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    return types[ext] || 'application/octet-stream';
  }
}
```

## Landing Renderer Service — полная реализация

```typescript
// modules/landings/renderer.service.ts

@Injectable()
export class LandingRendererService {
  
  async renderAndServe(landingId: string, req: Request, res: Response): Promise<void> {
    const landing = await this.prisma.landing.findUnique({
      where: { id: landingId },
      include: {
        project: {
          include: {
            channels: {
              where: { type: 'TELEGRAM', isActive: true },
              take: 1
            }
          }
        }
      }
    });
    
    if (!landing || landing.status !== 'PUBLISHED') {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }
    
    let html: string;
    
    switch (landing.type) {
      case 'TEMPLATE':
        html = await this.renderTemplate(landing);
        break;
      case 'CUSTOM':
        html = await this.serveCustomFile(landing, req.path);
        // Для не-HTML файлов (CSS, JS, картинки) — отдать напрямую без инжекта
        if (!req.path.endsWith('.html') && req.path !== '/') {
          res.setHeader('Content-Type', this.getMimeType(req.path));
          res.send(html);
          return;
        }
        break;
      default:
        res.status(404).send('Not found');
        return;
    }
    
    // Инжектировать трекинг скрипты
    html = await this.injectTrackingScripts(html, landing.project, req);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(html);
  }
  
  private async renderTemplate(landing: Landing & { project: Project }): Promise<string> {
    const templatePath = path.join(
      __dirname,
      'templates',
      landing.templateId,
      'template.html'
    );
    
    let html = await fs.readFile(templatePath, 'utf-8');
    
    const data = landing.templateData as Record<string, string>;
    const channel = landing.project.channels?.[0];
    
    // Заполнить плейсхолдеры
    const vars: Record<string, string> = {
      ...data,
      META_TITLE: landing.metaTitle || data.CHANNEL_TITLE || 'Закрытый канал',
      META_DESCRIPTION: landing.metaDescription || data.CHANNEL_DESCRIPTION || '',
      BOT_USERNAME: channel?.tgBotUsername || '',
      START_CODE: '{{START_CODE}}',  // заменяется динамически при рендере
      CHANNEL_INITIAL: (data.CHANNEL_TITLE || 'C').charAt(0).toUpperCase(),
    };
    
    // Обработать условные блоки {{#if VAR}}...{{/if}}
    html = this.processConditionals(html, vars);
    
    // Заменить переменные
    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, value || '');
    }
    
    return html;
  }
  
  private processConditionals(html: string, vars: Record<string, string>): string {
    return html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return vars[varName] ? content : '';
    });
  }
  
  private async serveCustomFile(landing: Landing, reqPath: string): Promise<string> {
    const filePath = reqPath === '/' || reqPath === '' ? 'index.html' : reqPath.replace(/^\//, '');
    const fullPath = `${landing.customBasePath}/${filePath}`;
    
    const content = await this.storageService.get(fullPath);
    return content.toString('utf-8');
  }
  
  private async injectTrackingScripts(
    html: string,
    project: Project,
    req: Request
  ): Promise<string> {
    // Генерировать уникальный start code для Telegram deep link
    const startCode = nanoid(16);
    
    // Сохранить tracking данные в Redis на 24 часа
    const urlParams = new URLSearchParams(req.query as any);
    const trackingData = {
      fbclid: urlParams.get('fbclid'),
      ttclid: urlParams.get('ttclid'),
      utmSource: urlParams.get('utm_source'),
      utmMedium: urlParams.get('utm_medium'),
      utmCampaign: urlParams.get('utm_campaign'),
      utmContent: urlParams.get('utm_content'),
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      landingUrl: req.url,
    };
    
    await this.redis.setex(`start:${startCode}`, 86400, JSON.stringify(trackingData));
    
    // Заменить START_CODE
    html = html.replaceAll('{{START_CODE}}', startCode);
    
    const trackingScripts = `
<script src="${process.env.CDN_URL}/track.js" 
        data-project-id="${project.publicToken}"
        async></script>
${project.fbPixelId ? `
<!-- Facebook Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${project.fbPixelId}');
fbq('track','PageView',{eventID:'${nanoid(16)}'});
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${project.fbPixelId}&ev=PageView&noscript=1"/></noscript>` : ''}
${project.ttPixelId ? `
<!-- TikTok Pixel -->
<script>
!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js",o=document.createElement("script");
o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;
var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
ttq.load('${project.ttPixelId}');ttq.page();}(window,document,'ttq');
</script>` : ''}`;
    
    // Вставить перед </head> или в начало <body>
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${trackingScripts}\n</head>`);
    } else if (html.includes('<!-- TRACKING_PLACEHOLDER -->')) {
      html = html.replace('<!-- TRACKING_PLACEHOLDER -->', trackingScripts);
    } else {
      html = trackingScripts + html;
    }
    
    return html;
  }
  
  private getClientIp(req: Request): string {
    return (
      req.headers['cf-connecting-ip'] as string ||
      req.headers['x-real-ip'] as string ||
      req.socket.remoteAddress || ''
    );
  }
}
```

## Internal Landing Serve Controller

```typescript
// Этот контроллер вызывается Nginx для отдачи лендинга по домену
// GET /internal/serve-landing/:landingId/*

@Controller('internal')
export class InternalController {
  
  @Public()
  @Get('serve-landing/:landingId*')
  async serveLanding(
    @Param('landingId') landingId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Дополнительная безопасность: принимать только от Nginx (localhost)
    const remoteAddr = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr)) {
      res.status(403).send('Forbidden');
      return;
    }
    
    await this.rendererService.renderAndServe(landingId, req, res);
  }
}
```

## Landings Controller endpoints

```typescript
// GET    /api/v1/landings/templates          — доступные шаблоны
// GET    /api/v1/projects/:id/landings       — лендинги проекта
// POST   /api/v1/projects/:id/landings       — создать из шаблона
// GET    /api/v1/landings/:id                — детали лендинга
// PATCH  /api/v1/landings/:id                — обновить настройки шаблона
// POST   /api/v1/landings/:id/upload         — загрузить ZIP (multipart)
// POST   /api/v1/landings/:id/publish        — опубликовать
// POST   /api/v1/landings/:id/unpublish      — снять с публикации
// GET    /api/v1/landings/:id/preview        — HTML предпросмотр
// DELETE /api/v1/landings/:id                — удалить
```

## Storage Service (MinIO)

```typescript
// modules/storage/storage.service.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  
  constructor() {
    this.s3 = new S3Client({
      endpoint: `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,  // обязательно для MinIO
    });
    this.bucket = process.env.MINIO_BUCKET || 'trafficcrm';
  }
  
  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    
    return `${process.env.CDN_URL}/${key}`;
  }
  
  async get(key: string): Promise<Buffer> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    
    return Buffer.from(await response.Body.transformToByteArray());
  }
  
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }
  
  // Загрузить всю директорию
  async uploadDirectory(localDir: string, s3Prefix: string): Promise<void> {
    const files = await this.getFilesRecursive(localDir);
    
    await Promise.all(files.map(async (filePath) => {
      const content = await fs.readFile(filePath);
      const relativePath = path.relative(localDir, filePath);
      const s3Key = `${s3Prefix}/${relativePath}`;
      const mimeType = this.getMimeType(filePath);
      
      await this.upload(s3Key, content, mimeType);
    }));
  }
  
  private async getFilesRecursive(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(entry => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? this.getFilesRecursive(fullPath) : [fullPath];
      })
    );
    return files.flat();
  }
}
```

## Дополнительные npm зависимости для этого модуля

```bash
cd apps/api
npm install adm-zip @types/adm-zip
npm install multer @types/multer @nestjs/platform-express
npm install nanoid
npm install mime-types @types/mime-types
```

## NestJS Multer конфиг для загрузки ZIP

```typescript
// В LandingsModule добавить:
MulterModule.register({
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Только ZIP файлы'), false);
    }
  },
})
```
