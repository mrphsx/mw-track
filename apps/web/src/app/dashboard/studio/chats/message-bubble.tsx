'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { isAxiosError } from 'axios';
import { AlertCircle, Bot, Check, CheckCheck, CornerUpRight, Download, FileText, Languages, Loader2, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ru } from 'date-fns/locale';
import { CHAT_REACTIONS, ChatMessage, ChatTranslation, deleteChatMessage, langLabel, loadChatMedia, reactChatMessage, translateChatMessage } from '@/lib/chat';
import { cn, downloadBlob } from '@/lib/utils';

// Короткая цитата сообщения: текст или вид файла.
const MEDIA_WORD: Record<string, string> = { photo: 'Фото', video: 'Видео', voice: 'Голосовое', video_note: 'Кружок', audio: 'Аудио', document: 'Файл', sticker: 'Стикер', animation: 'GIF' };
export function quoteText(m: { text: string | null; mediaType: string | null }): string {
  return m.text?.trim() || (m.mediaType ? MEDIA_WORD[m.mediaType] ?? 'Файл' : 'Сообщение');
}

function useMediaUrl(messageId: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadChatMedia(messageId)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [messageId, enabled]);
  return { url, failed };
}

function MediaBlock({ message, outgoing }: { message: ChatMessage; outgoing: boolean }) {
  const type = message.mediaType!;
  // Документы грузятся только по клику — большой файл незачем тянуть ради отображения.
  const inline = type !== 'document' && type !== 'audio';
  const { url, failed } = useMediaUrl(message.id, inline && !message.error);

  if (message.error) {
    return <FileChip name={message.mediaFileName || 'Файл'} outgoing={outgoing} />;
  }

  if (!inline) {
    return (
      <FileChip
        name={message.mediaFileName || (type === 'audio' ? 'Аудио' : 'Файл')}
        outgoing={outgoing}
        onClick={async () => {
          const objectUrl = await loadChatMedia(message.id);
          const blob = await (await fetch(objectUrl)).blob();
          downloadBlob(blob, message.mediaFileName || 'file');
        }}
      />
    );
  }

  if (failed) return <div className="text-xs opacity-70 py-1">Файл недоступен</div>;
  if (!url) {
    return (
      <div className="w-48 h-32 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin opacity-50" />
      </div>
    );
  }

  switch (type) {
    case 'photo':
      return (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt="" className="max-w-[280px] max-h-[320px] rounded-lg object-cover" />
        </a>
      );
    case 'sticker':
      // Анимированные стикеры (.tgs) браузер не покажет — для них есть emoji в mediaFileName.
      return <img src={url} alt={message.mediaFileName ?? ''} className="w-32 h-32 object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />;
    case 'video':
    case 'animation':
      return <video src={url} controls={type === 'video'} autoPlay={type === 'animation'} loop={type === 'animation'} muted={type === 'animation'} className="max-w-[280px] max-h-[320px] rounded-lg" />;
    case 'video_note':
      return <video src={url} controls className="w-48 h-48 rounded-full object-cover" />;
    case 'voice':
      return <audio src={url} controls className="w-64 max-w-full" />;
    default:
      return null;
  }
}

function FileChip({ name, outgoing, onClick }: { name: string; outgoing: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm max-w-[260px] transition-colors',
        outgoing ? 'bg-white/15 hover:bg-white/25' : 'bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
      )}
    >
      <FileText className="w-5 h-5 shrink-0 opacity-80" />
      <span className="truncate flex-1">{name}</span>
      {onClick && <Download className="w-4 h-4 shrink-0 opacity-70" />}
    </button>
  );
}

