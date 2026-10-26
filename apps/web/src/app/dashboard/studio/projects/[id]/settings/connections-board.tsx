'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Globe,
  Inbox,
  Lock,
  Megaphone,
  MessagesSquare,
  Plus,
  Send,
  Settings2,
  Target,
  User,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Project } from '../../../../../(dashboard)/projects/[id]/settings/tabs';
import { STUDIO_CARD, StudioLinkButton } from '../../../ui';
import { EditChannelDialog, PersonalAccountConnect } from './tabs';
import { ChatOperatorsDialog, canManageChatOperators } from '@/components/chat-operators-dialog';
import { ChatProject, canUseChats, chatHref } from '@/lib/chat';
import {
  AddBotDialog,
  ExtraBot,
  ExtraBotSettingsDialog,
  ManagersDialog,
  PrimaryBotSettingsDialog,
  errorMessage,
  useChannelAdminCheck,
  usePrimaryBot,
} from './bots-section';

const MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';
const FG = 'text-[#131A24] dark:text-[#E9EDF3]';

type EntryMode = 'BOT_DIRECT' | 'PRIVATE_CHANNEL_REQUEST' | 'PUBLIC_CHANNEL_DIRECT' | 'PERSONAL_DM';

const ENTRY_TITLE: Record<EntryMode, string> = {
  BOT_DIRECT: 'Основной бот',
  PRIVATE_CHANNEL_REQUEST: 'Приватный канал (заявка)',
  PUBLIC_CHANNEL_DIRECT: 'Публичный канал',
  PERSONAL_DM: 'Личка',
};

const ENTRY_EXPLAIN: Record<EntryMode, string> = {
  BOT_DIRECT: 'Кнопка лендинга откроет чат с основным ботом. Атрибуция рекламы передаётся через Start.',
  PRIVATE_CHANNEL_REQUEST:
    'Кнопка лендинга откроет заявку в приватный канал. Основной бот должен быть администратором канала — он одобряет заявки и запускает сценарий приветствия.',
  PUBLIC_CHANNEL_DIRECT: 'Кнопка лендинга откроет публичный канал. Основной бот-администратор видит вступления.',
  PERSONAL_DM: 'Кнопка лендинга откроет личный диалог с аккаунтом. Основной бот, если он есть, продолжает работать для рассылок и сценариев.',
};

const ENTRY_ICON: Record<EntryMode, LucideIcon> = {
  BOT_DIRECT: Bot,
  PRIVATE_CHANNEL_REQUEST: Lock,
  PUBLIC_CHANNEL_DIRECT: Megaphone,
  PERSONAL_DM: User,
};

type ChannelExtra = NonNullable<Project['channel']> & {
  tgPersonalConnected?: boolean;
  tgPersonalLastError?: string | null;
};

type Chip = { icon: LucideIcon; label: string; strong?: boolean };

