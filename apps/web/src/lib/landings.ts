// Общие типы/хелперы для карточек лендингов — используются и на странице лендингов одного
// проекта (/projects/[id]/landings), и на общей странице всех лендингов компании (/landings).

import { api } from '@/lib/api';
import { buildAutoPath } from '@/lib/utils';
import { resolveParamMap } from '@/lib/link-params';

export type LandingType = 'TEMPLATE' | 'CUSTOM' | 'EXTERNAL';
export type LandingStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const TYPE_LABEL: Record<LandingType, string> = {
  TEMPLATE: 'Шаблон',
  CUSTOM: 'Кастомный',
  EXTERNAL: 'Внешний',
};
export const STATUS_LABEL: Record<LandingStatus, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликован',
  ARCHIVED: 'Архив',
};

// Слово после числа подписчиков на лендинге (запрос пользователя 2026-07-21) — общее и для
// создания (create-landing-dialog.tsx), и для редактирования (landing-content-card.tsx), чтобы
// не расходились по двум местам. CUSTOM_VALUE — сентинел для пункта "Свой вариант" в Select,
// сам никогда не сохраняется как значение поля.
export const SUBSCRIBERS_LABEL_PRESETS = [
  { value: 'подписчиков', label: 'Русский — «подписчиков»' },
  { value: 'subscribers', label: 'English — «subscribers»' },
  { value: 'suscriptores', label: 'Español — «suscriptores»' },
] as const;
export const SUBSCRIBERS_LABEL_CUSTOM_VALUE = '__custom__';

// Зеркалит apps/api/src/modules/landings/landings.service.ts TemplateInfo — грузится живьём
// через GET /landings/templates (единственный источник правды по списку/названиям шаблонов на
// фронтенде, запрос пользователя 2026-07-15: раньше был отдельный захардкоженный TEMPLATE_IDS
// в диалоге создания, что уже как минимум дважды приводило к рассинхрону с бэкендом).
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  customizableFields: string[];
  available?: boolean;
}

// Канал проекта — 1:1 с 2026-07-02 (см. Project.channel в prisma/schema.prisma), может быть
// любого типа (не только Telegram) — только у Telegram есть реальные deep-link/аватар,
// см. LandingRendererService.buildTelegramLink на бэкенде и channelTitle/channelHandle ниже.
export interface PrimaryChannel {
  id: string;
  type: string;
  tgChannelTitle: string | null;
  tgBotFirstName: string | null;
  tgChannelUsername: string | null;
  tgBotUsername: string | null;
  tgPersonalUsername: string | null;
  tgChannelMembersCount: number | null;
  tgAvatarFileId: string | null;
}

export interface LandingProject {
  id: string;
  name: string;
  channel: PrimaryChannel | null;
}

export interface LandingItem {
  id: string;
  name: string;
  type: LandingType;
  status: LandingStatus;
  templateId: string | null;
  project: LandingProject;
  // Точная атрибуция (Client.landingId) — сейчас работает только для каналов в режиме
  // "Приватный канал (заявка)", см. TelegramProvider.handleJoinRequest.
  _count: { clients: number };
  // A/B/n-тестирование (Фаза 3.2) — abTestGroupId общий для всех участников одной группы,
  // abTestWeight — % трафика этого конкретного лендинга внутри группы, см. AbTestGroupDialog.
  abTestGroupId: string | null;
  abTestWeight: number | null;
  // Название группы (Фаза 3.2, доп. запрос 2026-07-17) — null, если группа без имени
  // (тогда бейдж в списке лендингов собирает подпись из имён участников) или лендинг не в тесте.
  abTestGroup: { name: string | null } | null;
  // Авторедирект/клоакинг (запрос пользователя 2026-07-30: "укажи в карточке лэндинга если ли
  // там редирект и клоакинг") — поля уже приходят с бэкенда (LandingsService.findAll не
  // применяет select, только include, так что все скалярные поля Landing и так были в ответе),
  // просто не были описаны в этом типе и не отображались нигде в карточке до сих пор.
  autoRedirect: boolean;
  cloakingEnabled: boolean;
}

export function primaryChannel(landing: LandingItem): PrimaryChannel | null {
  return landing.project.channel;
}

