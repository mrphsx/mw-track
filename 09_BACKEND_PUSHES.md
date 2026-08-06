# 09 — Backend: Push-рассылки по клиентской базе

## Задача для Claude Code
Реализуй систему массовых рассылок (push) по сегментам клиентов через каналы (Telegram —
основной канал MVP), с очередью, rate limiting, статистикой доставки и лимитами по тарифу.

## Архитектура

```
PushesController
    ↓
PushesService.create()       → Push (status: DRAFT|SCHEDULED), audienceTotal/audienceReachable
PushesService.send()         → Push.status = SENDING, company.pushesToday++
    ↓ (по клиентам аудитории, чанками — ClientsService.getClientsForPushInChunks)
BullMQ Queue 'push-messages' (rate limit: 30 job/sec)
    ↓
PushProcessor.sendPushMessage(pushId, clientId)
    ├── ChannelsService.sendMessage(client, options)  — уже умеет 403→markBotBlocked (шаг 1.5)
    └── PushLog (sent|failed) + Push.sentCount/failedCount++
            ↓ (когда sentCount+failedCount >= audienceReachable)
        Push.status = SENT
```

Аудитория считается через уже существующий `ClientsService` (шаг 1.6) — `countPushAudience()`
и `getClientsForPushInChunks()` были сделаны заранее именно под этот модуль и переиспользуются
без изменений. Этот документ добавляет только различие "всего по сегменту" (`audienceTotal`,
без требования `isSubscribed`/`isBotActive`) от "доступно к отправке" (`audienceReachable`,
с этим требованием) — у `Push` в схеме это два разных поля.

## Push DTO

```typescript
// modules/pushes/dto/create-push.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PushFilterDto } from '../../clients/dto/push-filter.dto'; // переиспользуем из шага 1.6

class PushButtonDto {
  @IsString() text: string;
  @IsOptional() @IsString() url?: string;
}

class PushMediaDto {
  @IsString() type: 'photo' | 'video';
  @IsString() url: string;
}

export class CreatePushDto {
  @IsString()
  name: string;

  @IsString()
  messageText: string;

  @IsOptional() @ValidateNested() @Type(() => PushMediaDto)
  messageMedia?: PushMediaDto;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PushButtonDto)
  buttons?: PushButtonDto[];

  @IsObject() @ValidateNested() @Type(() => PushFilterDto)
  filter: PushFilterDto;

  @IsOptional() @IsDateString()
  scheduledAt?: string;
}

// modules/pushes/dto/update-push.dto.ts — PartialType(CreatePushDto), разрешён только
// для Push.status в (DRAFT, SCHEDULED); проверка в PushesService.update()
```

## ClientsService — добавить различие total/reachable

`buildPushFilterWhere()` (шаг 1.6) всегда требует `isSubscribed: true, isBotActive: true` —
это нужно для рассылки (`getClientsForPushInChunks`), но для превью аудитории нужно ещё и
"сколько всего человек в сегменте, включая тех, кому уже не дойдёт". Расширить сигнатуру:

```typescript
// modules/clients/clients.service.ts (дополнение к шагу 1.6)
async countAudienceTotal(projectId: string, filters: PushFilterDto): Promise<number> {
  return this.prisma.client.count({
    where: this.buildPushFilterWhere(projectId, filters, { reachableOnly: false }),
  });
}

// countPushAudience() и getClientsForPushInChunks() продолжают вызывать
// buildPushFilterWhere(projectId, filters) без второго аргумента — reachableOnly: true по умолчанию

private buildPushFilterWhere(
  projectId: string,
  filters: PushFilterDto,
  opts: { reachableOnly?: boolean } = { reachableOnly: true },
): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = { projectId, deletedAt: null };
  if (opts.reachableOnly) {
    where.isSubscribed = true;
    where.isBotActive = true;
  }
  // ...остальные фильтры без изменений
}
```

## Pushes Service

