'use client';

// Журнал реквизитов — company-wide страница (запрос пользователя 2026-08-29: "сделай отдельную
// страницу... список проектов, когда выбираешь показывает его журнал"). Заменяет прежний
// единственный вход через кнопку на странице проекта — та кнопка теперь ведёт сюда же, с
// прешелченным projectId (тот же приём, что у /pushes/new). Только Owner (см.
// ProjectsService.getPaymentDetailsLog — доступ проверяется всё равно на бэкенде, здесь просто
// не показываем список тем, кому запрос вернёт 403).
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { hasChannelAvatar } from '@/lib/landings';
import { PaymentDetailsLogList } from './payment-details-log-list';

interface ProjectSummary {
  id: string;
  name: string;
  channel: { id: string; tgAvatarFileId: string | null; tgPersonalConnected?: boolean } | null;
}

interface PaymentDetailsLogSummaryItem {
  projectId: string;
  todayCount: number;
  lastSentAt: string | null;
}

export function PaymentDetailsLogPage({ containerClassName }: { containerClassName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedProjectId = searchParams.get('projectId');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'payment-details-log-picker'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  // Количество за сегодня + время с последней записи (запрос пользователя 2026-08-29) — не
  // грузится, если открыта уже выбранная страница журнала (незачем на детальном экране).
  const { data: summaries } = useQuery({
    queryKey: ['payment-details-log-summary'],
    queryFn: async () => (await api.get<PaymentDetailsLogSummaryItem[]>('/projects/payment-details-log-summary')).data,
    enabled: !selectedProjectId,
  });
  const summaryByProject = new Map((summaries || []).map((s) => [s.projectId, s]));

  const eligibleProjects = (projects || []).filter((p) => p.channel?.tgPersonalConnected);
  const selectedProject = eligibleProjects.find((p) => p.id === selectedProjectId);

  if (selectedProjectId && selectedProject) {
    return (
      <div className={containerClassName}>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => router.push('/payment-details-log')}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Все проекты
        </Button>
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <ChannelAvatar channelId={selectedProject.channel!.id} hasAvatar={hasChannelAvatar(selectedProject.channel!)} fallbackLetter={selectedProject.name} />
          <span className="font-medium text-foreground">{selectedProject.name}</span>
        </div>
        <PaymentDetailsLogList projectId={selectedProject.id} />
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Журнал реквизитов</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Выберите проект, чтобы посмотреть его журнал.</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : eligibleProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет проектов с подключённым личным аккаунтом.</p>
      ) : (
        <div className="space-y-2">
          {eligibleProjects.map((project) => {
            const summary = summaryByProject.get(project.id);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => router.push(`/payment-details-log?projectId=${project.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
              >
                <ChannelAvatar channelId={project.channel!.id} hasAvatar={hasChannelAvatar(project.channel!)} fallbackLetter={project.name} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{project.name}</div>
                  {summary && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {summary.todayCount === 0 ? 'Сегодня записей нет' : `Сегодня: ${summary.todayCount}`}
                      {summary.lastSentAt && (
                        <> · последняя {formatDistanceToNow(new Date(summary.lastSentAt), { addSuffix: true, locale: ru })}</>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
