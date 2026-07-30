'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PushContentStep, PushContent } from '@/components/pushes/push-content-step';
import { PushAudienceStep, PushAudienceFilter } from '@/components/pushes/push-audience-step';
import { ScheduleCalendar } from '@/components/pushes/schedule-calendar';
import { renderTelegramHtml } from '@/lib/telegram-html';

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

export default function NewPushPage() {
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
  // Раньше "Далее" можно было нажать сразу после выбора файла, не дожидаясь конца асинхронной
  // загрузки — черновик пуша создавался без media вообще (баг-репорт пользователя 2026-07-18).
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Запрос пользователя 2026-07-18 "программировать рассылки на потом" — переключатель на
  // финальном шаге. dateStr/timeStr раздельно, потому что нативный <input type="time">
  // возвращает строку HH:mm, а не Date; собираем в единый момент времени только при отправке.
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
    onSuccess: () => router.push(`/projects/${projectId}/pushes`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось отправить рассылку'),
  });

  const schedulePush = useMutation({
    mutationFn: async () => {
      // Локальное время браузера — сервер группирует календарь по таймзоне ПРОЕКТА, но
      // итоговый момент времени (ISO с UTC-смещением) один и тот же независимо от того, в
      // каком часовом поясе его выбрали, конфликта нет.
      const scheduledAt = new Date(`${dateStr}T${timeStr}`).toISOString();
      return api.patch(`/projects/${projectId}/pushes/${pushId}`, { scheduledAt });
    },
    onSuccess: () => router.push(`/projects/${projectId}/pushes`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось запланировать рассылку'),
  });

  // Дебаунс пересчёта аудитории при изменении фильтра на шаге 2 —
  // PATCH уже сохранённого черновика пересчитывает audienceTotal/audienceReachable на бэкенде.
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
      <h1 className="text-2xl font-bold">Новая рассылка</h1>

      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className={`flex items-center gap-2 text-sm ${i === step ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400' : 'bg-muted'
              }`}
            >
              {i + 1}
            </div>
            {label}
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-border mx-1" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          {step === 0 && (
            <PushContentStep projectId={projectId} value={content} onChange={setContent} onUploadingChange={setIsUploadingMedia} />
          )}
          {step === 1 && (
            <PushAudienceStep
              value={filter}
              onChange={setFilter}
              audienceTotal={audience.total}
              audienceReachable={audience.reachable}
              isCalculating={calculating}
            />
          )}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold">{content.name}</h3>
              {content.media.length === 1 && content.media[0].type === 'photo' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={content.media[0].url} alt="" className="max-h-48 rounded-md object-cover" />
              )}
              {content.media.length === 1 && (content.media[0].type === 'video' || content.media[0].type === 'video_note') && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={content.media[0].url} controls className="max-h-48 rounded-md" />
              )}
              {content.media.length > 1 && (
                <div className="grid grid-cols-4 gap-1 max-w-md">
                  {content.media.map((item, i) =>
                    item.type === 'photo' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={item.url} alt="" className="aspect-square rounded-md object-cover" />
                    ) : (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video key={i} src={item.url} className="aspect-square rounded-md object-cover" />
                    ),
                  )}
                </div>
              )}
              <p
                className="text-sm whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: renderTelegramHtml(content.messageText) }}
              />
              <div className="flex gap-6 text-sm">
                <span>
                  По фильтру: <b>{audience.total}</b>
                </span>
                <span>
                  Доступны: <b>{audience.reachable}</b>
                </span>
              </div>

              <div className="pt-4 border-t space-y-3">
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={sendMode === 'now' ? 'default' : 'outline'} onClick={() => setSendMode('now')}>
                    Отправить сейчас
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={sendMode === 'scheduled' ? 'default' : 'outline'}
                    onClick={() => {
                      setSendMode('scheduled');
                      if (!dateStr) setDateStr(format(new Date(), 'yyyy-MM-dd'));
                    }}
                  >
                    Запланировать
                  </Button>
                </div>

                {sendMode === 'scheduled' && (
                  <div className="flex flex-wrap gap-4 items-start">
                    <ScheduleCalendar
                      projectId={projectId}
                      selectedDate={dateStr ? new Date(`${dateStr}T00:00`) : null}
                      onSelectDate={(date) => setDateStr(format(date, 'yyyy-MM-dd'))}
                    />
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-muted-foreground">
                        Дата
                        <input
                          type="date"
                          value={dateStr}
                          onChange={(e) => setDateStr(e.target.value)}
                          className="block mt-1 border rounded-md px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground">
                        Время
                        <input
                          type="time"
                          value={timeStr}
                          onChange={(e) => setTimeStr(e.target.value)}
                          className="block mt-1 border rounded-md px-2 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Назад
        </Button>
        {step < 2 ? (
          <Button onClick={goNext} disabled={(step === 0 && (!content.name || isUploadingMedia)) || createPush.isPending}>
            {isUploadingMedia ? 'Ждём загрузку файла...' : createPush.isPending ? 'Создаём...' : 'Далее'}
          </Button>
        ) : sendMode === 'now' ? (
          <Button onClick={() => sendPush.mutate()} disabled={sendPush.isPending}>
            {sendPush.isPending ? 'Отправляем...' : 'Отправить'}
          </Button>
        ) : (
          <Button onClick={() => schedulePush.mutate()} disabled={schedulePush.isPending || !dateStr || !timeStr}>
            {schedulePush.isPending ? 'Планируем...' : `Запланировать на ${dateStr} ${timeStr}`}
          </Button>
        )}
      </div>
    </div>
  );
}
