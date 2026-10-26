import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, ChatStatus, ConversationSource, Permission, Prisma, UserRole } from '@prisma/client';
import { GrammyError } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ChatOutgoingFile, TelegramProvider } from '../channels/providers/telegram.provider';
import { TelegramPersonalService } from '../channels/providers/telegram-personal.service';
import { ExtraBotsService } from '../channels/extra-bots.service';
import { ChatStoreService } from './chat-store.service';
import { anonymousLeadName, isAnonymousOperator } from '../../common/anonymous-operator.util';
import { TranslationService } from '../translation/translation.service';

const CONVERSATIONS_PAGE = 30;
const MESSAGES_PAGE = 50;
// Закреплённых диалогов у сотрудника — не больше (как в Telegram у обычного списка чатов).
export const MAX_PINS = 20;

export interface ConversationListFilters {
  projectId?: string;
  source?: ConversationSource;
  unread?: boolean;
  search?: string;
  before?: string; // lastMessageAt последнего диалога предыдущей страницы
  // Ответственный (2026-10-25): 'none' — без ответственного, 'me' — мои, иначе id оператора.
  assignee?: string;
  // Вкладки и фильтры как в Chatterfy (2026-10-25).
  tab?: ChatTab;
  tagIds?: string[];
  from?: string; // дата начала диалога, ISO
  to?: string;
  purchase?: 'yes' | 'no';
  // Источник трафика лида (2026-10-26): FB/TT по клику рекламы, 'none' — без метки.
  traffic?: 'FB' | 'TT' | 'none';
  // Своё поле лида (2026-10-25): id поля и искомое значение (часть текста или вариант списка).
  fieldId?: string;
  fieldValue?: string;
  // Этап лида (2026-10-25): id этапа или 'none' — без этапа.
  stage?: string;
}

export const CHAT_TABS = ['all', 'unread', 'unanswered', 'waiting', 'finished', 'favorites', 'blocked'] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

export interface ConversationRow {
  id: string;
  projectId: string;
  projectName: string;
  clientId: string | null;
  peerId: string;
  // '' — основной бот проекта, иначе id дополнительного бота (2026-10-24); botUsername — его @.
  botKey: string;
  botUsername: string | null;
  peerFirstName: string | null;
  peerLastName: string | null;
  peerUsername: string | null;
  lastMessageAt: Date;
  lastMessageText: string | null;
  lastMessageDirection: 'IN' | 'OUT' | null;
  unreadCount: number;
  lastError: string | null;
  hasAvatar: boolean;
  hasPurchase: boolean | null;
  isBotActive: boolean | null;
  assignedUserId: string | null;
  assigneeFirstName: string | null;
  assigneeLastName: string | null;
  status: ChatStatus;
  stageId: string | null;
  // Площадка лида по клику рекламы (2026-10-26, видна всем, кто видит чат — решение пользователя):
  // только FB/TT, без кампаний и объявлений. Та же логика, что в «Топ источников».
  trafficSource: 'FB' | 'TT' | null;
}

// Встроенный чат (запрос пользователя 2026-10-23). Доступ (2026-10-24: «убери чаты у баеров…
// видят админ и операторы только чат лички, или бота, или оба»):
// - BUYER — чатов нет вовсе;
// - OWNER/SUPER_ADMIN — все проекты компании, оба источника;
// - ADMIN — все проекты компании (как и везде в системе), источники по User.chatAccess;
// - OPERATOR_ADMIN/OPERATOR — только проекты с ProjectAccess, источники по User.chatAccess.
// Отвечать может тот, кто видит диалог; OPERATOR — если у него есть ещё и CLIENTS_EDIT на проекте.
const ALL_PROJECT_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];
const ALL_SOURCES: ConversationSource[] = ['BOT', 'PERSONAL'];

interface ChatResourceRef {
  projectId: string;
  source: ConversationSource;
  botKey: string;
}

interface ChatScope {
  projectIds: string[];
  sources: ConversationSource[];
  // Только для OPERATOR (2026-10-24): точные чаты, назначенные ему (ChatResourceAccess). Для
  // остальных ролей не задано — видны все чаты разрешённых источников в их проектах.
  resources?: ChatResourceRef[];
  // Только для OPERATOR (2026-10-25): плюс отдельные диалоги, которые тимлид/админ передал ему
  // (Conversation.assignedUserId) — в проектах, где у него есть доступ. pairs — где они есть,
  // для списка проектов чата.
  assigned?: { userId: string; projectIds: string[]; pairs: { projectId: string; source: ConversationSource }[] };
}

// 'BOT' — основной бот, 'BOT:<id>' — дополнительный, 'PERSONAL' — личка (ChatResourceAccess.resource).
export function parseChatResource(resource: string): { source: ConversationSource; botKey: string } | null {
  if (resource === 'BOT') return { source: 'BOT', botKey: '' };
  if (resource === 'PERSONAL') return { source: 'PERSONAL', botKey: '' };
  if (resource.startsWith('BOT:') && resource.length > 4) return { source: 'BOT', botKey: resource.slice(4) };
  return null;
}