// Перевод одного сообщения (2026-10-24): клик по значку — перевод, ещё клик — снова оригинал.
// Готовые переводы приходят вместе с сообщением (кеш на сервере), за новыми ходим по клику.
function useMessageTranslation(message: ChatMessage, lang: string, enabled: boolean) {
  const [fetched, setFetched] = useState<Record<string, ChatTranslation>>({});
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Сменили язык чтения — показываем оригинал, пока не попросят перевести снова.
  useEffect(() => {
    setShown(false);
    setError('');
  }, [lang]);

  const translation = fetched[lang] ?? message.translations?.[lang] ?? null;

  const toggle = async () => {
    setError('');
    if (shown) return setShown(false);
    if (!enabled) return setError('Перевод не настроен');
    if (translation) return setShown(true);
    setLoading(true);
    try {
      const result = await translateChatMessage(message.id, lang);
      setFetched((prev) => ({ ...prev, [lang]: { text: result.text, from: result.from } }));
      setShown(true);
    } catch (err) {
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось перевести');
    } finally {
      setLoading(false);
    }
  };

  return { translation: shown ? translation : null, loading, error, toggle };
}

export function MessageBubble({
  message,
  showSender,
  translateTo,
  translationEnabled,
  onReply,
  onEdit,
  album,
}: {
  message: ChatMessage;
  showSender: boolean;
  translateTo: string;
  translationEnabled: boolean;
  onReply?: () => void;
  onEdit?: () => void;
  // Альбом (2026-10-26): все сообщения группы; message — первое из них, подпись — у любого.
  album?: ChatMessage[];
}) {
  const outgoing = message.direction === 'OUT';
  const isBot = message.senderType === 'BOT';
  const time = format(new Date(message.createdAt), 'HH:mm');
  const tr = useMessageTranslation(message, translateTo, translationEnabled);
  const deleted = !!message.deletedAt;
  const ownBubble = outgoing && !isBot && !message.error && !deleted;
  // Удаление из Telegram (2026-10-26): у клиента сообщение пропадает, в CRM остаётся
  // на слабо-красном фоне с пометкой, кто и когда удалил.
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const react = useMutation({
    mutationFn: (emoji: string | null) => reactChatMessage(message.id, emoji),
    onSuccess: () => {
      setDeleteError('');
      setPickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    },
    onError: (err) => setDeleteError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось поставить реакцию'),
  });
  const isAlbum = !!album && album.length > 1;
  const caption = isAlbum ? album!.find((m) => m.text) : null;
  const remove = useMutation({
    mutationFn: () => deleteChatMessage(message.id),
    onSuccess: () => {
      setDeleteError('');
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    },
    onError: (err) => setDeleteError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось удалить'),
  });

  // Служебная запись (2026-10-25): «чат передан оператору…» — по центру ленты, как дата.
  if (message.senderType === 'SYSTEM') {
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[90%] text-center text-[11px] px-2.5 py-1 rounded-full bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]">
          {message.text} · {time}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('group/msg flex flex-col', outgoing ? 'items-end' : 'items-start')}>
      {showSender && outgoing && (
        <div className="text-[11px] font-medium text-[#5F6B7A] dark:text-[#92A0AF] mb-0.5 px-1 flex items-center gap-1">
          {isBot ? (
            <>
              <Bot className="w-3 h-3" /> Бот
            </>
          ) : (
            message.senderName || 'Оператор'
          )}
        </div>
      )}
      <div className={cn('flex items-end gap-1 max-w-[min(552px,90%)]', outgoing && 'flex-row-reverse')}>
      <div
        className={cn(
          'relative min-w-0 rounded-2xl px-3 py-2 shadow-sm',
          deleted
            ? 'bg-red-50/80 text-[#131A24] border border-red-200/80 dark:bg-red-950/25 dark:text-[#E9EDF3] dark:border-red-900/50'
            : message.error
            ? 'bg-red-50 text-red-900 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900/60'
            : !outgoing
              ? 'bg-white text-[#131A24] rounded-bl-md dark:bg-[#1C2532] dark:text-[#E9EDF3]'
              : isBot
                ? 'bg-[#E3EAF5] text-[#131A24] rounded-br-md dark:bg-[#22324A] dark:text-[#E9EDF3]'
                : 'bg-[#1F4E9C] text-white rounded-br-md dark:bg-[#3567B8]',
        )}
      >
        {message.forwardedFrom && (
          <div className={cn('mb-1 flex items-center gap-1 text-[11px] font-medium', ownBubble ? 'text-white/80' : 'text-[#1F4E9C] dark:text-[#7BA9EE]')}>
            <CornerUpRight className="w-3 h-3" /> Переслано от {message.forwardedFrom}
          </div>
        )}
        {message.replyTo && (
          <div
            className={cn(
              'mb-1.5 border-l-2 rounded-sm pl-2 py-0.5 text-xs max-w-full',
              ownBubble ? 'border-white/70 bg-white/10 text-white/85' : 'border-[#1F4E9C] dark:border-[#7BA9EE] bg-[#1F4E9C]/5 dark:bg-white/5',
            )}
          >
            <div className={cn('font-semibold text-[11px]', ownBubble ? 'text-white' : 'text-[#1F4E9C] dark:text-[#7BA9EE]')}>
              {message.replyTo.direction === 'IN' ? 'Клиент' : 'Мы'}
            </div>
            <div className="truncate opacity-90">{quoteText(message.replyTo)}</div>
          </div>
        )}
        {isAlbum ? (
          <div className={cn('grid gap-1', album!.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3', caption ? 'mb-1.5' : '')}>
            {album!.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-lg [&_img]:w-full [&_img]:h-32 [&_img]:max-w-none [&_video]:w-full [&_video]:h-32 [&_video]:max-w-none [&_img]:object-cover [&_video]:object-cover">
                <MediaBlock message={m} outgoing={ownBubble} />
              </div>
            ))}
          </div>
        ) : (
          message.mediaType && (
            <div className={cn(message.text ? 'mb-1.5' : '')}>
              <MediaBlock message={message} outgoing={ownBubble} />
            </div>
          )
        )}
        {isAlbum
          ? caption?.text && <div className="whitespace-pre-wrap break-words text-[14px] leading-snug">{caption.text}</div>
          : message.text && <div className="whitespace-pre-wrap break-words text-[14px] leading-snug">{tr.translation?.text ?? message.text}</div>}
        <div className={cn('mt-0.5 flex justify-end gap-2 text-[10px] tabular-nums', ownBubble ? 'text-white/70' : 'opacity-50')}>
          {tr.translation && (
            <span className="italic">
              {tr.translation.from === translateTo ? `уже на языке: ${langLabel(translateTo)}` : `перевод${tr.translation.from ? ` с ${langLabel(tr.translation.from).toLowerCase()}` : ''}`}
            </span>
          )}
          {message.editedAt && (
            <span title={message.originalText ? `До правки: ${message.originalText}` : undefined} className="italic">
              изменено
            </span>
          )}
          <span>{time}</span>
          {outgoing && message.read !== null && message.read !== undefined && !deleted && (
            <span title={message.read ? 'Прочитано' : 'Доставлено, не прочитано'} className="inline-flex">
              {message.read ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
            </span>
          )}
        </div>
      </div>
      {message.text && !isAlbum && (
        <button
          type="button"
          onClick={tr.toggle}
          disabled={tr.loading}
          title={tr.translation ? 'Показать оригинал' : `Перевести на ${langLabel(translateTo).toLowerCase()}`}
          aria-label={tr.translation ? 'Показать оригинал' : 'Перевести'}
          className={cn(
            'shrink-0 mb-1 p-1 rounded-md transition-colors',
            tr.translation
              ? 'text-[#1F4E9C] bg-[#1F4E9C]/10 dark:text-[#7BA9EE] dark:bg-[#7BA9EE]/10'
              : 'text-[#5F6B7A]/60 hover:text-[#1F4E9C] hover:bg-[#1F4E9C]/10 dark:text-[#92A0AF]/60 dark:hover:text-[#7BA9EE] dark:hover:bg-[#7BA9EE]/10',
          )}
        >
          {tr.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
        </button>
      )}
      {message.canReply && (
        <div className="relative shrink-0 mb-1">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            title="Реакция"
            aria-label="Реакция"
            className={cn(
              'p-1 rounded-md text-[#5F6B7A]/60 hover:text-[#1F4E9C] hover:bg-[#1F4E9C]/10 dark:text-[#92A0AF]/60 dark:hover:text-[#7BA9EE] transition-opacity',
              pickerOpen ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100 focus:opacity-100',
            )}
          >
            <SmilePlus className="w-3.5 h-3.5" />
          </button>
          {pickerOpen && (
            <div
              className={cn(
                'absolute bottom-full mb-1 z-20 flex flex-wrap gap-0.5 w-[232px] rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg p-1.5',
                outgoing ? 'right-0' : 'left-0',
              )}
              onMouseLeave={() => setPickerOpen(false)}
            >
              {CHAT_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  disabled={react.isPending}
                  onClick={() => react.mutate(message.ourReaction === e ? null : e)}
                  className={cn('w-8 h-8 rounded-lg text-lg hover:bg-[#F3F5F8] dark:hover:bg-white/5', message.ourReaction === e && 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/15')}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {message.canReply && onReply && (
        <button
          type="button"
          onClick={onReply}
          title="Ответить"
          aria-label="Ответить"
          className="shrink-0 mb-1 p-1 rounded-md text-[#5F6B7A]/60 hover:text-[#1F4E9C] hover:bg-[#1F4E9C]/10 dark:text-[#92A0AF]/60 dark:hover:text-[#7BA9EE] opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity"
        >
          <Reply className="w-3.5 h-3.5" />
        </button>
      )}
      {message.canEdit && onEdit && !isAlbum && (
        <button
          type="button"
          onClick={onEdit}
          title="Изменить"
          aria-label="Изменить"
          className="shrink-0 mb-1 p-1 rounded-md text-[#5F6B7A]/60 hover:text-[#1F4E9C] hover:bg-[#1F4E9C]/10 dark:text-[#92A0AF]/60 dark:hover:text-[#7BA9EE] opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {message.canDelete && !isAlbum && (
        <button
          type="button"
          onClick={() => confirm('Удалить это сообщение у клиента в Telegram? В CRM оно останется с пометкой, кто удалил.') && remove.mutate()}
          disabled={remove.isPending}
          title="Удалить из Telegram"
          aria-label="Удалить из Telegram"
          className="shrink-0 mb-1 p-1 rounded-md text-[#5F6B7A]/60 hover:text-red-600 hover:bg-red-500/10 dark:text-[#92A0AF]/60 dark:hover:text-red-400 opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity"
        >
          {remove.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
      </div>
      {(message.leadReaction || message.ourReaction) && (
        <div className={cn('mt-0.5 flex gap-1 px-1', outgoing ? 'justify-end' : 'justify-start')}>
          {message.leadReaction && (
            <span title="Реакция клиента" className="text-xs rounded-full px-1.5 py-0.5 bg-white dark:bg-[#1C2532] border border-[#DCE1E8] dark:border-white/10">
              {message.leadReaction}
            </span>
          )}
          {message.ourReaction && (
            <button
              type="button"
              title="Наша реакция — нажмите, чтобы снять"
              onClick={() => react.mutate(null)}
              className="text-xs rounded-full px-1.5 py-0.5 bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/15 border border-[#1F4E9C]/30 dark:border-[#7BA9EE]/30"
            >
              {message.ourReaction}
            </button>
          )}
        </div>
      )}
      {deleted && (
        <div className="mt-1 px-1 text-[11px] text-red-600/90 dark:text-red-400/90 flex items-center gap-1">
          <Trash2 className="w-3 h-3" />
          {message.deletedByName ? `Удалено из Telegram · ${message.deletedByName}` : 'Удалено в Telegram (клиентом или с телефона)'} ·{' '}
          {format(new Date(message.deletedAt!), 'd MMM, HH:mm', { locale: ru })}
        </div>
      )}
      {deleteError && <div className="mt-1 px-1 text-[11px] text-red-600 dark:text-red-400">{deleteError}</div>}
      {tr.error && <div className="mt-1 px-1 text-[11px] text-red-600 dark:text-red-400">{tr.error}</div>}
      {message.error && (
        <div className="mt-1 px-1 text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {message.error}
        </div>
      )}
    </div>
  );
}