// Подпись группы A/B-теста для бейджа на карточке (запрос пользователя 2026-07-17: "не понятно
// кто с кем в группе") — считается один раз для всего списка лендингов, а не отдельным
// запросом на группу (весь список уже загружен на странице). Название группы, если задано,
// иначе список имён участников.
export function computeAbTestGroupLabels(landings: LandingItem[] | undefined): Map<string, string> {
  const byGroup = new Map<string, LandingItem[]>();
  for (const l of landings ?? []) {
    if (!l.abTestGroupId) continue;
    const arr = byGroup.get(l.abTestGroupId) ?? [];
    arr.push(l);
    byGroup.set(l.abTestGroupId, arr);
  }

  const labels = new Map<string, string>();
  byGroup.forEach((members, groupId) => {
    const name = members.find((m) => m.abTestGroup?.name)?.abTestGroup?.name;
    labels.set(groupId, name ? `Тест: ${name}` : `Тест: ${members.map((m) => m.name).join(', ')}`);
  });
  return labels;
}

// ---- A/B/n-тесты — общие типы для списка активных (страница лендингов проекта) и истории
// завершённых (отдельная страница /projects/[id]/landings/history, запрос пользователя
// 2026-07-17: "завершенные тесты в другую страницу, эта получится слишком большой") ----

export interface AbTestSnapshotMember {
  landingId: string;
  name: string;
  weight: number | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
}

// Зеркалит GET /projects/:id/ab-test-groups (LandingsService.listAbTestGroups). endedAt пуст —
// тест активен; задан — завершён, resultsSnapshot несёт застывшие цифры за его период.
export interface AbTestGroupItem {
  id: string;
  name: string | null;
  createdAt: string;
  endedAt: string | null;
  resultsSnapshot: AbTestSnapshotMember[] | null;
  landings: { id: string; name: string; abTestWeight: number | null }[];
}

export function groupAutoLabel(group: Pick<AbTestGroupItem, 'landings'>): string {
  return group.landings.map((l) => l.name).join(', ');
}

// WhatsApp/Instagram профиль сейчас не фетчится вообще (нет фетча title/handle для них,
// см. план "Project ↔ Channel: 1:1") — для них обе функции честно вернут пустую строку,
// карточка лендинга просто не покажет название/handle, это не баг.
export function channelTitle(channel: PrimaryChannel): string {
  return channel.tgChannelTitle || channel.tgBotFirstName || '';
}

export function channelHandle(channel: PrimaryChannel): string {
  return channel.tgChannelUsername || channel.tgBotUsername || channel.tgPersonalUsername || '';
}

// ---- Привязка домена к лендингу (DomainPath) ----

// Ровно одно из двух (запрос пользователя 2026-07-17) — путь либо на конкретный лендинг, либо
// на группу A/B/n-теста напрямую, см. AbTestGroupDialog в components/landing-card.tsx.
export interface DomainPathOption {
  id: string;
  path: string;
  landingId: string | null;
  abTestGroupId: string | null;
}

export interface DomainOption {
  id: string;
  domain: string;
  paths: DomainPathOption[];
}

export interface LandingAttachment {
  domainId: string;
  domain: string;
  path: string;
  pathId: string;
}

export const NO_DOMAIN = '__none__';

export function findLandingAttachment(
  domains: DomainOption[] | undefined,
  landingId: string,
): LandingAttachment | null {
  for (const d of domains ?? []) {
    const match = d.paths.find((p) => p.landingId === landingId);
    if (match) return { domainId: d.id, domain: d.domain, path: match.path, pathId: match.id };
  }
  return null;
}

// Зеркалит findLandingAttachment выше — для путей, привязанных напрямую к группе A/B-теста
// (запрос пользователя 2026-07-17), а не к одному лендингу.
export function findGroupAttachment(
  domains: DomainOption[] | undefined,
  groupId: string,
): LandingAttachment | null {
  for (const d of domains ?? []) {
    const match = d.paths.find((p) => p.abTestGroupId === groupId);
    if (match) return { domainId: d.id, domain: d.domain, path: match.path, pathId: match.id };
  }
  return null;
}

export function attachmentUrl(a: Pick<LandingAttachment, 'domain' | 'path'>): string {
  return `https://${a.domain}${a.path === '/' ? '' : a.path}`;
}

// ---- Трекинг-ссылка с пикселем + рекламными макросами (запрос пользователя 2026-07-04) ----

