'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../ui';

interface BroadcastRow {
  id: string;
  name: string;
  status: string;
  audienceTotal: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface ProjectDetail {
  id: string;
  channel: { tgPersonalConnected: boolean } | null;
}

const STATUS_HUE: Record<string, 'amber' | 'sage' | 'slate' | 'plum' | 'teal'> = {
  DRAFT: 'slate',
  SCHEDULED: 'teal',
  SENDING: 'amber',
  SENT: 'sage',
  FAILED: 'plum',
  CANCELLED: 'plum',
};

// Studio-версия — та же логика, что и classic (.../projects/[id]/personal-broadcasts/page.tsx),
// см. её для полного комментария. Здесь только Studio-оформление.
export default function StudioPersonalBroadcastsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${projectId}`)).data,
  });

  const { data: broadcasts } = useQuery({
    queryKey: ['personal-broadcasts', projectId],
    queryFn: async () => (await api.get<BroadcastRow[]>(`/projects/${projectId}/personal-broadcasts`)).data,
    enabled: !!project?.channel?.tgPersonalConnected,
  });

  const cancel = useMutation({
    mutationFn: (broadcastId: string) => api.delete(`/projects/${projectId}/personal-broadcasts/${broadcastId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['personal-broadcasts', projectId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Рассылка с личного аккаунта</h1>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">
            Всем, у кого есть реальный диалог с подключённым личным Telegram-аккаунтом
          </p>
        </div>
        {project?.channel?.tgPersonalConnected && hasPermission(user, projectId, 'PERSONAL_BROADCASTS_CREATE') && (
          <StudioLinkButton variant="primary" icon={Plus} href={`/projects/${projectId}/personal-broadcasts/new`}>
            Новая рассылка
          </StudioLinkButton>
        )}
      </div>

      {project && !project.channel?.tgPersonalConnected && (
        <div className={`${STUDIO_CARD} p-6 text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
          К этому проекту не подключён личный Telegram-аккаунт — подключите его в настройках проекта, чтобы начать рассылку.
        </div>
      )}

      {project?.channel?.tgPersonalConnected && (
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
                <th className="px-5 py-3 font-medium text-right">Пропущено</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE1E8] dark:divide-white/10">
              {broadcasts?.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <StudioPill hue={STATUS_HUE[b.status] ?? 'slate'}>{b.status}</StudioPill>
                  </td>
                  <td className="px-5 py-3 font-medium text-[#131A24] dark:text-[#E9EDF3]">{b.name}</td>
                  <td className="px-5 py-3 text-[#5F6B7A] dark:text-[#92A0AF] whitespace-nowrap">
                    {b.sentAt
                      ? format(new Date(b.sentAt), 'd MMM HH:mm')
                      : b.scheduledAt
                        ? format(new Date(b.scheduledAt), 'd MMM HH:mm')
                        : '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{b.audienceTotal}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-[#131A24] dark:text-[#E9EDF3]">{b.sentCount}</td>
                  <td
                    className={`px-5 py-3 text-right font-mono tabular-nums ${b.failedCount > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}
                  >
                    {b.failedCount}
                  </td>
                  <td
                    className={`px-5 py-3 text-right font-mono tabular-nums ${b.skippedCount > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-[#131A24] dark:text-[#E9EDF3]'}`}
                  >
                    {b.skippedCount}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(b.status === 'DRAFT' || b.status === 'SCHEDULED' || b.status === 'SENDING') &&
                      hasPermission(user, projectId, 'PERSONAL_BROADCASTS_DELETE') && (
                        <button
                          type="button"
                          onClick={() => cancel.mutate(b.id)}
                          className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] underline-offset-2 hover:underline"
                        >
                          Отменить
                        </button>
                      )}
                  </td>
                </tr>
              ))}
              {broadcasts?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-[#5F6B7A] dark:text-[#92A0AF]">
                    Рассылок пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