// «Подключения» (запрос пользователя 2026-10-24): каждое подключение — отдельная плитка с иконками
// ролей; куда ведёт лендинг выбирается одним кликом из этих же плиток («Сделать входом»), с
// проверкой требований и откатом на сервере (POST /channels/:id/entry). Канал как вход требует
// основного бота-администратора. Подробные настройки, сценарии и менеджеры — отдельными кнопками.
export function ConnectionsBoard({
  projectId,
  project,
  onOpenFunnel,
  initialDialog,
}: {
  projectId: string;
  project: Project;
  onOpenFunnel: () => void;
  // Старые ссылки ?tab=bot / ?tab=personal (Истории, индикатор лички) сразу открывают нужные настройки.
  initialDialog?: 'primary' | 'personal';
}) {
  const channel = project.channel as ChannelExtra | null;
  const user = useAuthStore((s) => s.user);
  const canManage = hasPermission(user, projectId, 'CHANNEL_MANAGE');
  const canAssignOperators = canManageChatOperators(user?.role);
  // Вход в чаты — с плиток подключений (2026-10-24, вместо кнопок наверху страницы проекта).
  // /chat/projects отдаёт только доступные пользователю чаты и непрочитанные по ним.
  const { data: chatProjects } = useQuery({
    queryKey: ['chat-projects'],
    queryFn: async () => (await api.get<ChatProject[]>('/chat/projects')).data,
    enabled: canUseChats(user),
    refetchInterval: 15000,
  });
  const chatAccess = chatProjects?.find((p) => p.id === projectId);
  const isTelegram = channel?.type === 'TELEGRAM';

  const { data: bot } = usePrimaryBot(channel?.id ?? '');
  const hasChannel = !!bot?.tgChannelId;
  const { data: admin } = useChannelAdminCheck(channel?.id ?? '', isTelegram && hasChannel);
  const { data: extraBots } = useQuery({
    queryKey: ['project', projectId, 'extra-bots'],
    queryFn: async () => (await api.get<ExtraBot[]>(`/projects/${projectId}/bots`)).data,
    enabled: isTelegram,
  });

  const [dialog, setDialog] = useState<
    | { kind: 'entry'; mode: EntryMode }
    | { kind: 'channel' }
    | { kind: 'primary' }
    | { kind: 'primary-managers' }
    | { kind: 'personal' }
    | { kind: 'add-bot' }
    | { kind: 'extra'; bot: ExtraBot }
    | { kind: 'extra-managers'; bot: ExtraBot }
    | { kind: 'operators'; resource: string }
    | null
  >(initialDialog ? { kind: initialDialog } : null);
  const queryClient = useQueryClient();

  if (!channel) {
    return <div className={`${STUDIO_CARD} p-5 text-sm text-red-600 dark:text-red-400`}>У проекта нет канала — обратитесь в поддержку.</div>;
  }
  if (!isTelegram) {
    return (
      <div className={`${STUDIO_CARD} p-5 text-sm ${MUTED}`}>
        Проект подключён как {channel.type === 'WEBSITE' ? 'сайт' : channel.type}. Настройки — кнопкой ниже.
        <div className="mt-3">
          <StudioLinkButton size="sm" icon={Settings2} onClick={() => setDialog({ kind: 'channel' })}>
            Настройки
          </StudioLinkButton>
        </div>
        <EditChannelDialog channelId={dialog?.kind === 'channel' ? channel.id : null} projectId={projectId} onClose={() => setDialog(null)} />
      </div>
    );
  }

  const entry = (channel.tgMode ?? 'BOT_DIRECT') as EntryMode;
  const hasBot = !!bot?.tgBotToken;
  const managers = bot?.tgManagerUsernames ?? [];
  const personalConnected = !!channel.tgPersonalConnected;
  const EntryIcon = ENTRY_ICON[entry];
  const entryTarget =
    entry === 'BOT_DIRECT'
      ? bot?.tgBotUsername ? `@${bot.tgBotUsername}` : 'основной бот'
      : entry === 'PERSONAL_DM'
        ? channel.tgPersonalUsername ? `@${channel.tgPersonalUsername}` : 'личка'
        : channel.tgChannelTitle || (bot?.tgChannelUsername ? `@${bot.tgChannelUsername}` : 'канал');
  const channelEntry = entry === 'PRIVATE_CHANNEL_REQUEST' || entry === 'PUBLIC_CHANNEL_DIRECT';

  return (
    <div className="space-y-5">
      {/* Цепочка входа: лендинг → выбранное подключение */}
      <div className={`${STUDIO_CARD} p-4 flex flex-wrap items-center gap-3`}>
        <FlowNode icon={Globe} title="Лендинг" />
        <ArrowRight className={`w-4 h-4 ${MUTED}`} />
        <FlowNode icon={EntryIcon} title={ENTRY_TITLE[entry]} subtitle={entryTarget} highlight />
        {entry === 'PRIVATE_CHANNEL_REQUEST' && (
          <>
            <span className={`text-xs ${MUTED}`}>заявки принимает</span>
            <FlowNode icon={Bot} title={bot?.tgBotUsername ? `@${bot.tgBotUsername}` : 'основной бот'} ok={admin?.healthy} />
          </>
        )}
        <span className={`ml-auto text-xs ${MUTED}`}>Вход меняется кнопкой «Сделать входом» на плитке ниже</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {/* Канал */}
        <Tile
          icon={entry === 'PUBLIC_CHANNEL_DIRECT' || (bot?.tgChannelUsername && !channelEntry) ? Megaphone : Lock}
          title={hasChannel ? channel.tgChannelTitle || 'Канал' : 'Канал'}
          subtitle={hasChannel ? (bot?.tgChannelUsername ? `@${bot.tgChannelUsername}` : 'приватный') : 'не подключён'}
          isEntry={channelEntry}
          status={
            !hasChannel
              ? { tone: 'off', text: 'Не подключён' }
              : admin === undefined
                ? null
                : admin.healthy
                  ? { tone: 'ok', text: 'Бот — админ' }
                  : { tone: 'error', text: 'Бот не админ' }
          }
          chips={[
            ...(channelEntry ? [{ icon: Target, label: 'Вход', strong: true }] : []),
            ...(entry === 'PRIVATE_CHANNEL_REQUEST' ? [{ icon: Inbox, label: 'Заявки через основного бота' }] : []),
            ...(channel.tgChannelMembersCount ? [{ icon: Users, label: `${channel.tgChannelMembersCount} подписчиков` }] : []),
          ]}
          error={hasChannel && admin && !admin.healthy ? admin.message || 'Основной бот не администратор канала' : undefined}
        >
          {canManage && hasChannel && hasBot && entry !== 'PRIVATE_CHANNEL_REQUEST' && (
            <StudioLinkButton size="sm" icon={Target} onClick={() => setDialog({ kind: 'entry', mode: 'PRIVATE_CHANNEL_REQUEST' })}>
              Вход: заявка
            </StudioLinkButton>
          )}
          {canManage && hasChannel && hasBot && bot?.tgChannelUsername && entry !== 'PUBLIC_CHANNEL_DIRECT' && (
            <StudioLinkButton size="sm" icon={Target} onClick={() => setDialog({ kind: 'entry', mode: 'PUBLIC_CHANNEL_DIRECT' })}>
              Вход: публичный
            </StudioLinkButton>
          )}
          <StudioLinkButton size="sm" icon={Settings2} onClick={() => setDialog({ kind: 'channel' })}>
            {hasChannel ? 'Настройки' : 'Подключить'}
          </StudioLinkButton>
        </Tile>

        {/* Основной бот */}
        <Tile
          icon={Bot}
          title={hasBot ? (bot?.tgBotUsername ? `@${bot.tgBotUsername}` : 'Бот') : 'Бота нет'}
          subtitle="Основной бот"
          isEntry={entry === 'BOT_DIRECT'}
          status={
            !hasBot
              ? { tone: 'off', text: 'Не подключён' }
              : !channel.isActive
                ? { tone: 'error', text: 'Отключён' }
                : channel.webhookStale
                  ? { tone: 'warn', text: 'Нет вебхуков' }
                  : { tone: 'ok', text: 'Работает' }
          }
          chips={
            hasBot
              ? [
                  ...(entry === 'BOT_DIRECT' ? [{ icon: Target, label: 'Вход', strong: true }] : []),
                  ...(entry === 'PRIVATE_CHANNEL_REQUEST' ? [{ icon: Inbox, label: 'Принимает заявки' }] : []),
                  { icon: Send, label: 'Рассылки' },
                  { icon: MessagesSquare, label: 'Чат' },
                  ...(managers.length ? [{ icon: UserCog, label: `Менеджеры · ${managers.length}` }] : []),
                ]
              : []
          }
          error={!channel.isActive && channel.lastError ? channel.lastError : undefined}
        >
          {hasBot && (
            <>
              {canManage && entry !== 'BOT_DIRECT' && (
                <StudioLinkButton size="sm" icon={Target} onClick={() => setDialog({ kind: 'entry', mode: 'BOT_DIRECT' })}>
                  Сделать входом
                </StudioLinkButton>
              )}
              <StudioLinkButton size="sm" icon={Settings2} onClick={() => setDialog({ kind: 'primary' })}>
                Настройки
              </StudioLinkButton>
              {chatAccess?.bot && <ChatButton href={chatHref(projectId, 'BOT')} unread={chatAccess.bot.unread} />}
              <StudioLinkButton size="sm" icon={Workflow} href={`/projects/${projectId}/scenarios`}>
                Сценарии
              </StudioLinkButton>
              <StudioLinkButton size="sm" icon={UserCog} onClick={() => setDialog({ kind: 'primary-managers' })}>
                Менеджеры
              </StudioLinkButton>
              {canAssignOperators && (
                <StudioLinkButton size="sm" icon={MessagesSquare} onClick={() => setDialog({ kind: 'operators', resource: 'BOT' })}>
                  Операторы
                </StudioLinkButton>
              )}
            </>
          )}
        </Tile>

        {/* Дополнительные боты */}
        {extraBots?.map((extra) => {
          const ok = extra.isActive && !extra.lastError;
          return (
            <Tile
              key={extra.id}
              icon={Bot}
              iconMuted
              title={extra.tgBotUsername ? `@${extra.tgBotUsername}` : 'Бот'}
              subtitle="Дополнительный бот"
              status={ok ? { tone: 'ok', text: 'Работает' } : { tone: 'error', text: 'Ошибка' }}
              chips={[
                { icon: MessagesSquare, label: 'Чат' },
                { icon: Users, label: `Подписчики · ${extra.subscribers}` },
                ...(extra.tgManagerUsernames.length ? [{ icon: UserCog, label: `Менеджеры · ${extra.tgManagerUsernames.length}` }] : []),
              ]}
              error={extra.lastError ?? undefined}
            >
              {chatAccess?.bot && <ChatButton href={chatHref(projectId, 'BOT')} />}
              {canManage && (
                <StudioLinkButton size="sm" icon={Settings2} onClick={() => setDialog({ kind: 'extra', bot: extra })}>
                  Настройки
                </StudioLinkButton>
              )}
              <StudioLinkButton size="sm" icon={UserCog} onClick={() => setDialog({ kind: 'extra-managers', bot: extra })}>
                Менеджеры
              </StudioLinkButton>
              {canAssignOperators && (
                <StudioLinkButton size="sm" icon={MessagesSquare} onClick={() => setDialog({ kind: 'operators', resource: `BOT:${extra.id}` })}>
                  Операторы
                </StudioLinkButton>
              )}
            </Tile>
          );
        })}

        {/* Личка */}
        <Tile
          icon={User}
          title={channel.tgPersonalUsername ? `@${channel.tgPersonalUsername}` : 'Личный аккаунт'}
          subtitle="Личка"
          isEntry={entry === 'PERSONAL_DM'}
          status={
            personalConnected
              ? { tone: 'ok', text: 'Подключена' }
              : channel.tgPersonalLastError
                ? { tone: 'error', text: 'Сессия отозвана' }
                : { tone: 'off', text: 'Не подключена' }
          }
          chips={[
            ...(entry === 'PERSONAL_DM' ? [{ icon: Target, label: 'Вход', strong: true }] : []),
            ...(personalConnected
              ? [
                  { icon: MessagesSquare, label: 'Чат' },
                  { icon: Send, label: 'Рассылки' },
                ]
              : []),
          ]}
          error={channel.tgPersonalLastError ? 'Telegram отозвал сессию — подключите заново' : undefined}
        >
          {chatAccess?.personal && <ChatButton href={chatHref(projectId, 'PERSONAL')} unread={chatAccess.personal.unread} />}
          {canManage && entry !== 'PERSONAL_DM' && (personalConnected || channel.tgPersonalUsername) && (
            <StudioLinkButton size="sm" icon={Target} onClick={() => setDialog({ kind: 'entry', mode: 'PERSONAL_DM' })}>
              Сделать входом
            </StudioLinkButton>
          )}
          <StudioLinkButton size="sm" icon={Settings2} onClick={() => setDialog({ kind: 'personal' })}>
            {personalConnected ? 'Настройки' : 'Подключить'}
          </StudioLinkButton>
          {canAssignOperators && personalConnected && (
            <StudioLinkButton size="sm" icon={MessagesSquare} onClick={() => setDialog({ kind: 'operators', resource: 'PERSONAL' })}>
              Операторы
            </StudioLinkButton>
          )}
        </Tile>

        {canManage && hasBot && (
          <button
            type="button"
            onClick={() => setDialog({ kind: 'add-bot' })}
            className="rounded-xl border-2 border-dashed border-[#DCE1E8] dark:border-white/10 p-4 flex flex-col items-center justify-center gap-1.5 text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:border-[#1F4E9C]/40 hover:text-[#1F4E9C] dark:hover:text-[#7BA9EE] transition-colors min-h-[140px]"
          >
            <Plus className="w-5 h-5" />
            Добавить бота
            <span className="text-xs opacity-80">свои сценарии, чат и менеджеры</span>
          </button>
        )}
      </div>

      <div className={`${STUDIO_CARD} px-4 py-3 text-sm ${MUTED} flex flex-wrap items-center justify-between gap-2`}>
        <span>Что из этого считается лидом и диалогом — во вкладке «Воронка».</span>
        <button type="button" onClick={onOpenFunnel} className="text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
          Открыть воронку →
        </button>
      </div>

      {/* Диалоги */}
      <EditChannelDialog channelId={dialog?.kind === 'channel' ? channel.id : null} projectId={projectId} onClose={() => setDialog(null)} />
      {dialog?.kind === 'primary' && (
        <PrimaryBotSettingsDialog projectId={projectId} channelId={channel.id} canManage={canManage} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'primary-managers' && (
        <ManagersDialog
          title={`Менеджеры ${bot?.tgBotUsername ? `@${bot.tgBotUsername}` : 'основного бота'}`}
          managers={managers}
          canManage={canManage}
          onClose={() => setDialog(null)}
          onSave={async (list) => {
            await api.patch(`/channels/${channel.id}`, { tgManagerUsernames: list });
            await queryClient.invalidateQueries({ queryKey: ['channel', channel.id] });
          }}
        />
      )}
      {dialog?.kind === 'personal' && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Личный аккаунт</DialogTitle>
            </DialogHeader>
            <p className={`text-sm ${MUTED}`}>Используется для чата лички, учёта диалогов, рассылок с аккаунта, журнала реквизитов и историй.</p>
            <PersonalAccountConnect channelId={channel.id} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.kind === 'add-bot' && <AddBotDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'extra' && <ExtraBotSettingsDialog projectId={projectId} bot={dialog.bot} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'extra-managers' && (
        <ManagersDialog
          title={`Менеджеры @${dialog.bot.tgBotUsername ?? ''}`}
          managers={dialog.bot.tgManagerUsernames}
          canManage={canManage}
          onClose={() => setDialog(null)}
          onSave={async (list) => {
            await api.patch(`/projects/${projectId}/bots/${dialog.bot.id}/managers`, { managerUsernames: list });
            await queryClient.invalidateQueries({ queryKey: ['project', projectId, 'extra-bots'] });
          }}
        />
      )}
      {dialog?.kind === 'operators' && (
        <ChatOperatorsDialog projectId={projectId} initialResource={dialog.resource} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'entry' && (
        <EntryDialog projectId={projectId} channelId={channel.id} mode={dialog.mode} current={entry} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function EntryDialog({
  projectId,
  channelId,
  mode,
  current,
  onClose,
}: {
  projectId: string;
  channelId: string;
  mode: EntryMode;
  current: EntryMode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/entry`, { mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      queryClient.invalidateQueries({ queryKey: ['project-funnel', projectId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Не удалось переключить вход')),
  });
  const Icon = ENTRY_ICON[mode];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Сделать входом: {ENTRY_TITLE[mode]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <Icon className="w-4 h-4 mt-0.5 text-[#1F4E9C] dark:text-[#7BA9EE] shrink-0" />
            <p className={FG}>{ENTRY_EXPLAIN[mode]}</p>
          </div>
          <ul className={`list-disc pl-5 space-y-1 ${MUTED}`}>
            <li>Сейчас вход: {ENTRY_TITLE[current]}. Уже опубликованные лендинги начнут вести по-новому сразу.</li>
            <li>Если «Воронка» не настроена вручную, правила лида и диалога по умолчанию подстроятся под новый вход.</li>
            <li>Перед переключением всё проверим; если что-то не так — останется прежний вход.</li>
          </ul>
          {error && (
            <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <StudioLinkButton onClick={onClose}>Отмена</StudioLinkButton>
            <StudioLinkButton variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Проверяем и переключаем…' : 'Переключить'}
            </StudioLinkButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChatButton({ href, unread }: { href: string; unread?: number }) {
  return (
    <span className="relative inline-flex">
      <StudioLinkButton size="sm" icon={MessagesSquare} href={href}>
        Чат
      </StudioLinkButton>
      {!!unread && (
        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}

function FlowNode({ icon: Icon, title, subtitle, highlight, ok }: { icon: LucideIcon; title: string; subtitle?: string; highlight?: boolean; ok?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5',
        highlight ? 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10' : 'bg-[#F3F5F8] dark:bg-[#0F1620]',
      )}
    >
      <Icon className={cn('w-4 h-4', highlight ? 'text-[#1F4E9C] dark:text-[#7BA9EE]' : MUTED)} />
      <div className="leading-tight">
        <div className={cn('text-sm font-medium', FG)}>{title}</div>
        {subtitle && <div className={`text-[11px] ${MUTED}`}>{subtitle}</div>}
      </div>
      {ok !== undefined && <span className={cn('w-2 h-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />}
    </div>
  );
}

const STATUS_TONE: Record<'ok' | 'warn' | 'error' | 'off', string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  off: 'bg-[#A6B4C0]',
};

function Tile({
  icon: Icon,
  iconMuted,
  title,
  subtitle,
  isEntry,
  status,
  chips,
  error,
  children,
}: {
  icon: LucideIcon;
  iconMuted?: boolean;
  title: string;
  subtitle: string;
  isEntry?: boolean;
  status: { tone: 'ok' | 'warn' | 'error' | 'off'; text: string } | null;
  chips: Chip[];
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        STUDIO_CARD,
        'p-4 flex flex-col gap-3',
        isEntry && 'ring-2 ring-[#1F4E9C]/50 dark:ring-[#7BA9EE]/50',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            iconMuted ? 'bg-[#52606B]/10 dark:bg-[#A6B4C0]/10' : 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10',
          )}
        >
          <Icon className={cn('w-5 h-5', iconMuted ? 'text-[#52606B] dark:text-[#A6B4C0]' : 'text-[#1F4E9C] dark:text-[#7BA9EE]')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('font-semibold truncate', FG)}>{title}</div>
          <div className={`text-xs truncate ${MUTED}`}>{subtitle}</div>
        </div>
        {status && (
          <span className={`inline-flex items-center gap-1.5 text-xs shrink-0 ${MUTED}`}>
            <span className={cn('w-2 h-2 rounded-full', STATUS_TONE[status.tone])} />
            {status.text}
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md',
                chip.strong
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'bg-[#F3F5F8] text-[#52606B] dark:bg-[#0F1620] dark:text-[#A6B4C0]',
              )}
            >
              <chip.icon className="w-3 h-3" />
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
        </div>
      )}

      {children && <div className="mt-auto flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