```typescript
// modules/pushes/pushes.service.ts

@Injectable()
export class PushesService {
  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    @InjectQueue('push-messages') private pushQueue: Queue,
  ) {}

  private async previewAudience(projectId: string, filter: PushFilterDto) {
    const [audienceTotal, audienceReachable] = await Promise.all([
      this.clientsService.countAudienceTotal(projectId, filter),
      this.clientsService.countPushAudience(projectId, filter),
    ]);
    return { audienceTotal, audienceReachable };
  }

  async create(projectId: string, dto: CreatePushDto): Promise<Push> {
    const { audienceTotal, audienceReachable } = await this.previewAudience(projectId, dto.filter);

    return this.prisma.push.create({
      data: {
        projectId,
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: dto.messageMedia,
        buttons: dto.buttons,
        filter: dto.filter as Prisma.InputJsonValue,
        audienceTotal,
        audienceReachable,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? PushStatus.SCHEDULED : PushStatus.DRAFT,
      },
    });
  }

  // Пересчёт аудитории — фильтр сегмента тот же, но состав клиентов мог измениться
  // (новые подписчики, кто-то заблокировал бота) с момента создания черновика
  async recalculateAudience(pushId: string, projectId: string): Promise<Push> {
    const push = await this.findOne(pushId, projectId);
    this.assertEditable(push);

    const { audienceTotal, audienceReachable } = await this.previewAudience(projectId, push.filter as unknown as PushFilterDto);
    return this.prisma.push.update({ where: { id: pushId }, data: { audienceTotal, audienceReachable } });
  }

  // Запуск рассылки. Лимит "сколько пушей в месяц" уже проверен SubscriptionGuard
  // на контроллере (@SubscriptionLimit('pushes')) ДО вызова этого метода — здесь
  // только инкремент счётчика использования, не повторная проверка лимита.
  async send(pushId: string, projectId: string, companyId: string): Promise<Push> {
    const push = await this.findOne(pushId, projectId);
    this.assertEditable(push);

    const updated = await this.prisma.push.update({
      where: { id: pushId },
      data: { status: PushStatus.SENDING, sentAt: new Date() },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { pushesToday: { increment: 1 } },
    });

    // Чанки по 200 клиентов — не грузим всю аудиторию в память (см. ClientsService, шаг 1.6).
    // Rate limiting (30/сек) обеспечивает не цикл, а лимитер очереди 'push-messages' —
    // добавление в очередь идёт быстро, фактическая скорость отправки регулируется Bull'ом.
    for await (const chunk of this.clientsService.getClientsForPushInChunks(projectId, push.filter as unknown as PushFilterDto)) {
      for (const client of chunk) {
        await this.pushQueue.add('send-push-message', { pushId, clientId: client.id });
      }
    }

    return updated;
  }

  async findOne(id: string, projectId: string): Promise<Push> {
    const push = await this.prisma.push.findFirst({ where: { id, projectId } });
    if (!push) throw new NotFoundException('Пуш не найден');
    return push;
  }

  async findAll(projectId: string) {
    return this.prisma.push.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async cancel(id: string, projectId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);
    return this.prisma.push.update({ where: { id }, data: { status: PushStatus.FAILED } });
  }

  private assertEditable(push: Push) {
    if (![PushStatus.DRAFT, PushStatus.SCHEDULED].includes(push.status)) {
      throw new ForbiddenException('Пуш уже отправляется или отправлен');
    }
  }
}
```

## BullMQ очередь push-messages + rate limiting

```typescript
// modules/pushes/pushes.module.ts
BullModule.registerQueue({
  name: 'push-messages',
  limiter: {
    max: 30,       // Telegram: не более 30 сообщений/сек на один бот
    duration: 1000,
  },
}),
```

**Важное ограничение MVP**: лимитер Bull (classic, не BullMQ Pro) работает на уровне всей
очереди, а не на уровне отдельного бота/канала. Это значит, что 30/сек делится между ВСЕМИ
проектами, отправляющими пуши одновременно, а не выдаётся каждому боту отдельно (как на самом
деле работает лимит Telegram). Для MVP это безопасно (никогда не превышает реальный лимит
Telegram), но при росте числа одновременных рассылок станет узким местом — тогда нужно либо
переходить на BullMQ (groupKey-лимитер по channelId), либо поднимать отдельную очередь на канал.
Сознательная заплата, не баг.

## Push Processor (воркер)

