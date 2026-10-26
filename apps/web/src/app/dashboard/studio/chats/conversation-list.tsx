'use client';

import { format, isThisYear, isToday, isYesterday } from 'date-fns';
import { Ban, Check, MessagesSquare, Pin, PinOff, Search, Star, UserRound } from 'lucide-react';
import { CHAT_STATUS_LABEL, ChatStage, ConversationListItem, assigneeName, peerDisplayName } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { TrafficBadge } from './traffic-badge';
import { ChatAvatar } from './chat-avatar';

function listTime(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'вчера';
  return format(date, isThisYear(date) ? 'dd.MM' : 'dd.MM.yy');
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  showProject,
  search,
  onSearchChange,
  filtered,
  toolbar,
  hasMore,
  onLoadMore,
  isLoading,
  emptyText,
  currentUserId,
  selection,
  footer,
  stages,
  onTogglePin,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showProject: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  // Включены ли вкладка/фильтры — для текста пустого списка.
  filtered: boolean;
  // Вкладки, фильтры, ответственный (2026-10-25) — собирает страница.
  toolbar: React.ReactNode;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoading: boolean;
  emptyText: string;
  currentUserId?: string;
  // Режим выбора нескольких диалогов для передачи пачкой (2026-10-25) — только у тимлида/админа.
  selection?: { ids: Set<string>; onToggle: (id: string) => void } | null;
  footer?: React.ReactNode;
  stages?: ChatStage[];
  // Закрепить/открепить диалог (2026-10-25) — булавка при наведении на строку.
  onTogglePin?: (c: ConversationListItem) => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2.5 border-b border-[#DCE1E8] dark:border-white/10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5F6B7A] dark:text-[#92A0AF]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Имя, @username или ID"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#F3F5F8] dark:bg-[#0F1620] text-sm text-[#131A24] dark:text-[#E9EDF3] placeholder:text-[#5F6B7A] dark:placeholder:text-[#92A0AF] outline-none focus:ring-2 focus:ring-[#1F4E9C]/30 dark:focus:ring-[#7BA9EE]/30"
          />
        </div>
        {toolbar}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
            <MessagesSquare className="w-8 h-8 opacity-40" />
            {search || filtered ? 'Ничего не найдено' : emptyText}
          </div>
        )}
        {items.map((c) => {
          const name = peerDisplayName(c);
          const checked = !!selection?.ids.has(c.id);
          const active = selection ? checked : c.id === selectedId;
          const assignee = c.assignedUserId ? (c.assignedUserId === currentUserId ? 'вы' : assigneeName(c) || 'оператор') : null;
          const stage = c.stageId ? stages?.find((st) => st.id === c.stageId) : undefined;
          const lastPinned = c.pinned && !items[items.indexOf(c) + 1]?.pinned;
          return (
            <div key={c.id} className={cn('group relative', lastPinned && 'border-b border-[#1F4E9C]/15 dark:border-[#7BA9EE]/15')}>
            {/* Закреплённый — мягкий тон акцента и тонкая полоса слева, заметно, но спокойно. */}
            {c.pinned && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#1F4E9C]/70 dark:bg-[#7BA9EE]/70" />}
            <button
              type="button"
              onClick={() => (selection ? selection.onToggle(c.id) : onSelect(c.id))}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                active
                  ? 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10'
                  : c.pinned
                    ? 'bg-[#1F4E9C]/[0.045] hover:bg-[#1F4E9C]/[0.08] dark:bg-[#7BA9EE]/[0.06] dark:hover:bg-[#7BA9EE]/[0.1]'
                    : 'hover:bg-[#F3F5F8] dark:hover:bg-white/5',
              )}
            >
              {selection && (
                <span
                  className={cn(
                    'w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors',
                    checked
                      ? 'bg-[#1F4E9C] border-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:border-[#7BA9EE] dark:text-[#0F1620]'
                      : 'border-[#DCE1E8] dark:border-white/20',
                  )}
                >
                  {checked && <Check className="w-3.5 h-3.5" />}
                </span>
              )}
              <ChatAvatar projectId={c.projectId} clientId={c.clientId} hasAvatar={c.hasAvatar} seed={c.peerId} name={name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={cn('truncate text-sm text-[#131A24] dark:text-[#E9EDF3]', c.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{name}</span>
                  <TrafficBadge source={c.trafficSource} />
                  {c.hasPurchase && (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-px rounded bg-[#1F7A6C]/10 text-[#1F7A6C] dark:bg-[#6FCBBA]/10 dark:text-[#6FCBBA]">
                      FD
                    </span>
                  )}
                  {c.pinned && <Pin className="w-3 h-3 shrink-0 -rotate-45 fill-[#1F4E9C] text-[#1F4E9C] dark:fill-[#7BA9EE] dark:text-[#7BA9EE]" aria-label="Закреплён" />}
                  {c.favorite && <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="В избранном" />}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#5F6B7A] dark:text-[#92A0AF]">{listTime(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="truncate text-[13px] text-[#5F6B7A] dark:text-[#92A0AF]">
                    {c.lastMessageDirection === 'OUT' && <span className="text-[#131A24]/70 dark:text-[#E9EDF3]/70">Вы: </span>}
                    {c.lastMessageText || '…'}
                  </span>
                  {c.isBotActive === false && <Ban className="w-3.5 h-3.5 shrink-0 text-red-500" aria-label="Заблокировал бота" />}
                  {c.unreadCount > 0 && (
                    <span className="ml-auto shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[#1F4E9C] dark:bg-[#7BA9EE] text-white dark:text-[#0F1620] text-[11px] font-semibold flex items-center justify-center">
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </span>
                  )}
                </div>
                {showProject && <div className="mt-0.5 truncate text-[11px] text-[#5F6B7A]/80 dark:text-[#92A0AF]/80">{c.projectName}</div>}
                {c.botKey && (
                  <div className="mt-0.5 truncate text-[11px] text-[#1F4E9C] dark:text-[#7BA9EE]">через @{c.botUsername ?? 'доп. бота'}</div>
                )}
                {(assignee || c.status !== 'OPEN' || c.tags.length > 0 || stage) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {stage && (
                      <span className="inline-flex max-w-[120px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium dark:brightness-150" style={{ borderColor: `${stage.color}55`, color: stage.color }}>
                        <span className="w-1.5 h-1.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                        <span className="truncate">{stage.name}</span>
                      </span>
                    )}
                    {c.status !== 'OPEN' && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          c.status === 'WAITING'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'bg-[#1F7A6C]/10 text-[#1F7A6C] dark:bg-[#6FCBBA]/10 dark:text-[#6FCBBA]',
                        )}
                      >
                        {CHAT_STATUS_LABEL[c.status]}
                      </span>
                    )}
                    {c.tags.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className="max-w-[110px] truncate rounded-full px-2 py-0.5 text-[11px] font-medium dark:brightness-150"
                        style={{ backgroundColor: `${t.color}1A`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                    {c.tags.length > 3 && <span className="text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">+{c.tags.length - 3}</span>}
                    {assignee && (
                      <span className="inline-flex max-w-[140px] items-center gap-1 rounded-full bg-[#F3F5F8] dark:bg-white/5 px-2 py-0.5 text-[11px] text-[#5F6B7A] dark:text-[#92A0AF]">
                        <UserRound className="w-3 h-3 shrink-0" />
                        <span className="truncate">{assignee}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
            {onTogglePin && !selection && (
              <button
                type="button"
                onClick={() => onTogglePin(c)}
                className={cn(
                  'absolute right-2 bottom-2 p-1 rounded-md bg-white/90 dark:bg-[#171F2B]/90 shadow-sm transition-opacity',
                  'text-[#5F6B7A] hover:text-[#1F4E9C] dark:text-[#92A0AF] dark:hover:text-[#7BA9EE]',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100',
                )}
                title={c.pinned ? 'Открепить' : 'Закрепить наверху'}
                aria-label={c.pinned ? 'Открепить' : 'Закрепить'}
              >
                {c.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
            )}
            </div>
          );
        })}
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full py-3 text-xs font-medium text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline"
          >
            Показать ещё
          </button>
        )}
      </div>
      {footer}
    </div>
  );
}
