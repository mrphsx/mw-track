'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { format } from 'date-fns';
import { Plus, Pencil, Copy } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { PushPreviewDialog } from '@/components/pushes/push-preview-dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import { STUDIO_HUE_HEX } from '../../../colors';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

interface PushRow {
  id: string;
  name: string;
  status: string;
  audienceReachable: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface BestTimeStats {
  byHour: { hour: number; sent: number; clicked: number; ctr: number }[];
  recommendedHour: number | null;
  totalSent: number;
  totalClicked: number;
}

// Studio-версия страницы рассылок (запрос пользователя 2026-07-30: "готовить все остальные
// страницы") — логика 1:1 с классической (apps/web/.../(dashboard)/projects/[id]/pushes/page.tsx),
// сам bar-chart оптимального времени и таблица рассылок полностью переоформлены под Studio (файл
// достаточно самодостаточен — не тянет тяжёлые общие компоненты вроде LandingCard, поэтому
// полный реskin, как у Сценариев, а не оболочка-поверх-общего, как у Лендингов).
export default function StudioPushesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [previewPushId, setPreviewPushId] = useState<string | null>(null);

  const { data: pushes } = useQuery({
    queryKey: ['pushes', projectId],
    queryFn: async () => (await api.get<PushRow[]>(`/projects/${projectId}/pushes`)).data,
  });

  const cancelPush = useMutation({
    mutationFn: (pushId: string) => api.delete(`/projects/${projectId}/pushes/${pushId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pushes', projectId] }),
  });

  // Копирование (запрос пользователя 2026-08-05) — см. полный комментарий в classic-версии.
  const duplicatePush = useMutation({
    mutationFn: (pushId: string) => api.post<{ id: string }>(`/projects/${projectId}/pushes/${pushId}/duplicate`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pushes', projectId] });
      router.push(`/projects/${projectId}/pushes/${res.data.id}/edit`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Рассылки</h1>
        {hasPermission(user, projectId, 'PUSHES_CREATE') && (
          <StudioLinkButton variant="primary" icon={Plus} href={`/projects/${projectId}/pushes/new`}>
            Новая рассылка
          </StudioLinkButton>
        )}
      </div>

      <BestTimeCard projectId={projectId} />

      <div className={`${STUDIO_CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#5F6B7A] dark:text-[#92A0AF] border-b border-[#DCE1E8] dark:border-white/10">
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 font-medium">Название</th>
              <th className="px-5 py-3 font-medium">Дата</th>
              <th className="px-5 py-3 font-medium text-right">Аудитория</th>
              <th className="px-5 py-3 font-medium text-right">Отправлено</th>
              <th className="px-5 py-3 font-medium text-right">Ошибки</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
            {pushes?.map((push) => (
              <tr key={push.id} className="cursor-pointer hover:bg-[#F3F5F8] dark:hover:bg-white/5" onClick={() => setPreviewPushId(push.id)}>
                <td className="px-5 py-3">
                  <StudioPill hue={STATUS_HUE[push.status] ?? 'slate'}>{push.status}</StudioPill>
                </td>
                <td className="px-5 py-3 font-medium text-[#131A24] dark:text-[#E9EDF3]">{push.name}</td>
                <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
                  {push.sentAt
                    ? format(new Date(push.sentAt), 'd MMM HH:mm')
                    : push.scheduledAt
                      ? format(new Date(push.scheduledAt), 'd MMM HH:mm')
                      : '—'}
                </td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{push.audienceReachable}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{push.sentCount}</td>
                <td className={`px-5 py-3 text-right font-mono tabular-nums ${push.failedCount > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}>
                  {push.failedCount}
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-3">
                    {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, projectId, 'PUSHES_CREATE') && (
                      <Link
                        href={`/projects/${projectId}/pushes/${push.id}/edit`}
                        className="inline-flex items-center gap-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline"
                      >
                        <Pencil className="w-3 h-3" /> Изменить
                      </Link>
                    )}
                    {hasPermission(user, projectId, 'PUSHES_CREATE') && (
                      <button
                        type="button"
                        onClick={() => duplicatePush.mutate(push.id)}
                        disabled={duplicatePush.isPending}
                        className="inline-flex items-center gap-1 text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        <Copy className="w-3 h-3" /> Копировать
                      </button>
                    )}
                    {(push.status === 'DRAFT' || push.status === 'SCHEDULED') && hasPermission(user, projectId, 'PUSHES_DELETE') && (
                      <button
                        type="button"
                        onClick={() => cancelPush.mutate(push.id)}
                        className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline"
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pushes?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
                  Рассылок пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {previewPushId && <PushPreviewDialog key={previewPushId} projectId={projectId} pushId={previewPushId} onClose={() => setPreviewPushId(null)} />}
    </div>
  );
}

const STATUS_HUE: Record<string, 'amber' | 'sage' | 'slate' | 'plum' | 'teal'> = {
  DRAFT: 'slate',
  SCHEDULED: 'teal',
  SENDING: 'amber',
  SENT: 'sage',
  CANCELLED: 'plum',
};

// Smart Push Timing (Фаза 3.4) — тот же принцип, что и DailyCharts: recharts не понимает
// Tailwind dark:-классы для SVG-цветов, поэтому цвет берём вручную по next-themes.resolvedTheme.
function BestTimeCard({ projectId }: { projectId: string }) {
  const { data: stats } = useQuery({
    queryKey: ['pushes', projectId, 'best-time'],
    queryFn: async () => (await api.get<BestTimeStats>(`/projects/${projectId}/pushes/stats/best-time`)).data,
  });
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';
  const accent = isDark ? STUDIO_HUE_HEX.amber.dark : STUDIO_HUE_HEX.amber.light;
  const muted = isDark ? '#3A4552' : '#C7D0DA';
  const gridColor = isDark ? '#ffffff' : '#000000';

  if (!stats) return null;

  if (stats.totalSent === 0) {
    return (
      <div className={`${STUDIO_CARD} p-5`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-2">Оптимальное время отправки</h2>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
          Пока нет данных — статистика появится, когда рассылки с кнопками начнут набирать клики.
        </p>
      </div>
    );
  }

  const chartData = Array.from({ length: 24 }, (_, hour) => stats.byHour.find((h) => h.hour === hour) ?? { hour, sent: 0, clicked: 0, ctr: 0 });

  return (
    <div className={`${STUDIO_CARD} p-5`}>
      <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3] mb-3">Оптимальное время отправки</h2>
      <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mb-3">
        {stats.recommendedHour !== null ? (
          <>
            Лучшее время: <span className="font-medium text-[#131A24] dark:text-[#E9EDF3]">{stats.recommendedHour}:00</span>
          </>
        ) : (
          'Пока недостаточно данных для рекомендации.'
        )}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.1} />
          <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} fontSize={12} interval={1} stroke={gridColor} strokeOpacity={0.3} />
          <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke={gridColor} strokeOpacity={0.3} />
          <Tooltip
            labelFormatter={(h) => `${h}:00`}
            formatter={(v, name) => (name === 'ctr' ? [`${(Number(v) * 100).toFixed(1)}%`, 'CTR'] : [v, name])}
            contentStyle={{ background: isDark ? '#171F2B' : '#FFFFFF', border: `1px solid ${isDark ? '#232B38' : '#DCE1E8'}`, borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="ctr" radius={[4, 4, 0, 0]}>
            {chartData.map((d) => (
              <Cell key={d.hour} fill={d.hour === stats.recommendedHour ? accent : muted} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

