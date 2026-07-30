'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { PushContentStep, PushContent } from '@/components/pushes/push-content-step';
import { PushAudienceStep, PushAudienceFilter } from '@/components/pushes/push-audience-step';
import { ScheduleCalendar } from '@/components/pushes/schedule-calendar';
import { renderTelegramHtml } from '@/lib/telegram-html';
import { STUDIO_CARD, StudioLinkButton } from '../../../../ui';

const STEPS = ['Контент', 'Аудитория', 'Подтверждение'];

function buildFilterPayload(filter: PushAudienceFilter) {
  return {
    channelTypes: filter.channelTypes.length ? filter.channelTypes : undefined,
    hasPurchase: filter.hasPurchase,
    countries: filter.countries ? filter.countries.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
    minSpent: filter.minSpent ? Number(filter.minSpent) : undefined,
    inactiveDaysMin: filter.inactiveDaysMin ? Number(filter.inactiveDaysMin) : undefined,
  };
}

function buildContentPayload(content: PushContent, filter: PushAudienceFilter) {
  return {
    name: content.name,
    messageText: content.messageText,
    messageMedia: content.media.length ? content.media : undefined,
    buttons: content.buttons.filter((b) => b.text && b.url).length ? content.buttons.filter((b) => b.text && b.url) : undefined,
    filter: buildFilterPayload(filter),
  };
}

