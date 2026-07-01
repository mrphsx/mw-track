# 06 — Tracking: Facebook CAPI, TikTok Events API, JS SDK

> **Реальная архитектура отличается от черновика ниже**: `project.fbPixelId`/
> `project.ttPixelId`/`project.fbAccessToken`/`project.ttAccessToken` больше не
> существуют — проект не привязан к одной платформе. Вместо них — модель
> `TrackingPixel` (много пикселей любых платформ на проект), и `TrackingProcessor`
> рассылает каждое событие во ВСЕ активные пиксели проекта через карту
> `Record<PixelPlatform, PixelProvider>` (тот же паттерн, что `ChannelsService.providers`
> для каналов) — без if/else на платформу. Статус доставки хранится не в
> `TrackingEvent.fbStatus`/`ttStatus`, а в отдельной модели `TrackingEventDelivery`
> (один ряд на пару событие+пиксель). См. реальный код в `apps/api/src/modules/tracking/`
> и `apps/api/src/modules/pixels/`. Примеры с `project.fbPixelId` ниже — устаревший
> черновик, оставлен для истории.

## Задача для Claude Code
Реализуй систему трекинга событий с гарантированной доставкой.

## Архитектура трекинга

```
Событие (PageView/Lead/Purchase)
    ↓
TrackingController (принимает от SDK/браузера/бота)
    ↓
TrackingService.recordEvent() → сохранить в БД (TrackingEvent)
    ↓
BullMQ Queue 'tracking-events'
    ↓
TrackingProcessor.process()
    ├── FacebookCAPIService.send()
    └── TikTokEventsService.send()
```

## Tracking Controller (публичный API для SDK)

```typescript
// modules/tracking/tracking.controller.ts

@Controller('track')
export class TrackingController {
  
  // Браузерный endpoint (использует publicToken)
  @Public()
  @Post(':publicToken/event')
  async trackEvent(
    @Param('publicToken') publicToken: string,
    @Body() dto: TrackEventDto,
    @Req() req: Request,
    @Headers('origin') origin: string,
  ) {
    // Найти проект по publicToken
    const project = await this.projectsService.findByPublicToken(publicToken);
    if (!project) throw new NotFoundException('Project not found');
    
    // Проверить CORS (разрешённые домены)
    if (project.allowedDomains.length > 0 && origin) {
      const originHost = new URL(origin).hostname;
      if (!project.allowedDomains.includes(originHost)) {
        throw new ForbiddenException('Domain not allowed');
      }
    }
    
    // Обогатить данными из запроса
    const enrichedDto = {
      ...dto,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      source: 'BROWSER' as EventSource,
    };
    
    return this.trackingService.recordEvent(project.id, enrichedDto);
  }
  
  // Серверный endpoint (использует secretKey + HMAC подпись)
  @Public()
  @Post('server/:projectId/event')
  async trackServerEvent(
    @Param('projectId') projectId: string,
    @Body() dto: TrackEventDto,
    @Headers('x-signature') signature: string,
    @Headers('x-timestamp') timestamp: string,
    @Req() req: Request,
  ) {
    const project = await this.projectsService.findById(projectId);
    if (!project) throw new NotFoundException();
    
    // Верифицировать HMAC подпись
    const payload = JSON.stringify(dto);
    const expectedSig = crypto
      .createHmac('sha256', project.secretKey)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    
    if (signature !== `sha256=${expectedSig}`) {
      throw new UnauthorizedException('Invalid signature');
    }
    
    // Защита от replay атак (timestamp не старше 5 минут)
    if (Date.now() - Number(timestamp) > 5 * 60 * 1000) {
      throw new UnauthorizedException('Request expired');
    }
    
    return this.trackingService.recordEvent(project.id, {
      ...dto,
      source: 'SDK',
    });
  }
  
  private getClientIp(req: Request): string {
    return (
      req.headers['cf-connecting-ip'] as string ||  // Cloudflare
      req.headers['x-real-ip'] as string ||
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
```

## Tracking Service

