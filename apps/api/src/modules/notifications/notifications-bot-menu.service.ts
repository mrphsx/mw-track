import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Permission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveScopedBuyerId } from '../../common/buyer-scope.util';
import { ProjectsService } from '../projects/projects.service';
import { escapeTelegramHtml } from './notification-types';

type Period = 'today' | 'yesterday' | '7d' | '30d';

// Кнопки бота оповещений (2026-10-26: «кнопки в боте — список проектов, количество клиентов,
// диалогов, депозитов, сумма»). Отвечает только сотрудникам, привязавшим этот Telegram к профилю
// CRM (UserTelegramAccount), и только в пределах их прав — цифры те же, что на главной
// (ProjectsService.getCompanyStats: доступ STATS_VIEW, сумма — только при STATS_VIEW_REVENUE,
// баер с «только свои клиенты» видит только своих).
export const MENU_BUTTONS: Record<string, Period | 'projects'> = {
  '📊 Сегодня': 'today',
  '📅 Вчера': 'yesterday',
  '📈 7 дней': '7d',
  '🗓 30 дней': '30d',
  '📋 Проекты': 'projects',
};
const PERIOD_TITLE: Record<Period, string> = { today: 'Сегодня', yesterday: 'Вчера', '7d': 'За 7 дней', '30d': 'За 30 дней' };
const MAX_PROJECT_LINES = 30;
const MAX_PROJECT_BUTTONS = 20;

export const MENU_KEYBOARD = {
  keyboard: [[{ text: '📊 Сегодня' }, { text: '📅 Вчера' }], [{ text: '📈 7 дней' }, { text: '🗓 30 дней' }], [{ text: '📋 Проекты' }]],
  resize_keyboard: true,
  is_persistent: true,
};

