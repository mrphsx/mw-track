import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Permission, Prisma, UserRole } from '@prisma/client';
import { subDays } from 'date-fns';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql, resolveStatsPeriod } from '../../common/timezone.util';
import { StatsPeriodDto } from '../../common/dto/stats-period.dto';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { ChannelsService } from '../channels/channels.service';
import { TelegramPersonalService } from '../channels/providers/telegram-personal.service';
import { LINK_PARAM_KEYS, LINK_PARAM_NAME_REGEX } from '../tracking/link-params.const';
import { buildPixelCurlCommand } from '../tracking/curl-command.util';
import { assertCanAccessTeamManagement, assertOperatorAdminScope } from '../team/team-role.util';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const ELEVATED_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
    private permissionsService: PermissionsService,
    private telegramPersonalService: TelegramPersonalService,
  ) {}

  // Проект сам "становится" каналом (1:1 с 2026-07-02) — тип и конфигурация канала
  // запрашиваются один раз тут, никогда не добавляются отдельным шагом позже (см.
  // ChannelsController — там больше нет POST / для создания канала).
  async create(companyId: string, dto: CreateProjectDto) {
    // SubscriptionGuard уже проверил лимит до вызова
    const { project, channel } = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description,
          publicToken: nanoid(32),
          secretKey: `sk_live_${nanoid(48)}`,
          allowedDomains: dto.allowedDomains || [],
          timezone: dto.timezone,
        },
      });

      const channel = await tx.channel.create({
        data: { projectId: project.id, name: dto.name, ...dto.channel },
      });

      await tx.company.update({
        where: { id: companyId },
        data: { currentProjects: { increment: 1 } },
      });

      return { project, channel };
    });

    // Вне транзакции — initialize() дёргает внешний API (Telegram/360dialog/Meta),
    // не должен держать открытой DB-транзакцию. Ошибка (невалидный токен и т.п.) не должна
    // блокировать создание проекта — tryInitialize сама ловит исключение и пишет
    // lastError/isActive:false, а не бросает (см. ChannelsService.tryInitialize).
    const initializedChannel = await this.channelsService.tryInitialize(channel);

    // Автоимпорт имени — только для Telegram, только когда initialize() реально вернул
    // название (PERSONAL_DM и неудачный initialize() оставляют оба поля пустыми — тогда
    // остаётся fallback-имя, которое ввёл пользователь). WhatsApp/Instagram профиль сейчас
    // не фетчится вообще — вне рамок этой задачи, см. план "Project ↔ Channel: 1:1".
    const fetchedName =
      initializedChannel.type === 'TELEGRAM'
        ? initializedChannel.tgChannelTitle || initializedChannel.tgBotFirstName
        : null;

    if (fetchedName) {
      await this.prisma.channel.update({ where: { id: initializedChannel.id }, data: { name: fetchedName } });
      await this.prisma.project.update({ where: { id: project.id }, data: { name: fetchedName } });
    }

    return this.findOne(project.id, companyId);
  }

  // Список ID доступных проектов без лишних include (запрос пользователя 2026-07-19,
  // глобальный календарь рассылок по всей компании) — тот же elevatedRoles-паттерн, что и
  // findAll ниже и AudienceService.getAccessibleProjectIds (тот держит свою копию, т.к.
  // AudienceModule ходит к ProjectsService через ModuleRef — см. память про циклы импорта;
  // PushesModule импортирует ProjectsModule напрямую, поэтому здесь достаточно публичного
  // метода без обхода).
  // requiredPermission — опционально (запрос пользователя 2026-07-28, per-project права):
  // без него — как раньше, просто членство (используется AudienceService, там нет
  // конкретного ресурса-разрешения). С ним — дополнительно фильтрует по конкретному
  // Permission на каждом проекте (используется PushesCalendarController).
  async getAccessibleProjectIds(companyId: string, userId: string, role: UserRole, requiredPermission?: Permission): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(ELEVATED_ROLES.includes(role) ? {} : { projectAccess: { some: { userId } } }),
      },
      select: { id: true },
    });
    const ids = projects.map((p) => p.id);
    if (!requiredPermission || ELEVATED_ROLES.includes(role)) return ids;

    const grants = await this.prisma.userPermission.findMany({
      where: { userId, projectId: { in: ids }, permission: requiredPermission },
      select: { projectId: true },
    });
    const grantedIds = new Set(grants.map((g) => g.projectId));
    return ids.filter((id) => grantedIds.has(id));
  }

  async findAll(companyId: string, userId: string, role: UserRole) {
    // OWNER/ADMIN/SUPER_ADMIN видят все проекты компании
    const elevatedRoles: UserRole[] = ELEVATED_ROLES;
    const projects = elevatedRoles.includes(role)
      ? await this.prisma.project.findMany({
          where: { companyId, deletedAt: null },
          include: {
            channel: { select: { id: true, type: true, isActive: true, tgMode: true, tgAvatarFileId: true, tgSessionEncrypted: true, lastWebhookAt: true } },
            pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
            _count: { select: { pushes: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : // BUYER/OPERATOR видят только назначенные проекты (ProjectAccess)
        await this.prisma.project.findMany({
          where: { companyId, deletedAt: null, projectAccess: { some: { userId } } },
          include: {
            channel: { select: { id: true, type: true, isActive: true, tgMode: true, tgSessionEncrypted: true, lastWebhookAt: true } },
            pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true } },
            _count: { select: { pushes: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

    const metrics = await this.getClientMetricsByProject(projects.map((p) => p.id));
    return projects.map((p) => ({
      ...p,
      channel: this.sanitizeChannel(p.channel),
      _count: { ...p._count, clients: metrics.get(p.id)?.total ?? 0 },
      activeClientsCount: metrics.get(p.id)?.active ?? 0,
      // Запрос пользователя 2026-07-28: "покажи количество отписок, за всё время как и
      // клиентов" — та же семантика "ours only", что и total/active выше.
      unsubscribedClientsCount: metrics.get(p.id)?.unsubscribed ?? 0,
    }));
  }

  // "Молчащий" вебхук (запрос пользователя 2026-08-05, после реального ~20-часового инцидента —
  // Telegram молча перестал слать вебхуки одному боту, обнаружилось только постфактум по логам
  // nginx, деньги/трафик утекали незаметно) — намеренно щедрый порог: у разных каналов сильно
  // разная частота трафика (от ~15 до ~800+ вебхуков/сутки в проде), при агрессивном пороге
  // низкотрафичные каналы ложно светились бы "сломанными" в спокойные часы. 6 часов полной
  // тишины для КАНАЛА, У КОТОРОГО вебхуки уже случались хотя бы раз (lastWebhookAt не null) —
  // достаточно редкий случай для настоящей проблемы и достаточно долгий, чтобы не шуметь по
  // мелочи. Совсем свежеподключённый канал без единого вебхука пока не считается "молчащим" —
  // это норма, не инцидент.
  private static readonly WEBHOOK_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

  // Убираем зашифрованную MTProto-сессию из ответа (тот же приём, что и в
  // ChannelsController.sanitizeChannel) — карточке/странице проекта достаточно знать сам факт
  // подключения личного аккаунта (запрос пользователя 2026-07-21: "значок если добавлен личный
  // аккаунт телеграм"), показывать ciphertext незачем. webhookStale считается лениво прямо
  // здесь, при каждом чтении (тот же приём, что уже даёт tgPersonalConnected — вычисляемое
  // поле, не отдельный сохранённый boolean/cron, в отличие от isActive).
  private sanitizeChannel<T extends { tgSessionEncrypted?: string | null; lastWebhookAt?: Date | null } | null>(channel: T) {
    if (!channel) return channel;
    const { tgSessionEncrypted, ...safe } = channel;
    const webhookStale = !!channel.lastWebhookAt && Date.now() - channel.lastWebhookAt.getTime() > ProjectsService.WEBHOOK_STALE_THRESHOLD_MS;
    return { ...safe, tgPersonalConnected: !!tgSessionEncrypted, webhookStale };
  }

  // Карточка проекта (список проектов + главная страница) раньше считала клиентов иначе,
  // чем страница самого проекта (ClientsRepository.getProjectStats) — там `count({deletedAt:
  // null})` без фильтра по subscribedAt, здесь — с "только наши" (subscribedAt: not null),
  // из-за чего числа расходились (баг-репорт пользователя 2026-07-17: "в карточке проекта
  // пишет другие цифры клиентов и активных клиентов, не как внутри страницы проекта"). Тот
  // же фильтр "ours only", что и в getProjectStats — единый источник правды для обоих мест.
  // "Активировавшие бота" убраны из карточки по запросу пользователя 2026-07-18 ("убери из
  // карточки... добавь внутри страницы проекта") — метрика осталась только в
  // ClientsRepository.getProjectStats (страница проекта).
  private async getClientMetricsByProject(
    projectIds: string[],
  ): Promise<Map<string, { total: number; active: number; unsubscribed: number }>> {
    if (projectIds.length === 0) return new Map();

    const [totalGroups, activeGroups, unsubscribedGroups] = await Promise.all([
      this.prisma.client.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, subscribedAt: { not: null } },
        _count: true,
      }),
      this.prisma.client.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, subscribedAt: { not: null }, isBotActive: true },
        _count: true,
      }),
      // unsubscribedAt зарезервирован только за реальными подписчиками через нашу воронку
      // (внешние контакты пишут в externalUnsubscribedAt, см. feedback_external_contact_
      // unsubscribe_tracking) — доп. фильтр subscribedAt: not null тут избыточен, но явный.
      this.prisma.client.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, subscribedAt: { not: null }, unsubscribedAt: { not: null } },
        _count: true,
      }),
    ]);

    const map = new Map<string, { total: number; active: number; unsubscribed: number }>();
    for (const id of projectIds) map.set(id, { total: 0, active: 0, unsubscribed: 0 });
    for (const g of totalGroups) map.get(g.projectId)!.total = g._count;
    for (const g of activeGroups) map.get(g.projectId)!.active = g._count;
    for (const g of unsubscribedGroups) map.get(g.projectId)!.unsubscribed = g._count;
    return map;
  }

  // Намеренно findFirst с явным companyId в where, а не findUnique по id:
  // PrismaService middleware авто-скоупит только findFirst/findMany/count/aggregate,
  // findUnique он не трогает — использование findUnique здесь дало бы межтенантную утечку.
  async findOne(id: string, companyId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        channel: {
          select: {
            id: true,
            type: true,
            isActive: true,
            lastError: true,
            tgMode: true,
            tgBotUsername: true,
            tgChannelUsername: true,
            tgPersonalUsername: true,
            tgBotFirstName: true,
            tgChannelTitle: true,
            tgChannelMembersCount: true,
            tgAvatarFileId: true,
            tgSessionEncrypted: true,
            lastWebhookAt: true,
          },
        },
        // testEventCode (запрос пользователя 2026-07-29: "проверь ещё раз создание пикселя...
        // чтобы всё работало идеально") — не секрет в том же смысле, что accessToken (обычный
        // короткий отладочный код, и так виден в интерфейсе Meta любому с доступом к аккаунту),
        // отдаём как есть — нужен фронтенду, чтобы показать индикатор "тестовый режим" и дать
        // отредактировать/убрать его перед запуском реальной рекламы (раньше такой возможности
        // не было вообще — единственный способ был удалить пиксель и создать заново).
        // createdBy — запрос пользователя 2026-08-03, показать в UI, кто добавил пиксель.
        pixels: { select: { id: true, platform: true, pixelId: true, label: true, isActive: true, testEventCode: true, createdBy: { select: { id: true, firstName: true, lastName: true } } } },
        _count: { select: { pushes: true } },
      },
    });
    if (!project) throw new NotFoundException('Проект не найден');

    // Тот же фильтр "ours only" (subscribedAt: not null), что и в findAll/getProjectStats —
    // раньше здесь считались все клиенты без разбора (баг-репорт пользователя 2026-07-17
    // про расхождение цифр карточки/страницы проекта).
    const metrics = await this.getClientMetricsByProject([project.id]);
    return {
      ...project,
      channel: this.sanitizeChannel(project.channel),
      _count: { ...project._count, clients: metrics.get(project.id)?.total ?? 0 },
      activeClientsCount: metrics.get(project.id)?.active ?? 0,
    };
  }

  // Проверка доступа конкретного пользователя к конкретному проекту (Team/роли, запрос
  // пользователя 2026-07-04, Фаза 1) — вызывается из контроллеров, где Buyer/Operator должны
  // быть ограничены только назначенными им проектами (ProjectAccess), в отличие от Owner/
  // Admin/SuperAdmin, у которых доступ ко всем проектам компании без исключений.
  // Точечно применяется в самых используемых ежедневно контроллерах (landings/channels/
  // pushes/clients) — не на все ~99 роутов API сразу, список расширяется по необходимости.
  // requiredPermissions — запрос пользователя 2026-07-28: "чтобы под каждый проект можно было
  // выбрать разрешения, а не общие". Раньше гранулярные права проверял отдельный, JWT-based
  // @RequirePermission/PermissionsGuard (не знал о projectId вообще, права были плоские на
  // пользователя). Теперь право привязано к конкретному проекту (UserPermission.projectId) —
  // единственное место, которое реально ЗНАЕТ, какой проект проверяется на каждом из ~100
  // роутов, это уже существующий assertAccess (либо вызывается напрямую, либо через один из
  // приватных wrapper-методов контроллеров, которые сначала резолвят id ресурса в projectId) —
  // поэтому проверка разрешения переехала сюда же, а не осталась отдельным гвардом. DOMAINS_*
  // сюда НЕ передаются никогда (решение пользователя — домены не привязаны к одному проекту,
  // остаются общим правом на пользователя, см. PermissionsService.hasAnyProjectPermission).
  // allowArchived (запрос пользователя 2026-08-02: "лэндинги удалённого проекта не могу
  // удалить, 404 Проект не найден") — по умолчанию false, поведение всех существующих вызовов
  // не меняется. Нужен там, где действие — уборка/просмотр уже существующих дочерних сущностей
  // архивированного проекта (например, удаление его лендингов), которая не должна упираться в
  // то, что сам проект уже архивирован.
  async assertAccess(
    projectId: string,
    companyId: string,
    userId: string,
    role: UserRole,
    requiredPermissions?: Permission[],
    options?: { allowArchived?: boolean },
  ): Promise<void> {
    if (options?.allowArchived) {
      // Тенантный $use-middleware (prisma.service.ts) безусловно форсирует deletedAt:null на
      // ЛЮБОЙ project.findFirst/findMany внутри активного companyStorage-контекста (то есть
      // всегда, во время обычного HTTP-запроса) — просто не передать deletedAt в where не
      // помогает, middleware затирает его поверх любого переданного значения. В обход —
      // единственное место в проекте, где реально нужно "тот же проект, но не важно,
      // архивирован ли он", поэтому сырой SQL в обход query-builder'а, а не борьба с
      // AsyncLocalStorage-контекстом ради одной проверки существования.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Project" WHERE id = ${projectId} AND "companyId" = ${companyId} LIMIT 1
      `;
      if (rows.length === 0) throw new NotFoundException('Проект не найден');
    } else {
      await this.findOne(projectId, companyId); // бросит 404, если проект не в этой компании
    }

    if (role === UserRole.OWNER || role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN) return;

    const [access, granted] = await Promise.all([
      this.prisma.projectAccess.findUnique({ where: { userId_projectId: { userId, projectId } } }),
      requiredPermissions?.length
        ? this.prisma.userPermission.findMany({ where: { userId, projectId, permission: { in: requiredPermissions } }, select: { permission: true } })
        : Promise.resolve([]),
    ]);
    if (!access) throw new ForbiddenException('Нет доступа к этому проекту');

    if (requiredPermissions?.length) {
      const grantedSet = new Set(granted.map((g) => g.permission));
      const missing = requiredPermissions.filter((p) => !grantedSet.has(p));
      if (missing.length > 0) throw new ForbiddenException(`Недостаточно прав: ${missing.join(', ')}`);
    }
  }

  // Без авторизации (companyId) — вызывается из публичных tracking-эндпоинтов,
  // где сам токен и есть аутентификация. Контекста AsyncLocalStorage там нет,
  // поэтому deletedAt:null указан явно, а не в надежде на middleware.
  // channel — нужен TrackingController.tgRedirect (см. telegram-link.util.ts), чтобы
  // построить tg://-ссылку без дополнительного запроса.
  async findByPublicToken(publicToken: string) {
    return this.prisma.project.findFirst({
      where: { publicToken, deletedAt: null },
      include: {
        channel: {
          select: { type: true, tgMode: true, tgBotUsername: true, tgChannelUsername: true, tgPersonalUsername: true, tgInviteLink: true },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.project.findFirst({ where: { id, deletedAt: null } });
  }

  async update(id: string, companyId: string, dto: UpdateProjectDto) {
    await this.findOne(id, companyId); // проверка владения + 404

    if (dto.linkParamMap) this.validateLinkParamMap(dto.linkParamMap);

    return this.prisma.project.update({
      where: { id },
      data: dto as Prisma.ProjectUpdateInput,
    });
  }

  // Кастомные имена query-параметров трекинг-ссылки (запрос пользователя 2026-07-04) — только
  // известные семантические ключи и только безопасные для query-строки символы, чтобы ссылку
  // можно было собирать конкатенацией строк без экранирования (см. link-params.const.ts).
  private validateLinkParamMap(map: Record<string, string>): void {
    for (const [key, value] of Object.entries(map)) {
      if (!(LINK_PARAM_KEYS as readonly string[]).includes(key)) {
        throw new BadRequestException(`Неизвестный параметр ссылки: ${key}`);
      }
      if (typeof value !== 'string' || !LINK_PARAM_NAME_REGEX.test(value)) {
        throw new BadRequestException(`Недопустимое имя параметра для "${key}": разрешены только буквы, цифры и подчёркивание`);
      }
    }
  }

  async regenerateTokens(id: string, companyId: string) {
    await this.findOne(id, companyId);

    return this.prisma.project.update({
      where: { id },
      data: {
        publicToken: nanoid(32),
        secretKey: `sk_live_${nanoid(48)}`,
      },
    });
  }

  async archive(id: string, companyId: string) {
    await this.findOne(id, companyId);

    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { currentProjects: { decrement: 1 } },
    });

    // Снимаем доступ Buyer/Operator/Оператор-админа к архивированному проекту (баг-репорт
    // пользователя 2026-07-31: "архивировал проект и хотел поменять доступы баеров... Один или
    // несколько проектов не найдены") — ProjectAccess не чистился сам по себе при архивации,
    // но продолжал попадать в форму редактирования участника (вложенный `project: {select}` в
    // TeamService не проходит через tenant-scoping middleware — тот фильтрует только
    // ТОП-уровневые запросы к модели Project, не вложенные include/select у другой модели), и
    // при следующем сохранении assertProjectsBelongToCompany (которая явно фильтрует
    // deletedAt:null) отклоняла весь набор проектов, включая ещё активные. Та же дисциплина
    // очистки, что уже используется в TeamService.update/ProjectsService.removeOperatorFromProject
    // при снятии доступа вручную — здесь просто применяется автоматически при архивации.
    await this.prisma.$transaction([
      this.prisma.projectAccess.deleteMany({ where: { projectId: id } }),
      this.prisma.userPermission.deleteMany({ where: { projectId: id } }),
    ]);

    // Отключаем канал/бота/личный аккаунт (реальный инцидент 2026-08-05: архивированный проект
    // держал живой Telegram-бот с зарегистрированным вебхуком; тот же токен бота позже
    // переиспользовали в новом проекте — Telegram позволяет боту только ОДНУ активную
    // вебхук-ссылку разом, и она осталась висеть на уже архивированном, невидимом проекте.
    // Реальный трафик/деньги новой заявки утекали туда, в CRM ничего не появлялось). Раньше
    // Channel.isActive при архивации проекта не трогался вообще — теперь архивация каскадно
    // отключает и бот-вебхук (ChannelsService.deactivate — тот же метод, что и ручное
    // отключение канала в настройках, вызывает bot.api.deleteWebhook()), и личный MTProto-
    // аккаунт (TelegramPersonalService.disconnect — LogOut + очистка сессии), если они были
    // подключены. Best-effort: ошибка здесь не должна блокировать саму архивацию (проект уже
    // помечен ARCHIVED выше) — канал, к которому Telegram недоступен, всё равно достаточно
    // безопасно оставить как есть, залогировав предупреждение.
    const channel = await this.prisma.channel.findFirst({ where: { projectId: id } });
    if (channel) {
      try {
        if (channel.type === 'TELEGRAM' && channel.tgSessionEncrypted) {
          await this.telegramPersonalService.disconnect(channel);
        }
        if (channel.isActive) {
          await this.channelsService.deactivate(channel.id, companyId);
        }
      } catch (error) {
        // best-effort — сам факт архивации проекта важнее, чем гарантированная отписка от
        // Telegram (если бот уже недоступен/токен отозван, deleteWebhook и так ни на что не
        // повлияет).
        this.logger.warn(`Не удалось отключить канал ${channel.id} при архивации проекта ${id}: ${(error as Error).message}`);
      }
    }
  }

  async getSnippet(id: string, companyId: string) {
    const project = await this.findOne(id, companyId);
    const apiUrl = `${process.env.API_URL}/api/v1`;

    // data-api-url обязателен: track.js хостится на отдельном CDN-домене (apps/sdk,
    // см. CDN_URL), а не на одном origin с API — без него browser.ts не знает, куда стучаться.
    const snippet = `<!-- TrafficCRM Tracking -->
<script src="${process.env.CDN_URL}/track.js"
        data-project-id="${project.publicToken}"
        data-api-url="${apiUrl}"
        async>
</script>`;

    const apiExample = `// Server-side (Node.js) — npm install @trafficcrm/sdk
const { TrackClient } = require('@trafficcrm/sdk');

const track = new TrackClient({
  projectId: '${project.id}',
  secretKey: '${project.secretKey}',  // KEEP SECRET!
  apiUrl: '${apiUrl}',
});

// Track purchase
await track.purchase(99.00, 'USD', {
  orderId: 'order_123',
  email: customer.email,
});`;

    // REST напрямую (без npm-пакета) — для языков без отдельного SDK. Подпись и
    // формат тела зеркалят apps/api/src/modules/tracking/tracking.controller.ts
    // (trackServerEvent) ровно — это рабочий, проверенный живым тестом контракт.
    const phpExample = `<?php
$secretKey = '${project.secretKey}'; // KEEP SECRET!
$projectId = '${project.id}';
$timestamp = (string)(round(microtime(true) * 1000));

$body = json_encode([
    'eventName' => 'Purchase',
    'value' => 99.00,
    'currency' => 'USD',
    'orderId' => 'order_123',
]);

$signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secretKey);

$ch = curl_init('${apiUrl}/track/server/' . $projectId . '/event');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "X-Signature: {$signature}",
        "X-Timestamp: {$timestamp}",
    ],
]);
curl_exec($ch);`;

    const pythonExample = `import hmac, hashlib, json, time, requests

