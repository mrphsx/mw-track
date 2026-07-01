'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PushContentStep, PushContent } from '@/components/pushes/push-content-step';
import { PushAudienceStep, PushAudienceFilter } from '@/components/pushes/push-audience-step';

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
    messageMedia: content.mediaUrl ? { type: content.mediaType, url: content.mediaUrl } : undefined,
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

  const [content, setContent] = useState<PushContent>({ name: '', messageText: '', mediaUrl: '', mediaType: 'photo', buttons: [] });
  const [filter, setFilter] = useState<PushAudienceFilter>({
    channelTypes: [],
    hasPurchase: undefined,
    countries: '',
    minSpent: '',
    inactiveDaysMin: '',
  });
  const [audience, setAudience] = useState<{ total: number | null; reachable: number | null }>({ total: null, reachable: null });
  const [calculating, setCalculating] = useState(false);

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
          <div key={label} className={`flex items-center gap-2 text-sm ${i === step ? 'font-semibold text-blue-600' : 'text-gray-400'}`}>
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-100 text-blue-600' : 'bg-gray-100'
              }`}
            >
              {i + 1}
            </div>
            {label}
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-200 mx-1" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          {step === 0 && <PushContentStep value={content} onChange={setContent} />}
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
              <p className="text-sm whitespace-pre-wrap">{content.messageText}</p>
              <div className="flex gap-6 text-sm">
                <span>
                  По фильтру: <b>{audience.total}</b>
                </span>
                <span>
                  Доступны: <b>{audience.reachable}</b>
                </span>
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
          <Button onClick={goNext} disabled={(step === 0 && !content.name) || createPush.isPending}>
            {createPush.isPending ? 'Создаём...' : 'Далее'}
          </Button>
        ) : (
          <Button onClick={() => sendPush.mutate()} disabled={sendPush.isPending}>
            {sendPush.isPending ? 'Отправляем...' : 'Отправить'}
          </Button>
        )}
      </div>
    </div>
  );
}