```typescript
// modules/tracking/tracking.service.ts

@Injectable()
export class TrackingService {
  
  async recordEvent(projectId: string, dto: RecordEventDto): Promise<{ eventId: string }> {
    // Генерировать уникальный event_id (для дедупликации FB)
    const eventId = dto.idempotencyKey || 
      `${projectId}_${dto.eventName}_${dto.fbclid || ''}_${Date.now()}_${nanoid(8)}`;
    
    // Проверить idempotency — не обрабатывать дубли
    const existing = await this.prisma.trackingEvent.findUnique({
      where: { eventId }
    });
    if (existing) return { eventId };
    
    // Найти или создать клиента
    let clientId: string | undefined;
    if (dto.tgUserId || dto.waPhone || dto.fbclid) {
      const client = await this.resolveClient(projectId, dto);
      clientId = client?.id;
    }
    
    // Сохранить событие в БД
    const event = await this.prisma.trackingEvent.create({
      data: {
        projectId,
        clientId,
        eventName: dto.eventName,
        eventId,
        eventTime: dto.timestamp ? new Date(dto.timestamp) : new Date(),
        source: dto.source || 'SERVER',
        payload: {
          fbclid: dto.fbclid,
          ttclid: dto.ttclid,
          email: dto.email,
          phone: dto.phone,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
          pageUrl: dto.pageUrl,
          value: dto.value,
          currency: dto.currency,
          orderId: dto.orderId,
          utmSource: dto.utmSource,
          utmCampaign: dto.utmCampaign,
        },
      }
    });
    
    // Добавить в очередь для отправки в FB/TT
    await this.trackingQueue.add(
      'send-to-platforms',
      { eventDbId: event.id, projectId },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        priority: dto.eventName === 'Purchase' ? 1 : 3, // Purchase в приоритете
      }
    );
    
    return { eventId };
  }
  
  // Разрешить клиента из данных события
  private async resolveClient(projectId: string, dto: RecordEventDto) {
    // Поиск по Telegram ID
    if (dto.tgUserId) {
      return this.prisma.client.findFirst({
        where: { projectId, tgUserId: dto.tgUserId }
      });
    }
    
    // Поиск по fbclid (человек был на лендинге, потом пришёл через другой канал)
    if (dto.fbclid) {
      return this.prisma.client.findFirst({
        where: { projectId, fbclid: dto.fbclid }
      });
    }
    
    return null;
  }
}
```

## Tracking Processor (BullMQ воркер)

```typescript
// modules/tracking/tracking.processor.ts

@Processor('tracking-events')
export class TrackingProcessor {
  
  @Process('send-to-platforms')
  async sendToPlatforms(job: Job<{ eventDbId: string; projectId: string }>) {
    const event = await this.prisma.trackingEvent.findUnique({
      where: { id: job.data.eventDbId },
      include: { project: true, client: true }
    });
    
    if (!event || !event.project) return;
    
    const project = event.project;
    const promises = [];
    
    // Отправить в Facebook если настроен
    if (project.fbPixelId && project.fbAccessToken) {
      promises.push(
        this.facebookCAPI.sendEvent(event, project)
          .then(result => this.prisma.trackingEvent.update({
            where: { id: event.id },
            data: {
              fbSentAt: new Date(),
              fbStatus: result.success ? 'sent' : 'error',
              fbError: result.error,
            }
          }))
      );
    }
    
    // Отправить в TikTok если настроен
    if (project.ttPixelId && project.ttAccessToken) {
      promises.push(
        this.tiktokEvents.sendEvent(event, project)
          .then(result => this.prisma.trackingEvent.update({
            where: { id: event.id },
            data: {
              ttSentAt: new Date(),
              ttStatus: result.success ? 'sent' : 'error',
              ttError: result.error,
            }
          }))
      );
    }
    
    await Promise.allSettled(promises);
  }
}
```

## Facebook CAPI Service

