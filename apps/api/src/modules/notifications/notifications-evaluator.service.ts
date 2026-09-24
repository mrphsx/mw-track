import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, PURCHASABLE_PLANS } from '../billing/plans';
import { ProjectsService } from '../projects/projects.service';
import { escapeTelegramHtml, NOTIFICATION_TYPE_META, NotificationType } from './notification-types';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_BALANCE_WINDOW_MS = 7 * DAY_MS;
const TRIAL_EXPIRING_WINDOW_MS = 3 * DAY_MS;
// Понижение тарифа старше недели не считается свежей новостью: иначе подключение бота к
// компании, которую перевели на TRIAL месяц назад, тут же прислало бы давно известное.
const DOWNGRADE_FRESHNESS_MS = 7 * DAY_MS;
// Пиксель считается "не принимающим события", если среди его отправок за сутки их не меньше
// PIXEL_MIN_ATTEMPTS и ПОСЛЕДНИЕ (до PIXEL_RECENT_WINDOW) — все отказы. Смотрим на самые свежие
// попытки, а не на окно времени: так ночное затишье не выглядит ни поломкой, ни починкой.
const PIXEL_LOOKBACK_MS = DAY_MS;
const PIXEL_RECENT_WINDOW = 5;
const PIXEL_MIN_ATTEMPTS = 3;

export const NOTIFICATION_MESSAGES_QUEUE = 'notification-messages';

export interface NotificationJob {
  recipientId: string;
  text: string;
}

// Текущая проблема компании: что именно сломано, у какого объекта и как об этом сказать.
// group — если несколько однотипных проблем одного проекта надо отправить ОДНИМ сообщением
// (пиксели: у одного проекта их бывает с десяток) — text тогда строка списка, а заголовок и
// ссылка берутся из group.
interface MessageGroup {
  key: string;
  title: string;
  footer: string;
}

interface ActiveCondition {
  type: NotificationType;
  subjectId: string;
  text: string;
  group?: MessageGroup;
}

interface ResolvedItem {
  text: string;
  group?: MessageGroup;
}

type FailingPixelRow = {
  id: string;
  platform: string;
  pixelId: string;
  label: string | null;
  projectId: string;
  projectName: string;
  statuses: string[] | null;
  lastError: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  channel: {
    type: string;
    isActive: boolean;
    lastError: string | null;
    lastWebhookAt: Date | null;
    tgPersonalLastError: string | null;
  } | null;
};

// Считает, какие проблемы есть у компании прямо сейчас, и сравнивает с тем, о чём уже сообщали
// (NotificationAlertState). Почему опрос по крону, а не события в местах, где меняется состояние:
// isActive канала переключают минимум четыре независимых пути (создание, правка, rehydration при
// старте, 15-минутная проверка здоровья), сессию личного аккаунта — ещё два, а "нет вебхуков" и
// "баланса не хватит" вообще не события, а время. Один сравнивающий крон видит итог любого из них и
// не трогает хрупкий код каналов/MTProto.
@Injectable()
export class NotificationsEvaluator {
  private readonly logger = new Logger(NotificationsEvaluator.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectQueue(NOTIFICATION_MESSAGES_QUEUE) private queue: Queue<NotificationJob>,
  ) {}