secret_key = '${project.secretKey}'  # KEEP SECRET!
project_id = '${project.id}'
timestamp = str(int(time.time() * 1000))

body = json.dumps({
    'eventName': 'Purchase',
    'value': 99.00,
    'currency': 'USD',
    'orderId': 'order_123',
})

signature = 'sha256=' + hmac.new(
    secret_key.encode(),
    f'{timestamp}.{body}'.encode(),
    hashlib.sha256,
).hexdigest()

requests.post(
    '${apiUrl}/track/server/' + project_id + '/event',
    headers={
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
    },
    data=body,
)`;

    return { snippet, apiExample, phpExample, pythonExample, publicToken: project.publicToken };
  }

  async getOverview(id: string, companyId: string, days = 30) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const since = subDays(new Date(), days);
    // Часовой пояс проекта (запрос пользователя 2026-07-04) — "сутки" на графике событий
    // считаются по нему, не по UTC, см. common/timezone.util.ts.
    const eventBucket = dailyBucketSql('eventTime', project.timezone);

    const [totalClients, newClients, totalRevenue, eventsByDay] = await Promise.all([
      this.prisma.client.count({ where: { projectId: id, deletedAt: null } }),

      this.prisma.client.count({
        where: { projectId: id, deletedAt: null, createdAt: { gte: since } },
      }),

      this.prisma.purchase.aggregate({
        where: { projectId: id },
        _sum: { amount: true },
      }),

      // ::int — Postgres COUNT(*) иначе возвращает bigint, а JSON.stringify не умеет
      // сериализовать BigInt (падало 500-кой "Do not know how to serialize a BigInt",
      // найдено при проверке багрепорта про число подписчиков 2026-07-03). Число событий
      // в проекте за день никогда не подойдёт к переполнению int4.
      this.prisma.$queryRaw`
        SELECT
          ${eventBucket} as date,
          "eventName",
          COUNT(*)::int as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${id}
          AND "eventTime" >= ${since}
        GROUP BY date, "eventName"
        ORDER BY date ASC
      `,
    ]);

    return {
      totalClients,
      newClients,
      totalRevenue: totalRevenue._sum.amount || 0,
      eventsByDay,
    };
  }

  // Разбивка по рекламе/кампании (запрос пользователя 2026-07-04, трекинг-ссылки лендинга
  // "получить ссылку" с ad_id/campaign_id из макросов Facebook/TikTok) — те же 5 стадий, что
  // ClientsRepository.getConversionFunnel, с доп. фильтром по campaignId/adId. PageView/Lead/
  // Purchase считаются по TrackingEvent, Subscribe/Dialogue — по колонкам Client (тот же
  // паттерн, каким уже чинили задвоенный счёт Subscribe, см. память
  // feedback_conversion_funnel_subscribe_bug — только эти два события пишутся в двух местах
  // и рискуют задвоиться, Purchase так не пишется, поэтому остаётся TrackingEvent-based, как
  // и в самой воронке).
  // buyerId (запрос пользователя 2026-08-03, "только своя стата") — комбинации кампании и все
  // метрики внутри цикла ниже скоупятся: без этого скоуп-баер видел бы чужие кампании с честными
  // нулями по всем полям, а не своих.
  // Группировка ПО КАМПАНИИ, не по кампания+объявление (запрос пользователя 2026-08-04:
  // "должен показывать только имя кампании, не все объявления") — раньше одна кампания с
  // несколькими объявлениями превращалась в N строк, что на практике читалось как "слишком
  // много строк, не видно общей картины по кампании". adId/adName полностью убраны из
  // discovery/scope/ответа этого метода — единственные два потребителя (classic/Studio
  // страница проекта) больше нигде их не используют.
  async getAdBreakdown(id: string, companyId: string, periodQuery: StatsPeriodDto, buyerId?: string) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);
    const buyerWhere = buyerId ? { buyerId } : {};

    const [eventCampaigns, clientCampaigns] = await Promise.all([
      this.prisma.trackingEvent.findMany({
        where: { projectId: id, campaignId: { not: null }, ...buyerWhere },
        select: { campaignId: true, campaignName: true },
        distinct: ['campaignId'],
      }),
      this.prisma.client.findMany({
        where: { projectId: id, deletedAt: null, campaignId: { not: null }, ...buyerWhere },
        select: { campaignId: true, campaignName: true },
        distinct: ['campaignId'],
      }),
    ]);

    const campaigns = new Map<string, { campaignId: string; campaignName: string | null }>();
    for (const c of [...eventCampaigns, ...clientCampaigns]) {
      if (!campaigns.has(c.campaignId!)) campaigns.set(c.campaignId!, c as { campaignId: string; campaignName: string | null });
    }

    const breakdown = await Promise.all(
      Array.from(campaigns.values()).map(async (campaign) => {
        // buyerId в scope покрывает разом trackingEvent.count (PageView/Lead/Purchase) и
        // client.count (subscribes) — обе модели несут свою колонку buyerId напрямую.
        const scope = { campaignId: campaign.campaignId, ...buyerWhere };
        const [pageViews, leads, subscribes, dialogueRows, purchases] = await Promise.all([
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'PageView', createdAt: { gte: since, lt: until }, ...scope } }),
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'Lead', createdAt: { gte: since, lt: until }, ...scope } }),
          this.prisma.client.count({ where: { projectId: id, deletedAt: null, subscribedAt: { gte: since, lt: until }, ...scope } }),
          // CRM-диалог, не любой (тот же баг/фикс, что и в ClientsRepository.getConversionFunnel
          // — см. комментарий там) — здесь campaignId уже сам по себе отсекает большинство
          // холодных контактов (у них обычно нет campaignId, он появляется только через
          // трекинг-ссылку лендинга), но не все: клиент мог посетить лендинг с рекламной
          // меткой, так и не подписаться, и потом написать боту напрямую.
          this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) as count
            FROM "Client"
            WHERE "projectId" = ${id}
              AND "deletedAt" IS NULL
              AND "campaignId" = ${campaign.campaignId}
              AND "firstDialogueAt" >= ${since}
              AND "firstDialogueAt" < ${until}
              AND "subscribedAt" IS NOT NULL
              AND "subscribedAt" <= "firstDialogueAt"
              ${buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty}
          `,
          this.prisma.trackingEvent.count({ where: { projectId: id, eventName: 'Purchase', createdAt: { gte: since, lt: until }, ...scope } }),
        ]);
        const dialogues = Number(dialogueRows[0]?.count ?? 0);

        return {
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          pageViews,
          leads,
          subscribes,
          dialogues,
          purchases,
          cr: pageViews ? Math.round((purchases / pageViews) * 100 * 10) / 10 : 0,
        };
      }),
    );

    return breakdown.sort((a, b) => b.pageViews - a.pageViews);
  }

  // Топ-5 лидербордов на обзоре проекта (запрос пользователя 2026-07-17: "топ баеров, топ
  // пикселей, топ лэндингов, топ кампаний") — все 4 в одном эндпоинте, чтобы страница делала
  // один запрос вместо четырёх. buyers/campaigns считаются join'ом Client->Purchase (тот же
  // паттерн, что TeamService.getBuyerAnalytics уже использует для компании целиком, здесь —
  // в рамках одного проекта + с периодом); landings — join Landing->Client->Purchase;
  // pixels — по TrackingEvent.pixelId by conversions (без revenue: Purchase не хранит pixelId,
  // а парсить сумму из TrackingEvent.payload ради лидерборда избыточно).
  // Багфикс 2026-07-28 (баг-репорт пользователя: "есть человек пришедший с пикселя, но в топ
  // пикселей этого пикселя нет"). Причина: "buyers" и "pixels" считались через
  // groupBy/INNER-JOIN НАЧИНАЯ С Purchase — если у баера/пикселя ещё ни одной покупки, строка
  // в результате вообще не появляется, независимо от того, сколько у него реальных подписанных
  // клиентов. "landings" и "campaigns" уже были устроены правильно — LEFT JOIN, начиная с самой
  // сущности (Landing/Client.campaignId), поэтому 0 revenue/подписчиков не прячет строку целиком.
  // buyers/pixels переписаны на тот же LEFT-JOIN-от-сущности паттерн. Заодно "campaigns.clients"
  // считался БЕЗ фильтра по периоду (в отличие от landings.subscribers, который period-scoped) —
  // теперь везде одинаково: "clients"/"subscribers" = новые подписчики ИМЕННО за period, а не
  // все подписчики за всё время.
  // buyerId (запрос пользователя 2026-08-03, "только своя стата") — скоупит pixels/landings/
  // campaigns на клиентов ИМЕННО этого баера ("какие из МОИХ лендингов/пикселей/кампаний
  // конвертят лучше" — реально полезная информация, не заглушка). "buyers" (ранжирование ПРОТИВ
  // других баеров) при активном скоупе всегда обнуляется контроллером — см.
  // ProjectsController.getLeaderboards — ранжировать одного человека относительно самого себя
  // бессмысленно, поэтому здесь она считается как обычно (просто не используется в этом случае).
  async getLeaderboards(id: string, companyId: string, periodQuery: StatsPeriodDto, buyerId?: string) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);
    const buyerFilterSql = buyerId ? Prisma.sql`AND c."buyerId" = ${buyerId}` : Prisma.empty;

    const [buyerRows, users, pixelRows, landingRows, campaignRows] = await Promise.all([
      this.prisma.$queryRaw<{ buyerId: string; clients: bigint; revenue: string | null }[]>`
        SELECT c."buyerId",
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= ${since} AND c."subscribedAt" < ${until}) as clients,
          COALESCE(SUM(p.amount) FILTER (WHERE p."createdAt" >= ${since} AND p."createdAt" < ${until}), 0) as revenue
        FROM "Client" c
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE c."projectId" = ${id} AND c."deletedAt" IS NULL AND c."buyerId" IS NOT NULL
        GROUP BY c."buyerId"
        ORDER BY revenue DESC, clients DESC
        LIMIT 5
      `,
      this.prisma.user.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.$queryRaw<{ pixelId: string; label: string | null; platform: string; clients: bigint; revenue: string | null }[]>`
        SELECT tp.id as "pixelId", tp.label, tp.platform,
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= ${since} AND c."subscribedAt" < ${until}) as clients,
          COALESCE(SUM(p.amount) FILTER (WHERE p."createdAt" >= ${since} AND p."createdAt" < ${until}), 0) as revenue
        FROM "TrackingPixel" tp
        LEFT JOIN "Client" c ON c."pixelId" = tp.id AND c."deletedAt" IS NULL ${buyerFilterSql}
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE tp."projectId" = ${id}
        GROUP BY tp.id, tp.label, tp.platform
        ORDER BY revenue DESC, clients DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<{ landing_id: string; name: string; subscribers: bigint; revenue: string | null }[]>`
        SELECT l.id as landing_id, l.name,
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= ${since} AND c."subscribedAt" < ${until}) as subscribers,
          COALESCE(SUM(p.amount) FILTER (WHERE p."createdAt" >= ${since} AND p."createdAt" < ${until}), 0) as revenue
        FROM "Landing" l
        LEFT JOIN "Client" c ON c."landingId" = l.id AND c."deletedAt" IS NULL ${buyerFilterSql}
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE l."projectId" = ${id} AND l."deletedAt" IS NULL
        GROUP BY l.id, l.name
        ORDER BY revenue DESC, subscribers DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<{ campaignId: string; campaignName: string | null; clients: bigint; revenue: string | null }[]>`
        SELECT c."campaignId", MAX(c."campaignName") as "campaignName",
          COUNT(DISTINCT c.id) FILTER (WHERE c."subscribedAt" >= ${since} AND c."subscribedAt" < ${until}) as clients,
          COALESCE(SUM(p.amount) FILTER (WHERE p."createdAt" >= ${since} AND p."createdAt" < ${until}), 0) as revenue
        FROM "Client" c
        LEFT JOIN "Purchase" p ON p."clientId" = c.id
        WHERE c."projectId" = ${id} AND c."deletedAt" IS NULL AND c."campaignId" IS NOT NULL
          ${buyerFilterSql}
        GROUP BY c."campaignId"
        ORDER BY revenue DESC, clients DESC
        LIMIT 5
      `,
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));

    return {
      buyers: buyerRows.map((r) => {
        const user = usersById.get(r.buyerId);
        return {
          buyerId: r.buyerId,
          name: user ? `${user.firstName} ${user.lastName}`.trim() : 'Удалённый пользователь',
          clients: Number(r.clients),
          revenue: Number(r.revenue || 0),
        };
      }),
      pixels: pixelRows.map((r) => ({
        pixelId: r.pixelId,
        label: r.label || r.platform,
        clients: Number(r.clients),
        revenue: Number(r.revenue || 0),
      })),
      landings: landingRows.map((r) => ({
        landingId: r.landing_id,
        name: r.name,
        subscribers: Number(r.subscribers),
        revenue: Number(r.revenue || 0),
      })),
      campaigns: campaignRows.map((r) => ({
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        clients: Number(r.clients),
        revenue: Number(r.revenue || 0),
      })),
    };
  }

  // Развёрнутая воронка (PageView→Lead→Subscribe→Dialogue→Purchase) для конкретных top-5 id
  // одной категории лидерборда (запрос пользователя 2026-07-27: "показывай и просмотры,
  // диалоги, выручка, клики и конверсии из каждой в следующую"). Намеренно ОТДЕЛЬНЫЙ,
  // лениво подгружаемый эндпоинт, а не расширение getLeaderboards — считать это для всех 4
  // категорий на каждой загрузке страницы проекта заметно утяжелило бы её самый частый путь
  // (обычный визит), хотя реально разворачивает эти цифры меньшинство визитов. Фронт зовёт
  // этот метод только когда пользователь реально открыл конкретную вкладку лидерборда (см.
  // projects/[id]/page.tsx, activeLeaderboardTab) — ids уже известны на фронте из уже
  // загруженного getLeaderboards, повторный запрос "какие 5 топовых" не нужен.
  async getLeaderboardFunnel(
    id: string,
    companyId: string,
    category: 'buyers' | 'pixels' | 'landings' | 'campaigns',
    ids: string[],
    periodQuery: StatsPeriodDto,
    buyerId?: string,
  ) {
    const project = await this.findOne(id, companyId); // проверка владения + 404
    const { since, until } = await resolveStatsPeriod(this.prisma, project.timezone, periodQuery);
    if (ids.length === 0) return { items: [] };

    if (category === 'landings') return { items: await this.getLandingsFunnel(id, ids, since, until, buyerId) };
    if (category === 'pixels') return { items: await this.getEventColumnFunnel('pixelId', id, ids, since, until, buyerId) };
    if (category === 'campaigns') return { items: await this.getEventColumnFunnel('campaignId', id, ids, since, until, buyerId) };
    return { items: await this.getBuyersFunnel(id, ids, since, until) };
  }

  // PageView/Lead лендинга живут только в TrackingEvent.payload (JSON, см. computeLandingStats
  // в LandingsService — тот же источник, что уже используется на странице статистики самого
  // лендинга). Subscribe/Dialogue надёжнее брать из Client.landingId напрямую: TrackingEvent на
  // Subscribe несёт landingId только для PRIVATE_CHANNEL_REQUEST (см. RecordEventDto.landingId),
  // а Client.landingId проставляется единообразно для всех режимов канала.
  private async getLandingsFunnel(projectId: string, ids: string[], since: Date, until: Date, buyerId?: string) {
    // payload->>'landingId' — PageView/Lead ещё не несли buyerId колонкой (только payload) до
    // 2026-08-03; теперь buyerId — реальная колонка TrackingEvent, фильтруем ей напрямую.
    const eventBuyerSql = buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty;
    const clientBuyerSql = buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty;
    const purchaseBuyerSql = buyerId ? Prisma.sql`AND c."buyerId" = ${buyerId}` : Prisma.empty;
    const [eventRows, clientRows, purchaseRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; eventName: string; count: number }[]>`
        SELECT payload->>'landingId' as id, "eventName", COUNT(*)::int as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${projectId} AND "eventName" IN ('PageView', 'Lead')
          AND "createdAt" >= ${since} AND "createdAt" < ${until}
          AND payload->>'landingId' IN (${Prisma.join(ids)})
          ${eventBuyerSql}
        GROUP BY payload->>'landingId', "eventName"
      `,
      this.prisma.$queryRaw<{ id: string; subscribes: number; dialogues: number }[]>`
        SELECT "landingId" as id,
          COUNT(*) FILTER (WHERE "subscribedAt" >= ${since} AND "subscribedAt" < ${until})::int as subscribes,
          COUNT(*) FILTER (WHERE "firstDialogueAt" >= ${since} AND "firstDialogueAt" < ${until})::int as dialogues
        FROM "Client"
        WHERE "landingId" IN (${Prisma.join(ids)}) AND "deletedAt" IS NULL
          ${clientBuyerSql}
        GROUP BY "landingId"
      `,
      // deletedAt IS NULL добавлен тем же баг-фиксом, что и getBuyersFunnel/getProjectStats ниже
      // (2026-08-05, проект Isabella Ramirez: "выручка 99, топ лендингов суммарно 94") — покупка
      // мягко удалённого (объединённого как дубликат) клиента продолжала считаться в выручке
      // лендинга, хотя строкой выше clientRows уже фильтрует таких клиентов корректно.
      this.prisma.$queryRaw<{ id: string; purchases: number; revenue: string | null }[]>`
        SELECT c."landingId" as id, COUNT(p.id)::int as purchases, COALESCE(SUM(p.amount), 0) as revenue
        FROM "Purchase" p
        JOIN "Client" c ON c.id = p."clientId"
        WHERE c."landingId" IN (${Prisma.join(ids)}) AND c."deletedAt" IS NULL
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          ${purchaseBuyerSql}
        GROUP BY c."landingId"
      `,
    ]);

    const eventsById = this.groupEventCounts(eventRows);
    const clientsById = new Map(clientRows.map((r) => [r.id, r]));
    const purchasesById = new Map(purchaseRows.map((r) => [r.id, r]));

    return ids.map((id) => ({
      id,
      pageViews: eventsById.get(id)?.PageView ?? 0,
      leads: eventsById.get(id)?.Lead ?? 0,
      subscribes: clientsById.get(id)?.subscribes ?? 0,
      dialogues: clientsById.get(id)?.dialogues ?? 0,
      purchases: purchasesById.get(id)?.purchases ?? 0,
      revenue: Number(purchasesById.get(id)?.revenue ?? 0),
    }));
  }

  // Пиксели и кампании — структурно один и тот же запрос, отличается только колонка. В отличие
  // от лендингов, pixelId/campaignId — реальные колонки TrackingEvent, заполняются
  // (resolveAttribution в TrackingService) для ЛЮБОГО события с известным clientId, включая
  // Subscribe/Dialogue — поэтому здесь вся воронка берётся из TrackingEvent единообразно, без
  // отдельного захода в Client. column — фиксированный union из вызывающего кода (не
  // пользовательский ввод), Prisma.raw безопасен.
  private async getEventColumnFunnel(
    column: 'pixelId' | 'campaignId',
    projectId: string,
    ids: string[],
    since: Date,
    until: Date,
    buyerId?: string,
  ) {
    const col = Prisma.raw(`"${column}"`);
    const eventBuyerSql = buyerId ? Prisma.sql`AND "buyerId" = ${buyerId}` : Prisma.empty;
    const purchaseBuyerSql = buyerId ? Prisma.sql`AND c."buyerId" = ${buyerId}` : Prisma.empty;
    const [eventRows, purchaseRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; eventName: string; count: number }[]>`
        SELECT ${col} as id, "eventName", COUNT(*)::int as count
        FROM "TrackingEvent"
        WHERE "projectId" = ${projectId} AND "eventName" IN ('PageView', 'Lead', 'Subscribe', 'Dialogue')
          AND "createdAt" >= ${since} AND "createdAt" < ${until}
          AND ${col} IN (${Prisma.join(ids)})
          ${eventBuyerSql}
        GROUP BY ${col}, "eventName"
      `,
      // projectId добавлен тем же баг-фиксом, что и getBuyersFunnel выше (2026-08-05) —
      // campaignId — внешний ID рекламной площадки, не гарантированно уникален внутри одной
      // компании между разными проектами (например, одна кампания может вести на несколько
      // разных проектов/каналов) — без явного projectId сумма покупок молча растекалась бы по
      // всем проектам компании с тем же campaignId, тот же класс бага, что уже был у buyers.
      // deletedAt IS NULL добавлен отдельным баг-фиксом того же дня (проект Isabella Ramirez) —
      // покупка мягко удалённого клиента иначе продолжает считаться здесь.
      this.prisma.$queryRaw<{ id: string; purchases: number; revenue: string | null }[]>`
        SELECT c.${col} as id, COUNT(p.id)::int as purchases, COALESCE(SUM(p.amount), 0) as revenue
        FROM "Purchase" p
        JOIN "Client" c ON c.id = p."clientId"
        WHERE c.${col} IN (${Prisma.join(ids)}) AND c."projectId" = ${projectId} AND c."deletedAt" IS NULL
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          ${purchaseBuyerSql}
        GROUP BY c.${col}
      `,
    ]);

    const eventsById = this.groupEventCounts(eventRows);
    const purchasesById = new Map(purchaseRows.map((r) => [r.id, r]));

    return ids.map((id) => ({
      id,
      pageViews: eventsById.get(id)?.PageView ?? 0,
      leads: eventsById.get(id)?.Lead ?? 0,
      subscribes: eventsById.get(id)?.Subscribe ?? 0,
      dialogues: eventsById.get(id)?.Dialogue ?? 0,
      purchases: purchasesById.get(id)?.purchases ?? 0,
      revenue: Number(purchasesById.get(id)?.revenue ?? 0),
    }));
  }

  // Без PageView/Lead — эта воронка ("топ баеров" ПРОТИВ друг друга) осталась как была, только
  // Subscribe/Dialogue/Purchase (Client.buyerId). Уточнение 2026-08-03: TrackingEvent.buyerId
  // теперь реальная колонка (см. TrackingService.resolveAttribution) — просмотры/клики баеру
  // технически ужЕ приписываются (см. getLandingsFunnel/getEventColumnFunnel/getAdBreakdown
  // выше), это НЕ архитектурное ограничение. Здесь просто не добавлено намеренно — категория
  // "buyers" ранжирует баеров друг против друга, добавление pageViews/leads сюда — отдельная
  // задача, не запрошенная в рамках "только свои клиенты".
  // Баг-репорт пользователя 2026-08-05 (расхождение выручки на странице проекта — разворот
  // строки баера в "Топ баеров" показывал $701/11 покупок, реальная цифра по ЭТОМУ проекту —
  // $129/1 покупка) — обе SQL ниже фильтровали только по buyerId, без projectId вообще: баер
  // мог работать на несколько проектов компании, и обе агрегации молча суммировали ВСЕ его
  // клиенты/покупки по компании целиком, а не только по проекту, со страницы которого сделан
  // запрос. Тот же класс бага, что уже чинили для buyers/pixels в getLeaderboards выше
  // (INNER-JOIN прятал нулевые строки) — здесь другой механизм (отсутствующий фильтр), тот же
  // симптом "не то число там, где ждёшь".
  private async getBuyersFunnel(projectId: string, ids: string[], since: Date, until: Date) {
    const [clientRows, purchaseRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; subscribes: number; dialogues: number }[]>`
        SELECT "buyerId" as id,
          COUNT(*) FILTER (WHERE "subscribedAt" >= ${since} AND "subscribedAt" < ${until})::int as subscribes,
          COUNT(*) FILTER (WHERE "firstDialogueAt" >= ${since} AND "firstDialogueAt" < ${until})::int as dialogues
        FROM "Client"
        WHERE "buyerId" IN (${Prisma.join(ids)}) AND "projectId" = ${projectId} AND "deletedAt" IS NULL
        GROUP BY "buyerId"
      `,
      // deletedAt IS NULL добавлен отдельным баг-фиксом того же дня (2026-08-05, проект Isabella
      // Ramirez: "выручка 99, а в топ баеров сумма 94") — clientRows выше уже фильтрует мягко
      // удалённых клиентов корректно, а эта, вторая, покупка-агрегация — нет, из-за чего покупка
      // объединённого-как-дубликат клиента продолжала считаться в развороте баера.
      this.prisma.$queryRaw<{ id: string; purchases: number; revenue: string | null }[]>`
        SELECT c."buyerId" as id, COUNT(p.id)::int as purchases, COALESCE(SUM(p.amount), 0) as revenue
        FROM "Purchase" p
        JOIN "Client" c ON c.id = p."clientId"
        WHERE c."buyerId" IN (${Prisma.join(ids)}) AND c."projectId" = ${projectId} AND c."deletedAt" IS NULL
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
        GROUP BY c."buyerId"
      `,
    ]);

    const clientsById = new Map(clientRows.map((r) => [r.id, r]));
    const purchasesById = new Map(purchaseRows.map((r) => [r.id, r]));

    return ids.map((id) => ({
      id,
      subscribes: clientsById.get(id)?.subscribes ?? 0,
      dialogues: clientsById.get(id)?.dialogues ?? 0,
      purchases: purchasesById.get(id)?.purchases ?? 0,
      revenue: Number(purchasesById.get(id)?.revenue ?? 0),
    }));
  }

  private groupEventCounts(rows: { id: string; eventName: string; count: number }[]): Map<string, Record<string, number>> {
    const byId = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = byId.get(r.id) ?? {};
      m[r.eventName] = r.count;
      byId.set(r.id, m);
    }
    return byId;
  }

  // Логи доставки в пиксели (запрос пользователя 2026-07-04) — "что отправлялось платформе
  // трафика и статус". TrackingEventDelivery уже существовал (создавался в TrackingProcessor
  // для КАЖДОЙ пары событие+пиксель), просто нигде не показывался в UI до сих пор.
  // requestPayload/responsePayload (запрос пользователя 2026-07-28: "сделай как у конкурентов,
  // полностью с отчётом") — реальное тело запроса к Facebook/TikTok и реальный ответ платформы,
  // персистятся на TrackingEventDelivery с 2026-07-28. access_token пикселя в НИХ никогда не
  // попадает (FB: отдельное поле body, не входит в eventData; TikTok: HTTP-заголовок, не body) —
  // но для includeCurlCommand (см. ниже) он подставляется на лету, читается из TrackingPixel
  // напрямую, никогда не персистится вместе с логами.
  //
  // PageView/Lead исключены из выдачи безусловно (запрос пользователя 2026-07-29, "убери со
  // страницы логов пикселей pageview и lead, чтобы визуально не мешали") — это самые частые
  // события (на каждый заход на лендинг), они забивают список и прячут реально важные
  // Subscribe/Unsubscribe/Dialogue/Purchase. Не просто фильтр по умолчанию — исключение всегда
  // активно, независимо от filters.eventName.
  async getPixelLogs(
    id: string,
    companyId: string,
    filters: { page?: number; limit?: number; pixelId?: string; status?: string; eventName?: string },
    includeCurlCommand = false,
  ) {
    await this.findOne(id, companyId); // проверка владения + 404

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);

    const where: Prisma.TrackingEventDeliveryWhereInput = {
      event: {
        projectId: id,
        eventName: filters.eventName ? filters.eventName : { notIn: ['PageView', 'Lead'] },
      },
      ...(filters.pixelId ? { pixelId: filters.pixelId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.trackingEventDelivery.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          error: true,
          externalEventId: true,
          sentAt: true,
          requestPayload: true,
          responsePayload: true,
          httpStatus: true,
          pixel: {
            select: {
              id: true,
              platform: true,
              label: true,
              pixelId: true,
              ...(includeCurlCommand ? { accessToken: true, testEventCode: true } : {}),
            },
          },
          event: {
            select: {
              eventName: true,
              eventTime: true,
              payload: true,
              adId: true,
              adName: true,
              campaignId: true,
              campaignName: true,
            },
          },
        },
      }),
      this.prisma.trackingEventDelivery.count({ where }),
    ]);

    // curlCommand — готовая команда с настоящим access_token, чтобы можно было вставить прямо в
    // терминал (запрос пользователя 2026-07-29, доступ только у OWNER — includeCurlCommand
    // приходит из контроллера уже проверенным по роли). Строится на лету из уже сохранённого
    // requestPayload — если его нет (запись до 2026-07-28, требование логов ещё не было), curl
    // не собрать, поле просто не добавляется.
    const itemsWithCurl = includeCurlCommand
      ? items.map((item) => {
          const pixel = item.pixel as typeof item.pixel & { accessToken?: string; testEventCode?: string | null };
          if (!item.requestPayload || !pixel.accessToken) return item;
          const curlCommand = buildPixelCurlCommand(pixel.platform, pixel.pixelId, pixel.accessToken, item.requestPayload, pixel.testEventCode);
          const { accessToken: _accessToken, testEventCode: _testEventCode, ...pixelWithoutToken } = pixel;
          return { ...item, pixel: pixelWithoutToken, curlCommand };
        })
      : items;

    return { items: itemsWithCurl, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Управление операторами проекта (запрос пользователя 2026-07-31) — доступ Operator к
  // проекту больше не назначается один раз при создании участника, а выдаётся/снимается
  // отдельно, здесь. Живёт в ProjectsService, а не в TeamService, т.к. точка входа — карточка
  // проекта, не /team; переиспользует те же team-role.util хелперы, что и /team.
  private async assertCanManageProjectOperators(projectId: string, companyId: string, requesterId: string, requesterRole: UserRole): Promise<void> {
    await this.findOne(projectId, companyId); // 404, если проект не в этой компании
    assertCanAccessTeamManagement(requesterRole);
    await assertOperatorAdminScope(this.prisma, requesterId, requesterRole, UserRole.OPERATOR, [projectId]);
  }

  async listProjectOperators(projectId: string, companyId: string, requesterId: string, requesterRole: UserRole) {
    await this.assertCanManageProjectOperators(projectId, companyId, requesterId, requesterRole);
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null, role: UserRole.OPERATOR, projectAccess: { some: { projectId } } },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Company-wide, НЕ сужено до пересечения с проектами Оператор-админа (подтверждено
  // AskUserQuestion 2026-07-31: иначе только что созданного оператора с 0 проектов ему было
  // бы неоткуда взять) — только имя/email, без деталей доступа к другим проектам.
  async listOperatorCandidates(projectId: string, companyId: string, requesterId: string, requesterRole: UserRole) {
    await this.assertCanManageProjectOperators(projectId, companyId, requesterId, requesterRole);
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null, role: UserRole.OPERATOR, projectAccess: { none: { projectId } } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { firstName: 'asc' },
    });
  }

  async addOperatorToProject(projectId: string, companyId: string, requesterId: string, requesterRole: UserRole, userId: string): Promise<void> {
    await this.assertCanManageProjectOperators(projectId, companyId, requesterId, requesterRole);
    const target = await this.prisma.user.findFirst({ where: { id: userId, companyId, deletedAt: null, role: UserRole.OPERATOR } });
    if (!target) throw new BadRequestException('Пользователь не найден или не является оператором');

    await this.prisma.projectAccess.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId },
      update: {},
    });
    // Фиксированный дефолтный набор роли, без ручной настройки (запрос пользователя
    // 2026-07-31: "убираем у операторов разрешения как они до этого давались") — не
    // перезаписывает уже существующие права, если оператора когда-то уже добавляли сюда.
    await this.permissionsService.seedDefaultsIfEmpty(userId, projectId, UserRole.OPERATOR);
  }

  async removeOperatorFromProject(projectId: string, companyId: string, requesterId: string, requesterRole: UserRole, userId: string): Promise<void> {
    await this.assertCanManageProjectOperators(projectId, companyId, requesterId, requesterRole);
    const target = await this.prisma.user.findFirst({ where: { id: userId, companyId, deletedAt: null, role: UserRole.OPERATOR } });
    if (!target) throw new BadRequestException('Пользователь не найден или не является оператором');

    // Та же дисциплина очистки, что и в TeamService.update — не оставлять осиротевшие
    // UserPermission-строки, иначе повторное добавление того же оператора на этот же проект
    // тихо воскресит старый набор прав в обход seedDefaultsIfEmpty.
    await this.prisma.$transaction([
      this.prisma.projectAccess.deleteMany({ where: { userId, projectId } }),
      this.prisma.userPermission.deleteMany({ where: { userId, projectId } }),
    ]);
  }
}