export interface LinkPixel {
  id: string;
  platform: string;
  label: string | null;
  pixelId: string;
  isActive: boolean;
}

// null pixel — "все активные пиксели проекта" (сегодняшнее поведение без привязки к одному).
// Собирается конкатенацией строк, НЕ через URLSearchParams/encodeURIComponent — иначе
// {{ad.id}} и т.п. превратятся в %7B%7Bad.id%7D%7D, а Facebook подставляет макросы именно
// по буквальному "{{...}}" в URL destination (кодирование тоже валидно для Facebook, но
// пример пользователя — с сырыми скобками, соответствуем 1:1).
export function buildTrackedLink(
  attachment: Pick<LandingAttachment, 'domain' | 'path'>,
  pixel: LinkPixel | null,
  linkParamMap: Record<string, string> | null | undefined,
  // Скрытая метка баера (Фаза 3.6) — null для управленческих аккаунтов (Owner/Admin/
  // SuperAdmin, см. GetLinkDialog), тогда параметр вообще не добавляется в ссылку и клиент
  // в системе будет отмечен как "БЕЗ БАЕРА". Литеральное значение, как pixel, а не макрос.
  buyerId: string | null = null,
): string {
  const paramMap = resolveParamMap(linkParamMap);
  const base = attachmentUrl(attachment);

  const parts: string[] = [];
  // pixel.id (внутренний cuid), НЕ pixel.pixelId (внешний ID пикселя в Facebook/TikTok) — баг
  // найден и исправлен 2026-07-21: маршрутизация события к одному пикселю в TrackingProcessor
  // ищет TrackingPixel по внутреннему id, внешний ID туда никогда бы не совпал.
  if (pixel) parts.push(`${paramMap.pixelId}=${pixel.id}`);
  parts.push(`${paramMap.adId}={{ad.id}}`);
  parts.push(`${paramMap.adName}={{ad.name}}`);
  parts.push(`${paramMap.adsetId}={{adset.id}}`);
  parts.push(`${paramMap.adsetName}={{adset.name}}`);
  parts.push(`${paramMap.campaignId}={{campaign.id}}`);
  parts.push(`${paramMap.campaignName}={{campaign.name}}`);
  parts.push(`${paramMap.placement}={{placement}}`);
  parts.push(`${paramMap.siteSourceName}={{site_source_name}}`);
  if (buyerId) parts.push(`${paramMap.buyerRef}=${buyerId}`);

  return `${base}?${parts.join('&')}`;
}

// Привязывает лендинг к домену через upsert-путь эндпоинт (POST /domains/:id/paths) — путь
// вычисляется автоматически из id проекта и лендинга (см. buildAutoPath). Берёт голые id,
// а не LandingItem целиком — при создании лендинга есть только что созданный id и projectId
// со страницы, полного объекта с `project` ещё нет. Для смены/снятия привязки у уже
// существующего лендинга см. LandingDomainDialog в components/landing-card.tsx, там нужно ещё
// отвязать старый домен, если он был другим.
export async function attachLandingToDomain(
  projectId: string,
  landingId: string,
  domainId: string,
  domains: DomainOption[] | undefined,
): Promise<void> {
  const domain = domains?.find((d) => d.id === domainId);
  if (!domain) return;
  const path = buildAutoPath(
    projectId,
    landingId,
    domain.paths.filter((p) => p.landingId !== landingId).map((p) => p.path),
  );
  await api.post(`/domains/${domainId}/paths`, { path, landingId });
}

// Зеркалит attachLandingToDomain выше — привязывает домен/путь напрямую к группе A/B-теста
// (запрос пользователя 2026-07-17), не к одному лендингу. buildAutoPath не различает, чей это
// id — переиспользуется как есть.
export async function attachGroupToDomain(
  projectId: string,
  groupId: string,
  domainId: string,
  domains: DomainOption[] | undefined,
): Promise<void> {
  const domain = domains?.find((d) => d.id === domainId);
  if (!domain) return;
  const path = buildAutoPath(
    projectId,
    groupId,
    domain.paths.filter((p) => p.abTestGroupId !== groupId).map((p) => p.path),
  );
  await api.post(`/domains/${domainId}/paths`, { path, abTestGroupId: groupId });
}