function scopeAllows(
  scope: ChatScope,
  c: { projectId: string; source: ConversationSource; botKey: string; assignedUserId?: string | null },
): boolean {
  if (scope.resources) {
    if (scope.resources.some((r) => r.projectId === c.projectId && r.source === c.source && r.botKey === c.botKey)) return true;
    return !!scope.assigned && c.assignedUserId === scope.assigned.userId && scope.assigned.projectIds.includes(c.projectId);
  }
  return scope.projectIds.includes(c.projectId) && scope.sources.includes(c.source);
}

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService,
    private telegram: TelegramProvider,
    private telegramPersonal: TelegramPersonalService,
    private chatStore: ChatStoreService,
    private extraBots: ExtraBotsService,
    private translation: TranslationService,
  ) {}

  private async chatSourcesFor(user: AuthUser): Promise<ConversationSource[]> {
    if (user.role === UserRole.BUYER) return [];
    if (user.role === UserRole.OWNER || user.role === UserRole.SUPER_ADMIN) return ALL_SOURCES;
    const row = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { chatAccess: true } });
    switch (row?.chatAccess) {
      case 'BOT':
        return ['BOT'];
      case 'PERSONAL':
        return ['PERSONAL'];
      case 'ALL':
        return ALL_SOURCES;
      default:
        return [];
    }
  }

  private async chatScope(companyId: string, user: AuthUser): Promise<ChatScope> {
    // Оператор видит ровно назначенные ему чаты (бот / дополнительный бот / личка) в проектах, где
    // у него есть доступ. Назначают со стороны ресурса — в «Чатах» и в «Подключениях».
    if (user.role === UserRole.OPERATOR) {
      const [rows, projects] = await Promise.all([
        this.prisma.chatResourceAccess.findMany({ where: { companyId, userId: user.userId }, select: { projectId: true, resource: true } }),
        this.prisma.project.findMany({
          where: { companyId, deletedAt: null, projectAccess: { some: { userId: user.userId } } },
          select: { id: true },
        }),
      ]);
      const allowedProjects = new Set(projects.map((p) => p.id));
      const resources = rows
        .filter((r) => allowedProjects.has(r.projectId))
        .map((r) => {
          const parsed = parseChatResource(r.resource);
          return parsed ? { projectId: r.projectId, ...parsed } : null;
        })
        .filter((r): r is ChatResourceRef => !!r);
      // Диалоги, переданные оператору лично (2026-10-25) — только в проектах с его доступом:
      // убрали оператора из проекта — пропадают и назначенные там чаты.
      const assignedPairs = allowedProjects.size
        ? (
            await this.prisma.conversation.groupBy({
              by: ['projectId', 'source'],
              where: { companyId, assignedUserId: user.userId, deletedAt: null, projectId: { in: Array.from(allowedProjects) } },
            })
          ).map((g) => ({ projectId: g.projectId, source: g.source }))
        : [];
      return {
        projectIds: Array.from(new Set([...resources.map((r) => r.projectId), ...assignedPairs.map((a) => a.projectId)])),
        sources: Array.from(new Set([...resources.map((r) => r.source), ...assignedPairs.map((a) => a.source)])),
        resources,
        assigned: { userId: user.userId, projectIds: Array.from(allowedProjects), pairs: assignedPairs },
      };
    }

    const sources = await this.chatSourcesFor(user);
    if (sources.length === 0) return { projectIds: [], sources };
    const projects = await this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(ALL_PROJECT_ROLES.includes(user.role) ? {} : { projectAccess: { some: { userId: user.userId } } }),
      },
      select: { id: true },
    });
    return { projectIds: projects.map((p) => p.id), sources };
  }

  private async scopeSql(companyId: string, user: AuthUser, projectId?: string, source?: ConversationSource): Promise<Prisma.Sql | null> {
    const scope = await this.chatScope(companyId, user);
    if (scope.resources) {
      const resources = scope.resources.filter((r) => (!projectId || r.projectId === projectId) && (!source || r.source === source));
      const assignedProjects = (scope.assigned?.projectIds ?? []).filter((id) => !projectId || id === projectId);
      const parts: Prisma.Sql[] = [];
      if (resources.length) {
        parts.push(Prisma.sql`(c."projectId", c."source"::text, c."botKey") IN (${Prisma.join(resources.map((r) => Prisma.sql`(${r.projectId}, ${r.source}, ${r.botKey})`))})`);
      }
      if (scope.assigned && assignedProjects.length) {
        parts.push(Prisma.sql`(c."assignedUserId" = ${scope.assigned.userId} AND c."projectId" IN (${Prisma.join(assignedProjects)})
          ${source ? Prisma.sql`AND c."source"::text = ${source}` : Prisma.empty})`);
      }
      if (parts.length === 0) return null;
      return Prisma.sql`
        c."companyId" = ${companyId}
        AND c."deletedAt" IS NULL
        AND (${Prisma.join(parts, ' OR ')})
      `;
    }
    const projectIds = projectId ? scope.projectIds.filter((id) => id === projectId) : scope.projectIds;
    const sources = source ? scope.sources.filter((s) => s === source) : scope.sources;
    if (projectIds.length === 0 || sources.length === 0) return null;
    return Prisma.sql`
      c."companyId" = ${companyId}
      AND c."deletedAt" IS NULL
      AND c."projectId" IN (${Prisma.join(projectIds)})
      AND c."source"::text IN (${Prisma.join(sources)})
    `;
  }

  private async canReplyIn(projectId: string, user: AuthUser): Promise<boolean> {
    if (user.role !== UserRole.OPERATOR) return true;
    return this.permissions.hasPermission(user.userId, projectId, user.role, Permission.CLIENTS_EDIT);
  }

  async listConversations(companyId: string, user: AuthUser, filters: ConversationListFilters) {
    const scope = await this.scopeSql(companyId, user, filters.projectId, filters.source);
    if (!scope) return { items: [], hasMore: false };

    const assigneeSql = this.filtersSql(user, filters);

    const anonymous = await isAnonymousOperator(this.prisma, user);
    // Скрытому оператору поиск по имени/@username/ID не даём — иначе по нему можно подобрать личность.
    const search = anonymous ? undefined : filters.search?.trim().replace(/^@/, '');
    const searchSql = search
      ? Prisma.sql`AND (
          c."peerFirstName" ILIKE ${`%${search}%`}
          OR c."peerLastName" ILIKE ${`%${search}%`}
          OR c."peerUsername" ILIKE ${`%${search}%`}
          OR c."peerId" = ${search}
        )`
      : Prisma.empty;

    // Закреплённые (2026-10-25, у каждого свои) — всегда наверху первой страницы, с теми же
    // фильтрами; в основной ленте по времени их нет, поэтому следующие страницы не задваиваются.
    const pinnedSql = Prisma.sql`EXISTS (SELECT 1 FROM "ChatPin" pin WHERE pin."conversationId" = c.id AND pin."userId" = ${user.userId})`;
    const select = (extra: Prisma.Sql, limit: number) => this.prisma.$queryRaw<ConversationRow[]>`
      SELECT c.id, c."projectId", p.name AS "projectName", c."clientId", c."peerId", c."botKey", pb."tgBotUsername" AS "botUsername",
        c."peerFirstName", c."peerLastName", c."peerUsername", c."lastMessageAt",
        c."lastMessageText", c."lastMessageDirection", c."unreadCount", c."lastError",
        (cl."tgPhotoUrl" IS NOT NULL) AS "hasAvatar", cl."hasPurchase", cl."isBotActive",
        c."assignedUserId", au."firstName" AS "assigneeFirstName", au."lastName" AS "assigneeLastName", c."status", c."stageId",
        CASE WHEN cl."fbclid" IS NOT NULL THEN 'FB' WHEN cl."ttclid" IS NOT NULL THEN 'TT' END AS "trafficSource"
      FROM "Conversation" c
      JOIN "Project" p ON p.id = c."projectId"
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      LEFT JOIN "ProjectBot" pb ON c."botKey" <> '' AND pb.id = c."botKey"
      LEFT JOIN "User" au ON au.id = c."assignedUserId"
      WHERE ${scope}
        ${filters.unread ? Prisma.sql`AND c."unreadCount" > 0` : Prisma.empty}
        ${assigneeSql}
        ${searchSql}
        ${extra}
      ORDER BY c."lastMessageAt" DESC
      LIMIT ${limit}
    `;
    const [pinnedRows, rows] = await Promise.all([
      filters.before ? Promise.resolve([] as ConversationRow[]) : select(Prisma.sql`AND ${pinnedSql}`, MAX_PINS),
      select(
        Prisma.sql`AND NOT ${pinnedSql} ${filters.before ? Prisma.sql`AND c."lastMessageAt" < ${new Date(filters.before)}` : Prisma.empty}`,
        CONVERSATIONS_PAGE + 1,
      ),
    ]);
    const pinnedIds = new Set(pinnedRows.map((r) => r.id));
    const items = [...pinnedRows, ...rows.slice(0, CONVERSATIONS_PAGE)];
    const ids = items.map((r) => r.id);
    const [tagRows, favRows] = ids.length
      ? await Promise.all([
          this.prisma.conversationTag.findMany({ where: { conversationId: { in: ids } }, select: { conversationId: true, tag: { select: { id: true, name: true, color: true } } } }),
          this.prisma.chatFavorite.findMany({ where: { userId: user.userId, conversationId: { in: ids } }, select: { conversationId: true } }),
        ])
      : [[], []];
    const favorites = new Set(favRows.map((f) => f.conversationId));
    return {
      items: items.map((r) => ({
        ...(anonymous ? this.maskConversation(r) : r),
        favorite: favorites.has(r.id),
        pinned: pinnedIds.has(r.id),
        tags: tagRows.filter((t) => t.conversationId === r.id).map((t) => t.tag),
      })),
      hasMore: rows.length > CONVERSATIONS_PAGE,
    };
  }

  // «Скрытый оператор» (2026-10-25): без имени, @username, Telegram ID, фото и карточки клиента.
  private maskConversation<T extends { id: string; peerId: string; peerFirstName: string | null; peerLastName: string | null; peerUsername: string | null; clientId: string | null }>(
    c: T,
  ): T {
    return { ...c, peerFirstName: anonymousLeadName(c.id), peerLastName: null, peerUsername: null, peerId: '', clientId: null, ...('hasAvatar' in c ? { hasAvatar: false } : {}) };
  }

  // Ответственный, вкладка и фильтры списка — общие для списка и счётчиков вкладок.
  private filtersSql(user: AuthUser, f: Omit<ConversationListFilters, 'projectId' | 'source' | 'before' | 'search' | 'unread'>, skipTab = false): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (f.assignee === 'none') parts.push(Prisma.sql`AND c."assignedUserId" IS NULL`);
    else if (f.assignee === 'me') parts.push(Prisma.sql`AND c."assignedUserId" = ${user.userId}`);
    else if (f.assignee) parts.push(Prisma.sql`AND c."assignedUserId" = ${f.assignee}`);
    if (!skipTab && f.tab && f.tab !== 'all') parts.push(this.tabSql(user, f.tab));
    if (f.tagIds?.length) {
      parts.push(Prisma.sql`AND EXISTS (SELECT 1 FROM "ConversationTag" ct WHERE ct."conversationId" = c.id AND ct."tagId" IN (${Prisma.join(f.tagIds)}))`);
    }
    const from = f.from ? new Date(f.from) : null;
    const to = f.to ? new Date(f.to) : null;
    if (from && !isNaN(from.getTime())) parts.push(Prisma.sql`AND c."createdAt" >= ${from}`);
    if (to && !isNaN(to.getTime())) parts.push(Prisma.sql`AND c."createdAt" < ${to}`);
    if (f.purchase === 'yes') parts.push(Prisma.sql`AND cl."hasPurchase" = true`);
    if (f.purchase === 'no') parts.push(Prisma.sql`AND COALESCE(cl."hasPurchase", false) = false`);
    // Та же логика, что у метки FB/TT в списке: fbclid важнее ttclid.
    if (f.traffic === 'FB') parts.push(Prisma.sql`AND cl."fbclid" IS NOT NULL`);
    else if (f.traffic === 'TT') parts.push(Prisma.sql`AND cl."fbclid" IS NULL AND cl."ttclid" IS NOT NULL`);
    else if (f.traffic === 'none') parts.push(Prisma.sql`AND cl."fbclid" IS NULL AND cl."ttclid" IS NULL`);
    if (f.stage === 'none') parts.push(Prisma.sql`AND c."stageId" IS NULL`);
    else if (f.stage) parts.push(Prisma.sql`AND c."stageId" = ${f.stage}`);
    if (f.fieldId && f.fieldValue?.trim()) {
      const v = f.fieldValue.trim();
      // Текст/ссылка/число/дата — вхождение; выбор и мультивыбор — точный вариант (в т.ч. внутри списка).
      parts.push(Prisma.sql`AND (c."customFields"->>${f.fieldId} ILIKE ${`%${v}%`} OR c."customFields"->${f.fieldId} @> to_jsonb(${v}::text))`);
    }
    return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
  }

  private tabSql(user: AuthUser, tab: ChatTab): Prisma.Sql {
    switch (tab) {
      case 'unread':
        return Prisma.sql`AND c."unreadCount" > 0`;
      // «Без ответа» — последнее сообщение от лида, диалог не завершён.
      case 'unanswered':
        return Prisma.sql`AND c."lastMessageDirection" = 'IN' AND c."status" <> 'FINISHED'`;
      case 'waiting':
        return Prisma.sql`AND c."status" = 'WAITING'`;
      case 'finished':
        return Prisma.sql`AND c."status" = 'FINISHED'`;
      case 'favorites':
        return Prisma.sql`AND EXISTS (SELECT 1 FROM "ChatFavorite" f WHERE f."conversationId" = c.id AND f."userId" = ${user.userId})`;
      case 'blocked':
        return Prisma.sql`AND cl."isBotActive" = false`;
      default:
        return Prisma.empty;
    }
  }

  // Счётчики вкладок над списком — с теми же областью видимости и фильтрами, кроме самой вкладки.
  async tabCounts(companyId: string, user: AuthUser, filters: ConversationListFilters): Promise<Record<ChatTab, number>> {
    const scope = await this.scopeSql(companyId, user, filters.projectId, filters.source);
    const empty = { all: 0, unread: 0, unanswered: 0, waiting: 0, finished: 0, favorites: 0, blocked: 0 };
    if (!scope) return empty;
    const [row] = await this.prisma.$queryRaw<Record<ChatTab, number>[]>`
      SELECT
        COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE c."unreadCount" > 0)::int AS "unread",
        COUNT(*) FILTER (WHERE c."lastMessageDirection" = 'IN' AND c."status" <> 'FINISHED')::int AS "unanswered",
        COUNT(*) FILTER (WHERE c."status" = 'WAITING')::int AS "waiting",
        COUNT(*) FILTER (WHERE c."status" = 'FINISHED')::int AS "finished",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ChatFavorite" f WHERE f."conversationId" = c.id AND f."userId" = ${user.userId}))::int AS "favorites",
        COUNT(*) FILTER (WHERE cl."isBotActive" = false)::int AS "blocked"
      FROM "Conversation" c
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      WHERE ${scope} ${this.filtersSql(user, filters, true)}
    `;
    return row ?? empty;
  }

  // Получатели рассылки из чата (2026-10-25): те же область видимости и фильтры, что у списка
  // диалогов, — рассылка уходит ровно тем, кого пользователь видит в списке. ids — сузить до
  // выбранных вручную (лишние/чужие отбрасываются).
  async conversationIdsForBroadcast(companyId: string, user: AuthUser, filters: ConversationListFilters, ids?: string[], limit = 20000): Promise<string[]> {
    const scope = await this.scopeSql(companyId, user, filters.projectId, filters.source);
    if (!scope) return [];
    const search = filters.search?.trim().replace(/^@/, '');
    const searchSql = search
      ? Prisma.sql`AND (c."peerFirstName" ILIKE ${`%${search}%`} OR c."peerLastName" ILIKE ${`%${search}%`} OR c."peerUsername" ILIKE ${`%${search}%`} OR c."peerId" = ${search})`
      : Prisma.empty;
    const idsSql = ids ? (ids.length ? Prisma.sql`AND c.id IN (${Prisma.join(ids)})` : Prisma.sql`AND false`) : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM "Conversation" c
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      WHERE ${scope}
        ${filters.unread ? Prisma.sql`AND c."unreadCount" > 0` : Prisma.empty}
        ${this.filtersSql(user, filters)}
        ${searchSql}
        ${idsSql}
      ORDER BY c."lastMessageAt" DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  }

  // Проекты, чаты которых пользователь видит, — для проверок тегов проекта (ChatOrganizeService).
  async canSeeProjectChats(companyId: string, user: AuthUser, projectId: string): Promise<boolean> {
    return (await this.chatScope(companyId, user)).projectIds.includes(projectId);
  }

  // Экран выбора проекта (2026-10-23: «сначала выбирается проект, потом открывается чат») —
  // проекты с Telegram, какие у них есть чаты (бот и/или личка) и сколько диалогов не прочитано
  // в каждом.
  async listProjects(companyId: string, user: AuthUser) {
    const { projectIds, sources, resources, assigned } = await this.chatScope(companyId, user);
    // Оператору — только те ресурсы проекта, что назначены ему.
    const allowed = (projectId: string, source: ConversationSource) =>
      sources.includes(source) &&
      (!resources ||
        resources.some((r) => r.projectId === projectId && r.source === source) ||
        !!assigned?.pairs.some((a) => a.projectId === projectId && a.source === source));
    if (projectIds.length === 0) return [];
    const [projects, scope] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: projectIds }, companyId, deletedAt: null, channel: { type: 'TELEGRAM' } },
        select: { id: true, name: true, channel: true, folderId: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.scopeSql(companyId, user),
    ]);
    const favoriteIds = new Set(
      (await this.prisma.projectFavorite.findMany({ where: { userId: user.userId, projectId: { in: projectIds } }, select: { projectId: true } })).map((f) => f.projectId),
    );
    const unreadRows = scope
      ? await this.prisma.$queryRaw<{ projectId: string; source: ConversationSource; count: bigint }[]>`
          SELECT c."projectId", c."source", COUNT(*) AS count
          FROM "Conversation" c
          LEFT JOIN "Client" cl ON cl.id = c."clientId"
          WHERE ${scope} AND c."unreadCount" > 0
          GROUP BY c."projectId", c."source"
        `
      : [];
    const unread = new Map(unreadRows.map((r) => [`${r.projectId}:${r.source}`, Number(r.count)]));
    const personalLabels = new Map(
      await Promise.all(
        projects.map(async (p) => [p.id, p.channel && allowed(p.id, 'PERSONAL') ? await this.personalLabel(p.channel) : null] as const),
      ),
    );

    return projects.map((p) => {
      const channel = p.channel!;
      const hasBot = allowed(p.id, 'BOT') && !!channel.tgBotToken;
      const hasPersonal = allowed(p.id, 'PERSONAL') && !!channel.tgSessionEncrypted;
      return {
        id: p.id,
        name: p.name,
        folderId: p.folderId,
        favorite: favoriteIds.has(p.id),
        channelId: channel.id,
        hasAvatar: !!channel.tgAvatarFileId,
        bot: hasBot ? { username: channel.tgBotUsername, active: channel.isActive, unread: unread.get(`${p.id}:BOT`) ?? 0 } : null,
        personal: hasPersonal
          ? { username: personalLabels.get(p.id) ?? null, unread: unread.get(`${p.id}:PERSONAL`) ?? 0 }
          : null,
      };
    });
  }

  // Тег лички: тег живой сессии, иначе адрес из настроек режима PERSONAL_DM.
  private async personalLabel(channel: Channel): Promise<string | null> {
    if (!channel.tgSessionEncrypted) return null;
    const live = await this.telegramPersonal.getAccountLabel(channel);
    if (live) return live;
    return channel.tgPersonalUsername ? `@${channel.tgPersonalUsername.replace(/^@/, '')}` : null;
  }

  async unreadCount(companyId: string, user: AuthUser): Promise<number> {
    const scope = await this.scopeSql(companyId, user);
    if (!scope) return 0;
    const [row] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM "Conversation" c
      LEFT JOIN "Client" cl ON cl.id = c."clientId"
      WHERE ${scope} AND c."unreadCount" > 0
    `;
    return Number(row?.count ?? 0);
  }

  // Один диалог с проверкой доступа — общая точка для всех действий над ним.
  // Чужой проект или закрытый пользователю источник — 404, как будто диалога нет.
  async loadConversation(id: string, companyId: string, user: AuthUser, forReply = false) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!conversation) throw new NotFoundException('Диалог не найден');
    const scope = await this.chatScope(companyId, user);
    if (!scopeAllows(scope, conversation)) throw new NotFoundException('Диалог не найден');
    if (forReply && !(await this.canReplyIn(conversation.projectId, user))) {
      throw new ForbiddenException('Нет права отвечать клиентам этого проекта');
    }
    return conversation;
  }

  async getConversation(id: string, companyId: string, user: AuthUser) {
    const conversation = await this.loadConversation(id, companyId, user);
    const [project, canReply] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: conversation.projectId },
        select: { id: true, name: true, channel: true },
      }),
      this.canReplyIn(conversation.projectId, user),
    ]);
    const extraBot = conversation.botKey
      ? await this.prisma.projectBot.findUnique({ where: { id: conversation.botKey }, select: { tgBotUsername: true, isActive: true, deletedAt: true } })
      : null;
    const assignee = conversation.assignedUserId
      ? await this.prisma.user.findUnique({ where: { id: conversation.assignedUserId }, select: { id: true, firstName: true, lastName: true, email: true } })
      : null;
    // Язык интерфейса Telegram клиента — подсказка для «Писать на: авто» в переводчике чата.
    const client = conversation.clientId
      ? await this.prisma.client.findUnique({ where: { id: conversation.clientId }, select: { tgLanguage: true, fbclid: true, ttclid: true } })
      : null;
    const anonymous = await isAnonymousOperator(this.prisma, user);
    return {
      ...(anonymous ? this.maskConversation(conversation) : conversation),
      anonymous,
      clientLanguage: client?.tgLanguage?.slice(0, 2).toLowerCase() ?? null,
      trafficSource: client?.fbclid ? 'FB' : client?.ttclid ? 'TT' : null,
      assignee: assignee ? { id: assignee.id, name: [assignee.firstName, assignee.lastName].filter(Boolean).join(' ') || assignee.email } : null,
      favorite: !!(await this.prisma.chatFavorite.findUnique({ where: { userId_conversationId: { userId: user.userId, conversationId: id } } })),
      pinned: !!(await this.prisma.chatPin.findUnique({ where: { userId_conversationId: { userId: user.userId, conversationId: id } } })),
      tags: (await this.prisma.conversationTag.findMany({ where: { conversationId: id }, select: { tag: { select: { id: true, name: true, color: true } } } })).map((t) => t.tag),
      // Оператор может вернуть тимлиду только свой чат (2026-10-25).
      canReturn: user.role === UserRole.OPERATOR && conversation.assignedUserId === user.userId,
      project: {
        id: project?.id,
        name: project?.name,
        botUsername: conversation.botKey ? extraBot?.tgBotUsername ?? null : project?.channel?.tgBotUsername ?? null,
        personalUsername: project?.channel ? await this.personalLabel(project.channel) : null,
        // Можно ли сейчас отправить: бот — канал активен, личка — сессия подключена.
        sendAvailable:
          conversation.source === 'PERSONAL'
            ? !!project?.channel?.tgSessionEncrypted
            : conversation.botKey
              ? !!extraBot?.isActive && !extraBot.deletedAt
              : !!project?.channel?.isActive,
      },
      canReply,
    };
  }

  async listMessages(id: string, companyId: string, user: AuthUser, before?: string) {
    await this.loadConversation(id, companyId, user);
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MESSAGES_PAGE + 1,
      select: {
        id: true,
        direction: true,
        senderType: true,
        senderUserId: true,
        text: true,
        mediaType: true,
        mediaFileName: true,
        error: true,
        translations: true,
        createdAt: true,
      },
    });
    const page = rows.slice(0, MESSAGES_PAGE);

    // Имена операторов — чтобы в чате было видно, кто из команды ответил.
    const senderIds = [...new Set(page.map((m) => m.senderUserId).filter((v): v is string => !!v))];
    const senders = senderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const senderName = new Map(senders.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]));

    return {
      items: page.reverse().map((m) => ({ ...m, senderName: m.senderUserId ? senderName.get(m.senderUserId) ?? null : null })),
      hasMore: rows.length > MESSAGES_PAGE,
    };
  }

  // ---- перевод (2026-10-24) ----

  translationStatus() {
    return { enabled: this.translation.enabled };
  }

  // Перевод сообщения переписки. Результат кешируется в ChatMessage.translations[lang] — повторное
  // открытие (в т.ч. другим оператором) не тратит лимит сервиса перевода.
  async translateMessage(messageId: string, lang: string, companyId: string, user: AuthUser) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, text: true, translations: true },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');
    await this.loadConversation(message.conversationId, companyId, user);
    if (!message.text?.trim()) throw new BadRequestException('В сообщении нет текста');

    const cache = (message.translations ?? {}) as Record<string, { text: string; from: string | null }>;
    if (cache[lang]) return { lang, ...cache[lang] };
    const result = await this.translation.translate(message.text, lang);
    await this.prisma.chatMessage.update({
      where: { id: message.id },
      data: { translations: { ...cache, [lang]: result } as Prisma.InputJsonValue },
    });
    return { lang, ...result };
  }

  // Перевод черновика из поля ввода — без сохранения. Доступен тем, кому вообще открыты чаты.
  async translateDraft(text: string, lang: string, companyId: string, user: AuthUser) {
    const scope = await this.chatScope(companyId, user);
    if (scope.projectIds.length === 0) throw new ForbiddenException('Нет доступа к чатам');
    const result = await this.translation.translate(text, lang);
    return { lang, ...result };
  }

  async markRead(id: string, companyId: string, user: AuthUser) {
    await this.loadConversation(id, companyId, user);
    await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    return { ok: true };
  }

  async send(
    id: string,
    companyId: string,
    user: AuthUser,
    // attachment — уже подготовленный файл (медиа шаблона ответа, 2026-10-25); file — загрузка из
    // поля ввода.
    payload: { text?: string; file?: Express.Multer.File; attachment?: ChatOutgoingFile },
  ) {
    const conversation = await this.loadConversation(id, companyId, user, true);
    const text = payload.text?.trim();
    const file: ChatOutgoingFile | undefined =
      payload.attachment ?? (payload.file ? { buffer: payload.file.buffer, filename: payload.file.originalname, mimetype: payload.file.mimetype } : undefined);
    if (!text && !file) throw new BadRequestException('Пустое сообщение');
    if (text && text.length > 4096) throw new BadRequestException('Сообщение длиннее 4096 символов — так Telegram не примет');

    const channel = await this.prisma.channel.findUnique({ where: { id: conversation.channelId } });
    if (!channel) throw new NotFoundException('Канал не найден');

    try {
      let sent: { messageId: string; mediaType?: string; fileId?: string };
      if (conversation.source === 'PERSONAL') {
        sent = await this.telegramPersonal.sendChatMessage(channel, conversation.peerId, { text, file });
      } else if (conversation.botKey) {
        // Переписка через дополнительного бота — отвечаем тем же ботом.
        const bot = this.extraBots.getBot(conversation.botKey);
        if (!bot) throw new Error('Этот бот сейчас не подключён — переподключите его в «Подключениях»');
        sent = await this.telegram.sendChatMessageWithBot(bot, conversation.peerId, { text, file });
      } else {
        sent = await this.telegram.sendChatMessage(channel, conversation.peerId, { text, file });
      }
      const message = await this.chatStore.appendOutgoing(conversation.id, {
        senderType: 'OPERATOR',
        senderUserId: user.userId,
        text: text ?? null,
        mediaType: sent.mediaType,
        mediaFileId: sent.fileId,
        mediaFileName: file?.filename,
        externalId: sent.messageId,
      });
      // Ответ оператора = прочитал всё, что было до него.
      await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
      return message;
    } catch (error) {
      const blocked = conversation.source === 'BOT' && error instanceof GrammyError && error.error_code === 403;
      const reason = blocked ? 'Клиент заблокировал бота — сообщение не доставлено' : `Не отправлено: ${(error as Error).message}`;
      // Статус бота у клиента — только про основного бота; блокировка дополнительного отмечается
      // у его подписчика.
      if (blocked && conversation.botKey) {
        await this.prisma.projectBotSubscriber.updateMany({
          where: { botId: conversation.botKey, tgUserId: conversation.peerId },
          data: { isBlocked: true, blockedAt: new Date() },
        });
      } else if (blocked && conversation.clientId) {
        await this.prisma.client.update({ where: { id: conversation.clientId }, data: { isBotActive: false } });
      }
      // Неотправленное сообщение тоже остаётся в переписке — с причиной, чтобы оператор видел,
      // что именно не дошло.
      return this.chatStore.appendOutgoing(conversation.id, {
        senderType: 'OPERATOR',
        senderUserId: user.userId,
        text: text ?? null,
        mediaType: file ? (file.kind ?? 'document') : null,
        mediaFileName: file?.filename,
        error: reason,
      });
    }
  }

  // Открыть переписку из карточки клиента. Написать первым бот может только тому, кто уже
  // запускал его (botActivatedAt) — иначе Telegram вернёт «chat not found».
  async openForClient(projectId: string, clientId: string, companyId: string, user: AuthUser, requestedSource?: ConversationSource) {
    const scope = await this.chatScope(companyId, user);
    if (!scope.projectIds.includes(projectId)) throw new ForbiddenException('Нет доступа к чатам этого проекта');
    const client = await this.prisma.client.findFirst({ where: { id: clientId, projectId, companyId, deletedAt: null } });
    if (!client?.tgUserId) throw new NotFoundException('У клиента нет Telegram-аккаунта');

    const channel = await this.prisma.channel.findUnique({ where: { projectId } });
    if (!channel || channel.type !== 'TELEGRAM') throw new BadRequestException('У проекта нет Telegram');
    const hasBot = scopeAllows(scope, { projectId, source: 'BOT', botKey: '' }) && !!channel.tgBotToken;
    const hasPersonal = scopeAllows(scope, { projectId, source: 'PERSONAL', botKey: '' }) && !!channel.tgSessionEncrypted;
    // По умолчанию — бот, если он есть и доступен; иначе личка.
    const source: ConversationSource = requestedSource ?? (hasBot ? 'BOT' : 'PERSONAL');
    if (source === 'BOT' && !hasBot) throw new BadRequestException('Чат бота этого проекта вам недоступен');
    if (source === 'PERSONAL' && !hasPersonal) throw new BadRequestException('Чат лички этого проекта вам недоступен');

    const existing = await this.prisma.conversation.findUnique({
      where: { channelId_source_botKey_peerId: { channelId: channel.id, source, botKey: '', peerId: client.tgUserId } },
      select: { id: true },
    });
    if (existing) return existing;
    if (source === 'BOT' && !client.botActivatedAt) throw new BadRequestException('Клиент ещё не запускал бота — первым ему написать нельзя');

    const created = await this.chatStore.findOrCreateConversation(channel, source, {
      id: client.id,
      tgUserId: client.tgUserId,
      tgFirstName: client.tgFirstName,
      tgLastName: client.tgLastName,
      tgUsername: client.tgUsername,
    });
    if (!created) throw new NotFoundException('Проект не найден');
    return { id: created.id };
  }

  async getMedia(messageId: string, companyId: string, user: AuthUser) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message?.mediaType) throw new NotFoundException('Файл не найден');
    const conversation = await this.loadConversation(message.conversationId, companyId, user);
    const channel = await this.prisma.channel.findUnique({ where: { id: conversation.channelId } });
    if (!channel) throw new NotFoundException('Канал не найден');
    if (conversation.source === 'PERSONAL') {
      if (!message.externalId) throw new NotFoundException('Файл не найден');
      const file = await this.telegramPersonal.downloadChatMedia(channel, conversation.peerId, message.externalId);
      return { kind: 'buffer' as const, ...file, fileName: message.mediaFileName };
    }
    if (!message.mediaFileId) throw new NotFoundException('Файл не найден');
    if (conversation.botKey) {
      const token = await this.extraBots.getToken(conversation.botKey);
      if (!token) throw new NotFoundException('Бот не найден');
      const extraFile = await this.telegram.downloadFileByToken(token, message.mediaFileId, this.extraBots.getBot(conversation.botKey)?.api);
      return { kind: 'stream' as const, ...extraFile, fileName: message.mediaFileName };
    }
    const file = await this.telegram.downloadChatFile(channel, message.mediaFileId);
    return { kind: 'stream' as const, ...file, fileName: message.mediaFileName };
  }
}