```typescript
// modules/pushes/pushes.processor.ts

@Processor('push-messages')
export class PushesProcessor {
  private readonly logger = new Logger(PushesProcessor.name);

  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
  ) {}

  @Process('send-push-message')
  async sendPushMessage(job: Job<{ pushId: string; clientId: string }>) {
    const [push, client] = await Promise.all([
      this.prisma.push.findUnique({ where: { id: job.data.pushId } }),
      this.prisma.client.findUnique({ where: { id: job.data.clientId } }),
    ]);
    if (!push || !client) return;

    const log = await this.prisma.pushLog.create({
      data: { pushId: push.id, clientId: client.id, status: 'pending' },
    });

    // 403 (бот заблокирован пользователем) уже обрабатывается внутри
    // TelegramProvider.sendMessage → ClientsService.markBotBlocked (шаг 1.5) —
    // здесь только фиксируем итог в PushLog и счётчиках Push.
    const media = push.messageMedia as { type?: string; url?: string } | null;
    const sent = await this.channelsService.sendMessage(client, {
      text: push.messageText,
      mediaUrl: media?.url,
      mediaType: media?.type as 'photo' | 'video' | undefined,
      buttons: push.buttons as any,
    });

    await this.prisma.pushLog.update({
      where: { id: log.id },
      data: { status: sent ? 'sent' : 'failed', sentAt: sent ? new Date() : null, error: sent ? null : 'send failed' },
    });

    const updated = await this.prisma.push.update({
      where: { id: push.id },
      data: sent ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } },
    });

    if (updated.status === 'SENDING' && updated.sentCount + updated.failedCount >= updated.audienceReachable) {
      await this.prisma.push.update({ where: { id: push.id }, data: { status: 'SENT' } });
    }
  }
}
```

## Pushes Controller — все эндпоинты

```
POST   /api/v1/projects/:projectId/pushes
//   Тело: CreatePushDto. Создаёт DRAFT (или SCHEDULED если указан scheduledAt).
//   Сразу считает audienceTotal/audienceReachable для превью перед отправкой.

GET    /api/v1/projects/:projectId/pushes
//   Список пушей проекта.

GET    /api/v1/projects/:projectId/pushes/:id
//   Детали + текущая статистика (sentCount/deliveredCount/failedCount).

PATCH  /api/v1/projects/:projectId/pushes/:id
//   Разрешено только для DRAFT/SCHEDULED.

POST   /api/v1/projects/:projectId/pushes/:id/recalculate-audience
//   Пересчитать audienceTotal/audienceReachable по текущему составу клиентов.

POST   /api/v1/projects/:projectId/pushes/:id/send
//   @SubscriptionLimit('pushes') — гвард проверяет company.pushesToday < maxPushesPerDay
//   ДО вызова сервиса. Переводит в SENDING, расставляет джобы по очереди.

GET    /api/v1/projects/:projectId/pushes/:id/logs
//   Список PushLog (кому доставлено/не доставлено) — постранично.

DELETE /api/v1/projects/:projectId/pushes/:id
//   Отмена черновика/запланированного пуша (только DRAFT/SCHEDULED).
```

## Cron: сброс лимитов пушей каждый день (было — раз в месяц, до 2026-07-30)

```typescript
// modules/pushes/pushes.service.ts (или отдельный PushesCron)

@Cron('0 0 * * *') // раз в сутки, а не раз в секунду на каждую компанию — дешевле и достаточно
async resetDailyPushLimits() {
  const companies = await this.prisma.company.findMany({
    where: { pushesResetAt: { lte: subDays(new Date(), 1) } },
  });

  for (const company of companies) {
    await this.prisma.company.update({
      where: { id: company.id },
      data: { pushesToday: 0, pushesResetAt: new Date() },
    });
  }
}
```

Намеренно "скользящие 30 дней от последнего сброса", а не календарный месяц — проще, не требует
часового пояса компании, и не создаёт пограничных эффектов 1-го числа.

## Cron: проверка истёкших подписок каждый час

`SubscriptionGuard` (шаг 1.3) уже блокирует доступ в реальном времени, если
`company.planExpiresAt < now()` — это и есть фактическое ограничение. Этому крону не нужно
(и не должно) самому отключать доступ повторно. Его задача — то, что guard не делает:
видимость для опс и проактивное отключение каналов, чтобы боты не продолжали отвечать клиентам
истёкшей компании в фоне (channel-уровень не защищён guard'ом, т.к. вебхуки публичные).

```typescript
@Cron('0 * * * *') // каждый час
async checkExpiredSubscriptions() {
  const expired = await this.prisma.company.findMany({
    where: { planExpiresAt: { lt: new Date() }, plan: { not: 'TRIAL' } },
    include: { projects: { include: { channels: true } } },
  });

  for (const company of expired) {
    this.logger.warn(`Company ${company.id} (${company.name}) subscription expired at ${company.planExpiresAt}`);

    for (const project of company.projects) {
      for (const channel of project.channels) {
        if (channel.isActive) {
          await this.prisma.channel.update({ where: { id: channel.id }, data: { isActive: false } });
        }
      }
    }
  }
}
```

Отправка email-уведомления о просрочке — задача биллинга (шаг 1.10, Crypto Billing), здесь не
реализуется, т.к. почтового сервиса в проекте пока нет.