```typescript
// modules/tracking/facebook-capi.service.ts

@Injectable()
export class FacebookCAPIService {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';
  
  async sendEvent(event: TrackingEvent, project: Project): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = event.payload as any;
      
      const userData: any = {};
      
      // Хэшировать персональные данные (SHA-256, обязательно)
      if (payload.email) userData.em = [sha256(payload.email.toLowerCase().trim())];
      if (payload.phone) userData.ph = [sha256(payload.phone.replace(/\D/g, ''))];
      if (payload.ipAddress) userData.client_ip_address = payload.ipAddress;
      if (payload.userAgent) userData.client_user_agent = payload.userAgent;
      
      // fbclid в формат fbc
      if (payload.fbclid) {
        userData.fbc = `fb.1.${Date.now()}.${payload.fbclid}`;
      }
      
      // Строить данные события
      const eventData: any = {
        event_name: event.eventName,
        event_time: Math.floor(new Date(event.eventTime).getTime() / 1000),
        event_id: event.eventId,  // ОБЯЗАТЕЛЬНО для дедупликации
        event_source_url: payload.pageUrl,
        action_source: payload.source === 'BROWSER' ? 'website' : 'system_generated',
        user_data: userData,
      };
      
      // Данные для Purchase
      if (event.eventName === 'Purchase' && payload.value) {
        eventData.custom_data = {
          value: payload.value,
          currency: payload.currency || 'USD',
          order_id: payload.orderId,
        };
      }
      
      const url = `${this.baseUrl}/${project.fbPixelId}/events`;
      const params: any = {
        data: [eventData],
        access_token: project.fbAccessToken,
      };
      
      // Добавить test_event_code если в тестовом режиме
      if (project.fbTestEventCode) {
        params.test_event_code = project.fbTestEventCode;
      }
      
      const response = await axios.post(url, params);
      
      return {
        success: true,
        error: undefined,
      };
      
    } catch (error) {
      const fbError = error.response?.data?.error?.message || error.message;
      this.logger.error(`FB CAPI error for project ${project.id}:`, fbError);
      return { success: false, error: fbError };
    }
  }
}

// SHA-256 хэш (обязательно для FB)
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
```

## TikTok Events API Service

```typescript
// modules/tracking/tiktok-events.service.ts

@Injectable()
export class TikTokEventsService {
  private readonly baseUrl = 'https://business-api.tiktok.com/open_api/v1.3';
  
  // Маппинг наших событий в TikTok события
  private readonly eventMap: Record<string, string> = {
    'PageView': 'ViewContent',
    'Lead': 'SubmitForm',
    'Subscribe': 'Subscribe',
    'Purchase': 'CompletePayment',
    'InitiateCheckout': 'InitiateCheckout',
  };
  
  async sendEvent(event: TrackingEvent, project: Project): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = event.payload as any;
      const ttEventName = this.eventMap[event.eventName] || event.eventName;
      
      const userData: any = {
        ip: payload.ipAddress,
        user_agent: payload.userAgent,
      };
      
      // ttclid для атрибуции
      if (payload.ttclid) {
        userData.ttclid = payload.ttclid;
      }
      
      if (payload.email) userData.email = sha256(payload.email.toLowerCase().trim());
      if (payload.phone) userData.phone_number = sha256(payload.phone.replace(/\D/g, ''));
      
      const body = {
        pixel_code: project.ttPixelId,
        event: ttEventName,
        event_id: event.eventId,
        timestamp: new Date(event.eventTime).toISOString(),
        context: {
          page: { url: payload.pageUrl },
          user_agent: payload.userAgent,
          ip: payload.ipAddress,
        },
        properties: {
          ...(event.eventName === 'Purchase' ? {
            value: payload.value,
            currency: payload.currency || 'USD',
            order_id: payload.orderId,
          } : {}),
        },
        user: userData,
      };
      
      await axios.post(
        `${this.baseUrl}/pixel/track/`,
        { data: [body] },
        { headers: { 'Access-Token': project.ttAccessToken } }
      );
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }
}
```

## JS Snippet (для вставки на лендинги)

Создай файл `apps/sdk/src/browser.ts`:

```typescript
// Это компилируется в один минифицированный файл track.js
// и хостится на CDN: cdn.yourdomain.com/track.js

(function(w, d) {
  const config = {
    projectToken: d.currentScript?.getAttribute('data-project-id'),
    apiUrl: 'https://api.yourdomain.com/api/v1/track',
  };
  
  if (!config.projectToken) {
    console.warn('[TrafficCRM] data-project-id not set');
    return;
  }
  
  // Получить UTM параметры и clid из URL
  const urlParams = new URLSearchParams(w.location.search);
  const trackingData = {
    fbclid: urlParams.get('fbclid'),
    ttclid: urlParams.get('ttclid'),
    utmSource: urlParams.get('utm_source'),
    utmMedium: urlParams.get('utm_medium'),
    utmCampaign: urlParams.get('utm_campaign'),
    utmContent: urlParams.get('utm_content'),
  };
  
  // Сохранить в sessionStorage для использования позже
  sessionStorage.setItem('_tcrm', JSON.stringify(trackingData));
  
  // Отправить событие
  async function track(eventName: string, extra = {}) {
    const stored = JSON.parse(sessionStorage.getItem('_tcrm') || '{}');
    
    try {
      await fetch(`${config.apiUrl}/${config.projectToken}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          pageUrl: w.location.href,
          referrer: d.referrer,
          ...stored,
          ...extra,
        }),
      });
    } catch (e) {
      // Тихо игнорируем ошибки трекинга
    }
  }
  
  // Автоматический PageView
  track('PageView');
  
  // Отслеживать клики на кнопки с data-track
  d.addEventListener('click', function(e) {
    const target = (e.target as HTMLElement).closest('[data-track]');
    if (target) {
      const eventName = target.getAttribute('data-track');
      track(eventName || 'Click', {
        buttonText: target.textContent?.trim(),
      });
    }
  });
  
  // Генерировать уникальный код для Telegram deep link
  // Когда клик по Telegram кнопке — генерировать код и добавить в URL
  d.addEventListener('click', function(e) {
    const target = (e.target as HTMLElement).closest('[data-tg-link]');
    if (target) {
      e.preventDefault();
      const botUsername = target.getAttribute('data-tg-bot');
      const stored = JSON.parse(sessionStorage.getItem('_tcrm') || '{}');
      
      // Запросить уникальный start код
      fetch(`${config.apiUrl}/${config.projectToken}/tg-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stored),
      })
      .then(r => r.json())
      .then(({ startCode }) => {
        w.open(`https://t.me/${botUsername}?start=${startCode}`, '_blank');
      });
    }
  });
  
  // Публичный API
  (w as any).tcrm = { track };
  
})(window, document);
```

## npm SDK

```typescript
// apps/sdk/src/index.ts

export class TrackClient {
  private projectId: string;
  private secretKey: string;
  private apiUrl: string;
  
  constructor(options: { projectId: string; secretKey: string; apiUrl?: string }) {
    this.projectId = options.projectId;
    this.secretKey = options.secretKey;
    this.apiUrl = options.apiUrl || 'https://api.yourdomain.com/api/v1/track';
  }
  
  async event(eventName: string, data: EventData = {}): Promise<void> {
    const timestamp = Date.now().toString();
    const payload = { eventName, timestamp: new Date().toISOString(), ...data };
    const body = JSON.stringify(payload);
    
    // HMAC подпись
    const signature = 'sha256=' + createHmac('sha256', this.secretKey)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    
    await fetch(`${this.apiUrl}/server/${this.projectId}/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
      body,
    });
  }
  
  // Удобные методы
  async pageView(data?: Partial<EventData>) {
    return this.event('PageView', data);
  }
  
  async lead(data?: Partial<EventData>) {
    return this.event('Lead', data);
  }
  
  async purchase(amount: number, currency = 'USD', data?: Partial<EventData>) {
    return this.event('Purchase', { value: amount, currency, ...data });
  }
}
```

## Tracking Event DTO

```typescript
// modules/tracking/dto/track-event.dto.ts
export class TrackEventDto {
  @IsString()
  eventName: string;  // PageView, Lead, Subscribe, Purchase
  
  @IsOptional() @IsString()
  fbclid?: string;
  
  @IsOptional() @IsString()
  ttclid?: string;
  
  @IsOptional() @IsEmail()
  email?: string;
  
  @IsOptional() @IsString()
  phone?: string;
  
  @IsOptional() @IsString()
  tgUserId?: string;
  
  @IsOptional() @IsUrl()
  pageUrl?: string;
  
  @IsOptional() @IsNumber()
  value?: number;
  
  @IsOptional() @IsString()
  currency?: string;
  
  @IsOptional() @IsString()
  orderId?: string;
  
  @IsOptional() @IsString()
  idempotencyKey?: string;
  
  @IsOptional() @IsString()
  utmSource?: string;
  
  @IsOptional() @IsString()
  utmCampaign?: string;
  
  // Устанавливается сервером (не от клиента)
  ipAddress?: string;
  userAgent?: string;
  source?: EventSource;
  timestamp?: string;
}
```
