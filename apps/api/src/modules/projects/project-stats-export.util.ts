// CSV-отчёт "статистика проекта за период" (запрос пользователя 2026-09-08) — один файл,
// собранный из нескольких уже существующих эндпоинтов страницы проекта (ClientsRepository.
// getProjectStats/getConversionFunnel, ProjectsService.getAdBreakdown/getLeaderboardFull), а не
// отдельная параллельная агрегация — те же цифры, что видны на самой странице, просто в
// скачиваемом виде. Секции разделены пустой строкой + строкой-заголовком — простой, надёжно
// читаемый Excel/Google Sheets формат без сторонней библиотеки (в проекте нет xlsx-зависимости,
// см. common/csv.util.ts).
import { buildCsv } from '../../common/csv.util';

interface ProjectStatsForExport {
  totalClients: number;
  activeClients: number;
  newClients: number;
  unsubscribedClients: number;
  clientsWithPurchase: number;
  conversionRate: number;
  totalRevenue: number;
  avgOrderValue: number;
  totalPageViews: number;
  totalLeads: number;
  totalFd: number;
  totalRd: number;
  totalDialogues: number;
  totalCrmDialogues: number;
  avgSubscribeToDialogueSeconds: number | null;
}

interface FunnelStage {
  stage: string;
  count: number;
  label: string;
  rate?: number;
}

interface LeaderboardRow {
  id?: string;
  buyerId?: string;
  name: string;
  clients: number;
  revenue: number;
  isDeleted?: boolean;
}

interface AdBreakdownRow {
  campaignId: string;
  campaignName: string | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
  purchases: number;
  cr: number;
}

export interface ProjectStatsExportInput {
  periodLabel: string;
  stats: ProjectStatsForExport;
  funnel: FunnelStage[];
  adBreakdown: AdBreakdownRow[];
  // null — STATS_VIEW_TEAM_LEADERBOARDS отсутствует (или активен "только свои клиенты"
  // buyer-скоуп) — та же логика, что уже применяет GET .../leaderboards.
  leaderboards: {
    buyers: LeaderboardRow[];
    pixels: LeaderboardRow[];
    landings: LeaderboardRow[];
    campaigns: LeaderboardRow[];
    sources: LeaderboardRow[];
  } | null;
  canViewRevenue: boolean;
}

function leaderboardSection(title: string, rows: LeaderboardRow[], canViewRevenue: boolean): string {
  const headers = ['Название', 'Клиенты', 'Выручка'];
  const body = rows.map((r) => [r.name + (r.isDeleted ? ' (удалён)' : ''), r.clients, canViewRevenue ? r.revenue : 0]);
  return `${title}\r\n${buildCsv(headers, body)}`;
}

export function buildProjectStatsCsv(input: ProjectStatsExportInput): string {
  const { stats, funnel, adBreakdown, leaderboards, canViewRevenue, periodLabel } = input;

  const sections: string[] = [];

  sections.push(`Статистика проекта за период: ${periodLabel}`);

  const overviewRows: Array<[string, string | number]> = [
    ['Всего клиентов', stats.totalClients],
    ['Активных клиентов', stats.activeClients],
    ['Новых за период', stats.newClients],
    ['Отписалось', stats.unsubscribedClients],
    ['С покупкой', stats.clientsWithPurchase],
    ['Конверсия в покупку, %', stats.conversionRate],
    ['Выручка', canViewRevenue ? stats.totalRevenue : 0],
    ['Средний чек', canViewRevenue ? stats.avgOrderValue : 0],
    ['Просмотры лендинга', stats.totalPageViews],
    ['Клики (лиды)', stats.totalLeads],
    ['Первых депозитов (ФД)', stats.totalFd],
    ['Повторных депозитов (РД)', stats.totalRd],
    ['Диалогов всего', stats.totalDialogues],
    ['Диалогов через CRM', stats.totalCrmDialogues],
    ['Среднее время до диалога, сек', stats.avgSubscribeToDialogueSeconds ?? ''],
  ];
  sections.push(`ОБЩАЯ СТАТИСТИКА\r\n${buildCsv(['Показатель', 'Значение'], overviewRows)}`);

  sections.push(
    `ВОРОНКА КОНВЕРСИИ\r\n${buildCsv(
      ['Этап', 'Количество', 'Конверсия от предыдущего, %'],
      funnel.map((f) => [f.label, f.count, f.rate ?? '']),
    )}`,
  );

  if (leaderboards) {
    sections.push(leaderboardSection('ТОП БАЕРОВ', leaderboards.buyers, canViewRevenue));
    sections.push(leaderboardSection('ТОП ПИКСЕЛЕЙ', leaderboards.pixels, canViewRevenue));
    sections.push(leaderboardSection('ТОП ЛЕНДИНГОВ', leaderboards.landings, canViewRevenue));
    sections.push(leaderboardSection('ТОП КАМПАНИЙ', leaderboards.campaigns, canViewRevenue));
    sections.push(leaderboardSection('ТОП ИСТОЧНИКОВ', leaderboards.sources, canViewRevenue));
  }

  sections.push(
    `РАЗБИВКА ПО ОБЪЯВЛЕНИЯМ\r\n${buildCsv(
      ['Кампания', 'Просмотры', 'Лиды', 'Подписки', 'Диалоги', 'Покупки', 'CR, %'],
      adBreakdown.map((a) => [a.campaignName || a.campaignId, a.pageViews, a.leads, a.subscribes, a.dialogues, a.purchases, a.cr]),
    )}`,
  );

  return sections.join('\r\n\r\n');
}