  async evaluateAll(): Promise<void> {
    // Процесс API один (pm2 fork), но тик может не успеть закончиться до следующего —
    // перекрытие дало бы двойные сообщения до того, как первая итерация запишет состояние.
    if (this.running) return;
    this.running = true;
    try {
      const bots = await this.prisma.notificationBot.findMany({ where: { isActive: true }, select: { companyId: true } });
      for (const { companyId } of bots) {
        try {
          await this.evaluateCompany(companyId);
        } catch (error) {
          this.logger.error(`Проверка оповещений компании ${companyId} упала: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async evaluateCompany(companyId: string): Promise<void> {
    const conditions = await this.collectConditions(companyId);
    const current = new Map(conditions.map((c) => [this.key(c.type, c.subjectId), c]));
    const states = await this.prisma.notificationAlertState.findMany({ where: { companyId } });
    const known = new Set(states.map((s) => this.key(s.type, s.subjectId)));

    const fresh: ActiveCondition[] = [];
    for (const condition of conditions) {
      if (known.has(this.key(condition.type, condition.subjectId))) continue;
      if (await this.createState(companyId, condition)) fresh.push(condition);
    }
    for (const message of composeMessages(fresh, '⚠️')) {
      await this.fanOut(companyId, message.type, message.text);
    }

    const resolved: Array<ResolvedItem & { type: NotificationType }> = [];
    for (const state of states) {
      if (current.has(this.key(state.type, state.subjectId))) continue;
      const type = state.type as NotificationType;
      const item = await this.resolvedItem(companyId, type, state.subjectId);
      await this.prisma.notificationAlertState.deleteMany({ where: { id: state.id } });
      if (item) resolved.push({ ...item, type });
    }
    for (const message of composeMessages(resolved, '✅')) {
      await this.fanOut(companyId, message.type, message.text);
    }
  }

  // Для приветствия после /start: что сломано прямо сейчас, в пределах типов, которые получатель
  // выбрал. Без этого человек, подключившийся позже, не узнал бы об уже идущей проблеме — о ней
  // сообщили один раз, до его подключения.
  async describeActive(companyId: string, enabledTypes: string[]): Promise<string[]> {
    const conditions = await this.collectConditions(companyId);
    return composeMessages(conditions.filter((c) => enabledTypes.includes(c.type)), '').map((m) => m.text.trimStart());
  }

  async collectConditions(companyId: string): Promise<ActiveCondition[]> {
    const result: ActiveCondition[] = [];
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planExpiresAt: true, balance: true, deletedAt: true },
    });
    if (!company || company.deletedAt) return result;

    const now = Date.now();
    const msLeft = company.planExpiresAt ? company.planExpiresAt.getTime() - now : null;
    const isPurchasable = (PURCHASABLE_PLANS as readonly string[]).includes(company.plan);

    if (isPurchasable && msLeft !== null && msLeft <= LOW_BALANCE_WINDOW_MS) {
      const price = PLANS[company.plan].priceUsdt;
      const balance = Number(company.balance);
      if (balance < price) {
        result.push({
          type: 'LOW_BALANCE',
          subjectId: companyId,
          text:
            `<b>Низкий баланс.</b> Продление тарифа ${company.plan} ${this.whenText(msLeft)}: нужно ${price} USDT, ` +
            `на балансе ${balance.toFixed(2)} USDT. Без пополнения компанию переведёт на TRIAL.\n${this.link('/billing', 'Пополнить баланс')}`,
        });
      }
    }

    if (company.plan === 'TRIAL' && msLeft !== null && msLeft <= TRIAL_EXPIRING_WINDOW_MS) {
      result.push({
        type: 'TRIAL_EXPIRING',
        subjectId: companyId,
        text:
          msLeft <= 0
            ? `<b>Пробный период закончился.</b> Выберите тариф, чтобы продолжить работу.\n${this.link('/billing', 'Выбрать тариф')}`
            : `<b>Пробный период заканчивается</b> ${this.whenText(msLeft)}.\n${this.link('/billing', 'Выбрать тариф')}`,
      });
    }

    if (company.plan === 'TRIAL' && company.planExpiresAt === null) {
      const downgrade = await this.prisma.balanceTransaction.findFirst({
        where: { companyId, type: 'DOWNGRADE', createdAt: { gte: new Date(now - DOWNGRADE_FRESHNESS_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (downgrade) {
        result.push({
          type: 'PLAN_DOWNGRADED',
          // id транзакции, а не компании: каждое новое понижение — отдельная новость.
          subjectId: downgrade.id,
          text:
            `<b>Тариф понижен до TRIAL</b> — на балансе не хватило средств для продления. ` +
            `Лимиты проектов, клиентов и рассылок уменьшены.\n${this.link('/billing', 'Пополнить и выбрать тариф')}`,
        });
      }
    }

    const projects: ProjectRow[] = await this.prisma.project.findMany({
      // Явно: вне HTTP-запроса tenant-middleware PrismaService не подставляет companyId/deletedAt.
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        channel: { select: { type: true, isActive: true, lastError: true, lastWebhookAt: true, tgPersonalLastError: true } },
      },
    });

    for (const project of projects) {
      const channel = project.channel;
      if (!channel) continue;
      const name = escapeTelegramHtml(project.name);
      const projectLink = this.link(`/projects/${project.id}/settings`, 'Открыть настройки проекта');

      if (!channel.isActive) {
        const what = channel.type === 'WEBSITE' ? 'Сайт' : 'Бот';
        const reason = channel.lastError ? `\nПричина: ${escapeTelegramHtml(channel.lastError)}` : '';
        result.push({
          type: 'CHANNEL_DISCONNECTED',
          subjectId: project.id,
          text: `<b>${what} проекта «${name}» отключён.</b>${reason}\n${projectLink}`,
        });
      }

      if (
        channel.type === 'TELEGRAM' &&
        channel.isActive &&
        channel.lastWebhookAt &&
        now - channel.lastWebhookAt.getTime() > ProjectsService.WEBHOOK_STALE_THRESHOLD_MS
      ) {
        const hours = Math.floor((now - channel.lastWebhookAt.getTime()) / (60 * 60 * 1000));
        result.push({
          type: 'WEBHOOK_STALE',
          subjectId: project.id,
          text:
            `<b>Бот проекта «${name}» не получает обновления</b> уже ${hours} ч. Вступления и сообщения ` +
            `не регистрируются. Нажмите «Переподключить» в настройках канала.\n${projectLink}`,
        });
      }

      if (channel.tgPersonalLastError) {
        result.push({
          type: 'PERSONAL_ACCOUNT_DISCONNECTED',
          subjectId: project.id,
          text:
            `<b>Личный аккаунт проекта «${name}» отключён</b> — Telegram отозвал сессию. ` +
            `Диалоги и личные рассылки не работают до переподключения.\n${projectLink}`,
        });
      }
    }

    result.push(...(await this.collectFailingPixels(companyId)));
    return result;
  }

  // Один запрос на компанию: по индексу (pixelId, sentAt) берём до PIXEL_RECENT_WINDOW последних
  // отправок каждого активного пикселя за сутки. У компании с сотней пикселей это миллисекунды.
  private async collectFailingPixels(companyId: string): Promise<ActiveCondition[]> {
    const rows = await this.prisma.$queryRaw<FailingPixelRow[]>`
      SELECT pi.id, pi.platform::text AS platform, pi."pixelId", pi.label,
             pr.id AS "projectId", pr.name AS "projectName", x.statuses, x."lastError"
      FROM "TrackingPixel" pi
      JOIN "Project" pr ON pr.id = pi."projectId"
      CROSS JOIN LATERAL (
        SELECT array_agg(t.status ORDER BY t."sentAt" DESC) AS statuses,
               (array_agg(t.error ORDER BY t."sentAt" DESC))[1] AS "lastError"
        FROM (
          SELECT d.status, d.error, d."sentAt" FROM "TrackingEventDelivery" d
          WHERE d."pixelId" = pi.id AND d."sentAt" >= ${new Date(Date.now() - PIXEL_LOOKBACK_MS)}
          ORDER BY d."sentAt" DESC
          LIMIT ${PIXEL_RECENT_WINDOW}
        ) t
      ) x
      WHERE pr."companyId" = ${companyId} AND pr."deletedAt" IS NULL AND pi."isActive" = true
    `;

    return rows
      .filter((r) => (r.statuses?.length ?? 0) >= PIXEL_MIN_ATTEMPTS && r.statuses!.every((st) => st === 'error'))
      .map((r) => {
        const hint = pixelHint(r.platform, r.pixelId, r.lastError);
        return {
          type: 'PIXEL_DELIVERY_FAILING' as const,
          subjectId: r.id,
          text:
            `• ${pixelName(r)} — ${escapeTelegramHtml(shortError(r.lastError))}` +
            (hint ? `\n  <i>${escapeTelegramHtml(hint)}</i>` : ''),
          group: {
            key: `pixels:${r.projectId}`,
            title: `<b>Пиксели проекта «${escapeTelegramHtml(r.projectName)}» не принимают события</b> — все последние отправки отклонены:`,
            footer: this.link(`/projects/${r.projectId}/settings?tab=pixels`, 'Открыть пиксели проекта'),
          },
        };
      });
  }

  // Сообщать ли, что проблема ушла. Не всякое исчезновение условия — хорошая новость: проект мог
  // быть архивирован, "низкий баланс" мог уйти потому, что компанию уже понизили до TRIAL (об этом
  // придёт своё сообщение), а свежесть понижения просто истекла через неделю.
  private async resolvedItem(companyId: string, type: NotificationType, subjectId: string): Promise<ResolvedItem | null> {
    if (type === 'PIXEL_DELIVERY_FAILING') return this.resolvedPixel(companyId, subjectId);
    const text = await this.resolvedText(companyId, type, subjectId);
    return text ? { text } : null;
  }

  // Пиксель "починился", только если его собственная последняя отправка прошла. Если отправок
  // просто нет (затишье), выключен или удалён проект — молчим, иначе вышло бы ложное "всё хорошо".
  private async resolvedPixel(companyId: string, pixelRowId: string): Promise<ResolvedItem | null> {
    const pixel = await this.prisma.trackingPixel.findFirst({
      where: { id: pixelRowId, isActive: true, project: { companyId, deletedAt: null } },
      select: { platform: true, pixelId: true, label: true, project: { select: { id: true, name: true } } },
    });
    if (!pixel) return null;
    const latest = await this.prisma.trackingEventDelivery.findFirst({
      where: { pixelId: pixelRowId, sentAt: { gte: new Date(Date.now() - PIXEL_LOOKBACK_MS) } },
      orderBy: { sentAt: 'desc' },
      select: { status: true },
    });
    if (latest?.status !== 'sent') return null;
    return {
      text: `• ${pixelName({ platform: pixel.platform, pixelId: pixel.pixelId, label: pixel.label })}`,
      group: {
        key: `pixels:${pixel.project.id}`,
        title: `<b>Пиксели проекта «${escapeTelegramHtml(pixel.project.name)}» снова принимают события:</b>`,
        footer: '',
      },
    };
  }

  private async resolvedText(companyId: string, type: NotificationType, subjectId: string): Promise<string | null> {
    if (type === 'LOW_BALANCE' || type === 'TRIAL_EXPIRING' || type === 'PLAN_DOWNGRADED') {
      const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } });
      if (!company || company.plan === 'TRIAL') return null;
      if (type === 'LOW_BALANCE') return `<b>Баланс в порядке</b> — хватает на продление тарифа ${company.plan}.`;
      return `<b>Тариф ${company.plan} активен.</b>`;
    }

    const project = await this.prisma.project.findFirst({
      where: { id: subjectId, companyId, deletedAt: null },
      select: { name: true },
    });
    if (!project) return null;
    const name = escapeTelegramHtml(project.name);
    if (type === 'CHANNEL_DISCONNECTED') return `<b>Канал проекта «${name}» снова работает.</b>`;
    if (type === 'WEBHOOK_STALE') return `<b>Бот проекта «${name}» снова получает обновления.</b>`;
    if (type === 'PERSONAL_ACCOUNT_DISCONNECTED') return `<b>Личный аккаунт проекта «${name}» снова подключён.</b>`;
    return null;
  }

  // create + P2002 вместо createMany: нужно знать, что строку создал именно этот вызов, — только
  // тогда рассылаем, иначе два пересекающихся прохода отправили бы одно и то же дважды.
  private async createState(companyId: string, condition: ActiveCondition): Promise<boolean> {
    try {
      await this.prisma.notificationAlertState.create({
        data: { companyId, type: condition.type, subjectId: condition.subjectId },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  // Отправка через BullMQ, как и все остальные сообщения в системе (правило из CLAUDE.md), —
  // с повторами при сетевых ошибках и общим лимитом скорости на бота.
  private async fanOut(companyId: string, type: NotificationType, text: string): Promise<void> {
    const recipients = await this.prisma.notificationRecipient.findMany({
      where: {
        chatId: { not: null },
        enabledTypes: { has: type },
        notificationBot: { companyId, isActive: true },
      },
      select: { id: true },
    });
    const footer = `\n\n<i>${escapeTelegramHtml(NOTIFICATION_TYPE_META[type].label)}</i>`;
    for (const recipient of recipients) {
      await this.queue.add(
        'send',
        { recipientId: recipient.id, text: text + footer },
        { attempts: 4, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: 200 },
      );
    }
  }

  private key(type: string, subjectId: string): string {
    return `${type}:${subjectId}`;
  }

  private whenText(msLeft: number): string {
    if (msLeft <= 0) return 'уже просрочено';
    const hours = Math.ceil(msLeft / (60 * 60 * 1000));
    if (hours < 24) return `через ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
    const days = Math.ceil(msLeft / DAY_MS);
    return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }

  private link(path: string, label: string): string {
    const base = (this.config.get<string>('APP_URL') || 'https://mw-track.com').replace(/\/$/, '');
    return `<a href="${base}${path}">${escapeTelegramHtml(label)}</a>`;
  }
}

// Русское склонение числительных: 1 день, 2 дня, 5 дней, 11 дней, 21 день.
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Склеивает сгруппированные элементы (одна группа — одно сообщение), остальные оставляет как есть.
// Порядок сохраняется: группа встаёт на место своего первого элемента.
function composeMessages<T extends { type: NotificationType; text: string; group?: MessageGroup }>(
  items: T[],
  icon: string,
): Array<{ type: NotificationType; text: string }> {
  const prefix = icon ? `${icon} ` : '';
  const out: Array<{ type: NotificationType; text: string; group?: MessageGroup; lines?: string[] }> = [];
  const byGroup = new Map<string, { lines: string[] }>();
  for (const item of items) {
    if (!item.group) {
      out.push({ type: item.type, text: `${prefix}${item.text}` });
      continue;
    }
    const existing = byGroup.get(item.group.key);
    if (existing) {
      existing.lines.push(item.text);
      continue;
    }
    const entry = { type: item.type, text: '', group: item.group, lines: [item.text] };
    byGroup.set(item.group.key, entry);
    out.push(entry);
  }
  return out.map((m) => {
    if (!m.group) return { type: m.type, text: m.text };
    // Лимит сообщения Telegram — 4096 символов; длиннее — отказ целиком, и оповещение теряется.
    // Строка списка укладывается в ~400 символов, поэтому 8 строк гарантированно влезают.
    const lines = m.lines!.slice(0, MAX_GROUP_LINES);
    const rest = m.lines!.length - lines.length;
    if (rest > 0) lines.push(`…и ещё ${rest}`);
    return { type: m.type, text: `${prefix}${m.group.title}\n${lines.join('\n')}${m.group.footer ? `\n${m.group.footer}` : ''}` };
  });
}

const MAX_GROUP_LINES = 8;

function pixelName(p: { platform: string; pixelId: string; label: string | null }): string {
  const platform = p.platform === 'TIKTOK' ? 'TikTok' : 'Facebook';
  const id = p.pixelId.trim();
  const label = p.label?.trim();
  if (!label) return escapeTelegramHtml(`${platform} ${id}`);
  // Метку часто пишут вместе с ID ("surjen1 D9VB…") — не повторяем его второй раз.
  return escapeTelegramHtml(label.includes(id) ? `${platform} «${label}»` : `${platform} «${label}» (${id})`);
}

// Ошибки Facebook у нас хранятся с хвостом "[code=... trace=...]" — в сообщении он только мешает.
function shortError(error: string | null): string {
  if (!error) return 'отказ без описания';
  const clean = error
    .replace(/\s*\[code=[^\]]*\]\s*$/, '')
    // Хвост TikTok дословно повторяет то, что объясняет подсказка ниже.
    .replace(/\.?\s*You must be an admin or operator of this advertiser account\.?/i, '')
    .trim();
  return clean.length > 110 ? `${clean.slice(0, 107)}…` : clean;
}

// Подсказка по самым частым причинам, найденным на боевых данных 2026-09-17.
function pixelHint(platform: string, pixelId: string, error: string | null): string | null {
  const id = pixelId.trim();
  if (platform === 'FACEBOOK' && !/^\d+$/.test(id)) {
    return 'ID похож на код пикселя TikTok — пересоздайте пиксель, выбрав платформу TikTok.';
  }
  if (/No permission to operate pixel/i.test(error ?? '')) {
    return 'У токена TikTok нет доступа к этому пикселю — выпустите токен в том же рекламном аккаунте, где пиксель.';
  }
  if (/access token/i.test(error ?? '')) {
    return 'Токен доступа недействителен — создайте новый в Events Manager → Настройки → Conversions API.';
  }
  return null;
}