// Studio-версия мастера создания рассылки (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. PushContentStep/PushAudienceStep/
// ScheduleCalendar переиспользованы без изменений (сложные многошаговые виджеты, тот же принцип,
// что и у ClientsFilter/PaymentModal/team/shared).
export default function StudioNewPushPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pushId, setPushId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [content, setContent] = useState<PushContent>({ name: '', messageText: '', media: [], buttons: [] });
  const [filter, setFilter] = useState<PushAudienceFilter>({
    channelTypes: [],
    hasPurchase: undefined,
    countries: '',
    minSpent: '',
    inactiveDaysMin: '',
  });
  const [audience, setAudience] = useState<{ total: number | null; reachable: number | null }>({ total: null, reachable: null });
  const [calculating, setCalculating] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const [sendMode, setSendMode] = useState<'now' | 'scheduled'>('now');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('12:00');

  const createPush = useMutation({
    mutationFn: async () => (await api.post(`/projects/${projectId}/pushes`, buildContentPayload(content, filter))).data,
    onSuccess: (push) => {
      setPushId(push.id);
      setAudience({ total: push.audienceTotal, reachable: push.audienceReachable });
      setStep(1);
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать черновик'),
  });

  const updatePush = useMutation({
    mutationFn: async () => (await api.patch(`/projects/${projectId}/pushes/${pushId}`, buildContentPayload(content, filter))).data,
    onSuccess: (push) => setAudience({ total: push.audienceTotal, reachable: push.audienceReachable }),
  });

  const sendPush = useMutation({
    mutationFn: async () => api.post(`/projects/${projectId}/pushes/${pushId}/send`),
    onSuccess: () => router.push(`/dashboard/studio/projects/${projectId}/pushes`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось отправить рассылку'),
  });

  const schedulePush = useMutation({
    mutationFn: async () => {
      const scheduledAt = new Date(`${dateStr}T${timeStr}`).toISOString();
      return api.patch(`/projects/${projectId}/pushes/${pushId}`, { scheduledAt });
    },
    onSuccess: () => router.push(`/dashboard/studio/projects/${projectId}/pushes`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось запланировать рассылку'),
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (step !== 1 || !pushId) return;
    setCalculating(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await updatePush.mutateAsync();
      setCalculating(false);
    }, 500);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, step, pushId]);

  const goNext = () => {
    setError('');
    if (step === 0) {
      if (!pushId) createPush.mutate();
      else setStep(1);
    } else if (step === 1) {
      setStep(2);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Новая рассылка</h1>

      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((label, i) => (
          <div key={label} className={`flex items-center gap-2 text-sm ${i === step ? 'font-semibold text-[#1F4E9C] dark:text-[#7BA9EE]' : 'text-[#5F6B7A] dark:text-[#92A0AF]'}`}>
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                i === step
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : i < step
                    ? 'bg-[#1F4E9C]/10 text-[#1F4E9C] dark:bg-[#7BA9EE]/10 dark:text-[#7BA9EE]'
                    : 'bg-[#DCE1E8] dark:bg-white/10 text-[#5F6B7A] dark:text-[#92A0AF]'
              }`}
            >
              {i + 1}
            </div>
            {label}
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-[#DCE1E8] dark:bg-white/10 mx-1" />}
          </div>
        ))}
      </div>

      <div className={`${STUDIO_CARD} p-6`}>
        {step === 0 && <PushContentStep projectId={projectId} value={content} onChange={setContent} onUploadingChange={setIsUploadingMedia} />}
        {step === 1 && (
          <PushAudienceStep value={filter} onChange={setFilter} audienceTotal={audience.total} audienceReachable={audience.reachable} isCalculating={calculating} />
        )}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-[#131A24] dark:text-[#E9EDF3]">{content.name}</h3>
            {content.media.length === 1 && content.media[0].type === 'photo' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={content.media[0].url} alt="" className="max-h-48 rounded-lg object-cover" />
            )}
            {content.media.length === 1 && (content.media[0].type === 'video' || content.media[0].type === 'video_note') && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={content.media[0].url} controls className="max-h-48 rounded-lg" />
            )}
            {content.media.length > 1 && (
              <div className="grid grid-cols-4 gap-1 max-w-md">
                {content.media.map((item, i) =>
                  item.type === 'photo' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={item.url} alt="" className="aspect-square rounded-lg object-cover" />
                  ) : (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video key={i} src={item.url} className="aspect-square rounded-lg object-cover" />
                  ),
                )}
              </div>
            )}
            <p className="text-sm whitespace-pre-wrap text-[#131A24] dark:text-[#E9EDF3]" dangerouslySetInnerHTML={{ __html: renderTelegramHtml(content.messageText) }} />
            <div className="flex gap-6 text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
              <span>
                По фильтру: <b className="text-[#131A24] dark:text-[#E9EDF3]">{audience.total}</b>
              </span>
              <span>
                Доступны: <b className="text-[#131A24] dark:text-[#E9EDF3]">{audience.reachable}</b>
              </span>
            </div>

            <div className="pt-4 border-t border-[#DCE1E8] dark:border-white/10 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSendMode('now')}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    sendMode === 'now'
                      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                      : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF]'
                  }`}
                >
                  Отправить сейчас
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSendMode('scheduled');
                    if (!dateStr) setDateStr(format(new Date(), 'yyyy-MM-dd'));
                  }}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    sendMode === 'scheduled'
                      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                      : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF]'
                  }`}
                >
                  Запланировать
                </button>
              </div>

              {sendMode === 'scheduled' && (
                <div className="flex flex-wrap gap-4 items-start">
                  <ScheduleCalendar
                    projectId={projectId}
                    selectedDate={dateStr ? new Date(`${dateStr}T00:00`) : null}
                    onSelectDate={(date) => setDateStr(format(date, 'yyyy-MM-dd'))}
                  />
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      Дата
                      <input
                        type="date"
                        value={dateStr}
                        onChange={(e) => setDateStr(e.target.value)}
                        className="block mt-1 border border-[#DCE1E8] dark:border-white/10 bg-transparent rounded-lg px-2 py-1.5 text-sm text-[#131A24] dark:text-[#E9EDF3]"
                      />
                    </label>
                    <label className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      Время
                      <input
                        type="time"
                        value={timeStr}
                        onChange={(e) => setTimeStr(e.target.value)}
                        className="block mt-1 border border-[#DCE1E8] dark:border-white/10 bg-transparent rounded-lg px-2 py-1.5 text-sm text-[#131A24] dark:text-[#E9EDF3]"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between">
        <StudioLinkButton disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Назад
        </StudioLinkButton>
        {step < 2 ? (
          <StudioLinkButton variant="primary" onClick={goNext} disabled={(step === 0 && (!content.name || isUploadingMedia)) || createPush.isPending}>
            {isUploadingMedia ? 'Ждём загрузку файла...' : createPush.isPending ? 'Создаём...' : 'Далее'}
          </StudioLinkButton>
        ) : sendMode === 'now' ? (
          <StudioLinkButton variant="primary" onClick={() => sendPush.mutate()} disabled={sendPush.isPending}>
            {sendPush.isPending ? 'Отправляем...' : 'Отправить'}
          </StudioLinkButton>
        ) : (
          <StudioLinkButton variant="primary" onClick={() => schedulePush.mutate()} disabled={schedulePush.isPending || !dateStr || !timeStr}>
            {schedulePush.isPending ? 'Планируем...' : `Запланировать на ${dateStr} ${timeStr}`}
          </StudioLinkButton>
        )}
      </div>
    </div>
  );
}