export interface MenuReply {
  html: string;
  markup?: unknown;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const num = (n: number) => n.toLocaleString('ru-RU');
const money = (n: number) => `$${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;

@Injectable()
export class NotificationsBotMenuService {
  private readonly logger = new Logger(NotificationsBotMenuService.name);

  constructor(
    private prisma: PrismaService,
    private projects: ProjectsService,
    private config: ConfigService,
  ) {}

  // Сотрудник CRM по Telegram этой компании — или null (не привязан / удалён / заблокирован).
  async staffFor(companyId: string, tgUserId: string) {
    const account = await this.prisma.userTelegramAccount.findUnique({ where: { companyId_tgUserId: { companyId, tgUserId } } });
    if (!account) return null;
    const user = await this.prisma.user.findFirst({ where: { id: account.userId, companyId, deletedAt: null, isActive: true } });
    return user ? { id: user.id, role: user.role, firstName: user.firstName } : null;
  }

  async handle(companyId: string, botRowId: string, staff: { id: string; role: Parameters<ProjectsService['getAccessibleProjectIds']>[2] }, action: Period | 'projects'): Promise<MenuReply> {
    try {
      return action === 'projects' ? await this.projectsReply(companyId, botRowId, staff) : await this.statsReply(companyId, staff, action);
    } catch (error) {
      this.logger.warn(`Ответ меню бота оповещений не собран: ${(error as Error).message}`);
      return { html: 'Не удалось получить данные — попробуйте позже.', markup: MENU_KEYBOARD };
    }
  }

  private async load(companyId: string, staff: { id: string; role: Parameters<ProjectsService['getAccessibleProjectIds']>[2] }, period: Period) {
    const scopedBuyerId = await resolveScopedBuyerId(this.prisma, staff.id, staff.role);
    const [stats, revenueIds] = await Promise.all([
      this.projects.getCompanyStats(companyId, staff.id, staff.role, { period }, scopedBuyerId),
      this.projects.getAccessibleProjectIds(companyId, staff.id, staff.role, Permission.STATS_VIEW_REVENUE),
    ]);
    const ids = Object.keys(stats.byProject);
    const names = ids.length
      ? await this.prisma.project.findMany({ where: { id: { in: ids }, companyId, deletedAt: null }, select: { id: true, name: true } })
      : [];
    const rows = names
      .map((p) => ({ id: p.id, name: p.name, ...stats.byProject[p.id], canRevenue: revenueIds.includes(p.id) }))
      .sort((a, b) => b.clients - a.clients || b.revenue - a.revenue || a.name.localeCompare(b.name));
    return { stats, rows, canRevenue: revenueIds.length > 0 };
  }

  private async statsReply(companyId: string, staff: { id: string; role: Parameters<ProjectsService['getAccessibleProjectIds']>[2] }, period: Period): Promise<MenuReply> {
    const { stats, rows, canRevenue } = await this.load(companyId, staff, period);
    if (!rows.length) return { html: 'Нет проектов, статистику которых вам можно смотреть.', markup: MENU_KEYBOARD };
    const lines = [
      `<b>📊 ${PERIOD_TITLE[period]}</b> · ${rows.length > 1 ? `все проекты (${rows.length})` : escapeTelegramHtml(rows[0].name)}`,
      '',
      `👥 Клиенты: <b>${num(stats.newClients)}</b>`,
      `💬 Диалоги: <b>${num(rows.reduce((s, r) => s + r.dialogues, 0))}</b>`,
      ...(canRevenue
        ? [`💰 Депозиты: ФД <b>${num(stats.totalFd)}</b> · РД <b>${num(stats.totalRd)}</b>`, `💵 Сумма: <b>${money(stats.totalRevenue)}</b>`]
        : []),
    ];
    // Источники трафика (2026-10-26: «добавь источники трафика со статистикой») — те же FB/TT и
    // «без метки», что в блоке источников на главной.
    const srcLine = (label: string, r: { clients: number; dialogues: number; fd: number; rd: number; revenue: number }) => {
      const parts = [`👥 ${num(r.clients)}`, `💬 ${num(r.dialogues)}`];
      if (canRevenue) parts.push(`ФД ${num(r.fd)}`, `РД ${num(r.rd)}`, money(r.revenue));
      return `• ${label} — ${parts.join(' · ')}`;
    };
    const SOURCE_LABEL: Record<string, string> = { FACEBOOK: '🔵 Facebook', TIKTOK: '🎵 TikTok' };
    lines.push('', '<b>Источники трафика:</b>');
    for (const src of stats.sources) lines.push(srcLine(SOURCE_LABEL[src.source] ?? src.source, src));
    if (stats.sourcesUnattributed) lines.push(srcLine('⚪ Без метки (органика)', stats.sourcesUnattributed));

    if (rows.length > 1) {
      // Проекты без единой цифры за период — одной строкой, а не списком нулей.
      const active = rows.filter((r) => r.clients || r.dialogues || r.fd || r.rd || r.revenue);
      const idle = rows.length - active.length;
      lines.push('', '<b>По проектам:</b>');
      for (const r of active.slice(0, MAX_PROJECT_LINES)) {
        const parts = [`👥 ${num(r.clients)}`, `💬 ${num(r.dialogues)}`];
        if (r.canRevenue) parts.push(`ФД ${num(r.fd)}`, `РД ${num(r.rd)}`, money(r.revenue));
        lines.push(`• ${escapeTelegramHtml(r.name)} — ${parts.join(' · ')}`);
      }
      if (active.length > MAX_PROJECT_LINES) lines.push(`…и ещё ${active.length - MAX_PROJECT_LINES}`);
      if (!active.length) lines.push('За период ни в одном проекте нет активности.');
      if (idle > 0 && active.length) lines.push(`<i>Без активности: ${idle} ${plural(idle, 'проект', 'проекта', 'проектов')}</i>`);
    }
    return { html: lines.join('\n'), markup: MENU_KEYBOARD };
  }

  private async projectsReply(companyId: string, botRowId: string, staff: { id: string; role: Parameters<ProjectsService['getAccessibleProjectIds']>[2] }): Promise<MenuReply> {
    const { rows } = await this.load(companyId, staff, 'today');
    if (!rows.length) return { html: 'Нет доступных проектов.', markup: MENU_KEYBOARD };
    const lines = [`<b>📋 Ваши проекты (${rows.length})</b> · сегодня`, ''];
    for (const r of rows.slice(0, MAX_PROJECT_LINES)) {
      const parts = [`👥 ${num(r.clients)}`, `💬 ${num(r.dialogues)}`];
      if (r.canRevenue) parts.push(`ФД ${num(r.fd)}`, money(r.revenue));
      lines.push(`• <b>${escapeTelegramHtml(r.name)}</b> — ${parts.join(' · ')}`);
    }
    if (rows.length > MAX_PROJECT_LINES) lines.push(`…и ещё ${rows.length - MAX_PROJECT_LINES}`);
    lines.push('', 'Кнопки ниже открывают проект в CRM прямо в Telegram.');
    const base = `${this.config.get<string>('APP_URL')}/tg?b=${botRowId}`;
    const buttons = rows.slice(0, MAX_PROJECT_BUTTONS).map((r) => ({ text: r.name.slice(0, 60), web_app: { url: `${base}&next=${encodeURIComponent(`/projects/${r.id}`)}` } }));
    const inline: { text: string; web_app: { url: string } }[][] = [];
    for (let i = 0; i < buttons.length; i += 2) inline.push(buttons.slice(i, i + 2));
    return { html: lines.join('\n'), markup: { inline_keyboard: inline } };
  }
}
