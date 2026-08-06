'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { zonedTimeToUtcIso, getBrowserTimezone } from '@/lib/timezone';
import { TimezoneInput } from '@/components/timezone-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PersonalBroadcastVariantEditor, PersonalBroadcastVariant } from '@/components/personal-broadcasts/variant-editor';
import {
  PersonalBroadcastAudienceFilters,
  PersonalBroadcastFilterState,
  EMPTY_PERSONAL_BROADCAST_FILTER,
  buildPersonalBroadcastFilterPayload,
} from '@/components/personal-broadcasts/audience-filters';
import { STUDIO_CARD, StudioLinkButton } from '../../../../ui';

interface ProjectDetail {
  id: string;
  channel: { tgPersonalConnected: boolean } | null;
}

const EMPTY_VARIANT: PersonalBroadcastVariant = { messageText: '', mediaUrl: undefined, buttons: [] };

// Studio-версия — та же логика, что и classic (.../projects/[id]/personal-broadcasts/new/page.tsx),
// см. её для полного комментария. Здесь только Studio-оформление.
export default function StudioNewPersonalBroadcastPage() {
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
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Новая рассылка с личного аккаунта</h1>
        <div className={`${STUDIO_CARD} p-6 text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          К этому проекту не подключён личный Telegram-аккаунт — подключите его в настройках проекта.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Новая рассылка с личного аккаунта</h1>

      <div className={`${STUDIO_CARD} p-6`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Название рассылки (внутреннее)</h2>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg" />
      </div>

      <div className={`${STUDIO_CARD} p-6 space-y-6`}>
        <div>
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Варианты сообщения</h2>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">
            Несколько вариантов — аудитория делится между ними поровну (анти-спам: одинаковый текст всем подряд Telegram
            распознаёт как спам-паттерн).
          </p>
        </div>
        {variants.map((v, i) => (
          <div key={i} className={i > 0 ? 'pt-6 border-t border-[#DCE1E8] dark:border-white/10' : undefined}>
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
        <StudioLinkButton size="sm" onClick={addVariant}>
          + Добавить вариант
        </StudioLinkButton>
      </div>

      <div className={`${STUDIO_CARD} p-6`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Фильтры получателей</h2>
        <PersonalBroadcastAudienceFilters
          value={filter}
          onChange={setFilter}
          folders={folders ?? []}
          audienceTotal={audienceTotal}
          isCalculating={isCalculating}
          containerClassName={STUDIO_CARD}
        />
      </div>

      <div className={`${STUDIO_CARD} p-6`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Задержка между отправками</h2>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1 mb-3">
          Случайная пауза в этом диапазоне перед каждым следующим получателем — снижает риск блокировки аккаунта за спам.
        </p>
        <div className="flex gap-4">
          <div className="space-y-1.5">
            <Label>Минимум, сек</Label>
            <Input type="number" min={1} value={delayMinSeconds} onChange={(e) => setDelayMinSeconds(e.target.value)} className="w-28 rounded-lg" />
          </div>
          <div className="space-y-1.5">
            <Label>Максимум, сек</Label>
            <Input type="number" min={1} value={delayMaxSeconds} onChange={(e) => setDelayMaxSeconds(e.target.value)} className="w-28 rounded-lg" />
          </div>
        </div>
      </div>

      <div className={`${STUDIO_CARD} p-6 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Отправка</h2>
          <label className="flex items-center gap-2 text-sm text-[#131A24] dark:text-[#E9EDF3] cursor-pointer">
            <Checkbox checked={sendMode === 'now'} onCheckedChange={() => setSendMode(sendMode === 'now' ? 'scheduled' : 'now')} />
            Отправить сейчас
          </label>
        </div>
        <div className={`space-y-3 ${sendMode === 'now' ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex gap-2">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="w-40 rounded-lg" />
            <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} className="w-32 rounded-lg" />
          </div>
          <TimezoneInput
            value={timezone}
            onChange={setTimezone}
            id="studio-personal-broadcast-timezone"
            label="Часовой пояс отправки"
            hint="По умолчанию — ваш текущий пояс. Дата/время выше считаются в нём."
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <StudioLinkButton variant="primary" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
        {submit.isPending ? 'Создаём...' : 'Создать рассылку'}
      </StudioLinkButton>
    </div>
  );
}
