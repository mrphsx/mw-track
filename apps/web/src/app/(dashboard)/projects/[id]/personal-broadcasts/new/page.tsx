'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { zonedTimeToUtcIso, getBrowserTimezone } from '@/lib/timezone';
import { TimezoneInput } from '@/components/timezone-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PersonalBroadcastVariantEditor, PersonalBroadcastVariant } from '@/components/personal-broadcasts/variant-editor';
import {
  PersonalBroadcastAudienceFilters,
  PersonalBroadcastFilterState,
  EMPTY_PERSONAL_BROADCAST_FILTER,
  buildPersonalBroadcastFilterPayload,
} from '@/components/personal-broadcasts/audience-filters';

interface ProjectDetail {
  id: string;
  channel: { tgPersonalConnected: boolean } | null;
}

const EMPTY_VARIANT: PersonalBroadcastVariant = { messageText: '', mediaUrl: undefined, buttons: [] };

// Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — не переиспользует
// PushComposer целиком (контент — варианты, не альбом; аудитория заметно богаче; расписание без
// ScheduleCalendar — та завязана на push-специфичную статистику), но переиспользует то, что уже
// доказало себя в PushComposer: чекбокс "Отправить сейчас" + всегда видимые поля даты/времени
// (без прыжка кнопки сабмита) + TimezoneInput/zonedTimeToUtcIso для явного часового пояса
// отправки.
export default function NewPersonalBroadcastPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${projectId}`)).data,
  });

  const { data: folders } = useQuery({
    queryKey: ['personal-broadcast-folders', projectId],
    queryFn: async () => (await api.get<{ id: number; title: string }[]>(`/projects/${projectId}/personal-broadcasts/folders`)).data,
    enabled: !!project?.channel?.tgPersonalConnected,
  });

  const [name, setName] = useState('');
  const [variants, setVariants] = useState<PersonalBroadcastVariant[]>([{ ...EMPTY_VARIANT }]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [filter, setFilter] = useState<PersonalBroadcastFilterState>(EMPTY_PERSONAL_BROADCAST_FILTER);
  const [delayMinSeconds, setDelayMinSeconds] = useState('15');
  const [delayMaxSeconds, setDelayMaxSeconds] = useState('45');
  const [sendMode, setSendMode] = useState<'now' | 'scheduled'>('now');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [error, setError] = useState('');

  const [audienceTotal, setAudienceTotal] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  useEffect(() => {
    if (!project?.channel?.tgPersonalConnected) return;
    setIsCalculating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<{ audienceTotal: number }>(
          `/projects/${projectId}/personal-broadcasts/preview-audience`,
          buildPersonalBroadcastFilterPayload(filter),
        );
        setAudienceTotal(res.data.audienceTotal);
      } finally {
        setIsCalculating(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, project?.channel?.tgPersonalConnected]);

  const addVariant = () => setVariants((v) => [...v, { ...EMPTY_VARIANT }]);
  const removeVariant = (i: number) => setVariants((v) => v.filter((_, idx) => idx !== i));
  const updateVariant = (i: number, next: PersonalBroadcastVariant) => setVariants((v) => v.map((item, idx) => (idx === i ? next : item)));

  const submit = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/projects/${projectId}/personal-broadcasts`, {
          name,
          variants: variants.map((v) => ({
            messageText: v.messageText,
            mediaUrl: v.mediaUrl || undefined,
            buttons: v.buttons.filter((b) => b.text && b.url).length ? v.buttons.filter((b) => b.text && b.url) : undefined,
          })),
          filter: buildPersonalBroadcastFilterPayload(filter),
          delayMinSeconds: Number(delayMinSeconds) || undefined,
          delayMaxSeconds: Number(delayMaxSeconds) || undefined,
          sendNow: sendMode === 'now',
          scheduledAt: sendMode === 'scheduled' && dateStr && timeStr ? zonedTimeToUtcIso(dateStr, timeStr, timezone) : undefined,
        })
      ).data,
    onSuccess: () => router.push(`/projects/${projectId}/personal-broadcasts`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать рассылку'),
  });

  const canSubmit =
    !!project?.channel?.tgPersonalConnected &&
    name.trim() &&
    variants.every((v) => v.messageText.trim()) &&
    uploadingCount === 0 &&
    (sendMode === 'now' || (dateStr && timeStr));

  if (project && !project.channel?.tgPersonalConnected) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Новая рассылка с личного аккаунта</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            К этому проекту не подключён личный Telegram-аккаунт — подключите его в настройках проекта.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Новая рассылка с личного аккаунта</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Название рассылки (внутреннее)</CardTitle>
        </CardHeader>
        <CardContent>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Варианты сообщения</CardTitle>
          <p className="text-sm text-muted-foreground">
            Несколько вариантов — аудитория делится между ними поровну (анти-спам: одинаковый текст всем подряд Telegram
            распознаёт как спам-паттерн).
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {variants.map((v, i) => (
            <div key={i} className={i > 0 ? 'pt-6 border-t' : undefined}>
              <PersonalBroadcastVariantEditor
                projectId={projectId}
                index={i}
                value={v}
                onChange={(next) => updateVariant(i, next)}
                onRemove={variants.length > 1 ? () => removeVariant(i) : undefined}
                onUploadingChange={(uploading) => setUploadingCount((c) => Math.max(0, c + (uploading ? 1 : -1)))}
              />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addVariant}>
            + Добавить вариант
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фильтры получателей</CardTitle>
        </CardHeader>
        <CardContent>
          <PersonalBroadcastAudienceFilters
            value={filter}
            onChange={setFilter}
            folders={folders ?? []}
            audienceTotal={audienceTotal}
            isCalculating={isCalculating}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Задержка между отправками</CardTitle>
          <p className="text-sm text-muted-foreground">
            Случайная пауза в этом диапазоне перед каждым следующим получателем — снижает риск блокировки аккаунта за спам.
          </p>
        </CardHeader>
        <CardContent className="flex gap-4">
          <div className="space-y-1.5">
            <Label>Минимум, сек</Label>
            <Input type="number" min={1} value={delayMinSeconds} onChange={(e) => setDelayMinSeconds(e.target.value)} className="w-28" />
          </div>
          <div className="space-y-1.5">
            <Label>Максимум, сек</Label>
            <Input type="number" min={1} value={delayMaxSeconds} onChange={(e) => setDelayMaxSeconds(e.target.value)} className="w-28" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Отправка</CardTitle>
            <label className="flex items-center gap-2 text-sm cursor-pointer font-normal">
              <Checkbox checked={sendMode === 'now'} onCheckedChange={() => setSendMode(sendMode === 'now' ? 'scheduled' : 'now')} />
              Отправить сейчас
            </label>
          </div>
        </CardHeader>
        <CardContent className={`space-y-3 ${sendMode === 'now' ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex gap-2">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="w-40" />
            <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} className="w-32" />
          </div>
          <TimezoneInput
            value={timezone}
            onChange={setTimezone}
            id="personal-broadcast-timezone"
            label="Часовой пояс отправки"
            hint="По умолчанию — ваш текущий пояс. Дата/время выше считаются в нём."
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
        {submit.isPending ? 'Создаём...' : 'Создать рассылку'}
      </Button>
    </div>
  );
}
