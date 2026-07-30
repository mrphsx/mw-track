'use client';

// Статистика A/B/n-группы целиком (запрос пользователя 2026-07-23: "для груп лэндингов тоже
// нужна статистика как для обычных лэндингов, сейчас просто есть группа без статистики на
// которую можно зайти как в обычный лэндинг") — раньше клик по карточке группы в /landings
// никуда не вёл (ни onClick, ни href — карточка предлагала только "Ссылка"/"Управлять"/
// "Завершить"). Эта страница — тот же набор блоков, что и у обычного лендинга
// ([landingId]/page.tsx: StatsCard-сетка, дневные графики, сравнение вариантов), плюс сумма по
// всем вариантам сверху. Работает в двух режимах: активный тест — живой пересчёт
// (LandingsService.getGroupStats), завершённый — застывший resultsSnapshot, тот же принцип, что
// уже показывает /landings/history, но теперь и по клику из самой группы, не только из общего
// списка истории.
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Eye, Link2, MessageCircle, MousePointerClick, Settings2, UserCheck, UserMinus, Users } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { DomainOption, attachmentUrl, findGroupAttachment } from '@/lib/landings';
import { AbTestDialogTarget, AbTestGroupDialog } from '@/components/landing-card';
import { GetLinkDialog, GetLinkLanding } from '@/components/get-link-dialog';
import { AbTestComparisonCard, AbTestMemberStats } from '@/components/landings/ab-test-comparison-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard } from '@/components/shared/stats-card';

interface SnapshotMember {
  landingId: string;
  name: string;
  weight: number | null;
  pageViews: number;
  leads: number;
  subscribes: number;
  dialogues: number;
}

interface GroupStatsActive {
  groupId: string;
  name: string | null;
  endedAt: null;
  members: AbTestMemberStats[];
  totals: {
    pageViews: number;
    leads: number;
    subscribes: number;
    subscribersActive: number;
    subscribersUnsubscribed: number;
    dialogues: number;
  };
  dailySubscribers: { date: string; count: number }[];
  dailyDialogues: { date: string; count: number }[];
}

interface GroupStatsEnded {
  groupId: string;
  name: string | null;
  endedAt: string;
  members: SnapshotMember[];
  totals: { pageViews: number; leads: number; subscribes: number; dialogues: number };
}

type GroupStats = GroupStatsActive | GroupStatsEnded;

function isActiveStats(stats: GroupStats): stats is GroupStatsActive {
  return stats.endedAt === null;
}

function groupLabelActive(stats: GroupStatsActive): string {
  return stats.name || stats.members.map((m) => m.landing.name).join(', ');
}
function groupLabelEnded(stats: GroupStatsEnded): string {
  return stats.name || stats.members.map((m) => m.name).join(', ');
}

export default function AbTestGroupStatsPage() {
  const { id: projectId, groupId } = useParams<{ id: string; groupId: string }>();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['ab-test-groups', groupId, 'stats'],
    queryFn: async () => (await api.get<GroupStats>(`/ab-test-groups/${groupId}/stats`)).data,
  });

  if (!stats) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return isActiveStats(stats) ? (
    <ActiveGroupStats stats={stats} projectId={projectId} groupId={groupId} onChanged={() => queryClient.invalidateQueries({ queryKey: ['ab-test-groups', groupId, 'stats'] })} />
  ) : (
    <EndedGroupStats stats={stats} projectId={projectId} />
  );
}

function TotalsGrid({
  totals,
  showSubscriberBreakdown,
}: {
  totals: { pageViews: number; leads: number; subscribes: number; subscribersActive?: number; subscribersUnsubscribed?: number; dialogues: number };
  showSubscriberBreakdown: boolean;
}) {
  const leadRate = totals.pageViews > 0 ? Math.round((totals.leads / totals.pageViews) * 100) : null;
  const subscribeRate = totals.leads > 0 ? Math.round((totals.subscribes / totals.leads) * 100) : null;
  const dialogueRate = totals.subscribes > 0 ? Math.round((totals.dialogues / totals.subscribes) * 100) : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatsCard label="Просмотров" value={totals.pageViews} icon={Eye} />
      <StatsCard
        label="Кликов на кнопку"
        value={totals.leads}
        icon={MousePointerClick}
        hint={leadRate !== null ? `${leadRate}% от просмотров` : undefined}
      />
      <StatsCard
        label="Подписчиков"
        value={totals.subscribes}
        icon={Users}
        hint={subscribeRate !== null ? `${subscribeRate}% от кликов` : undefined}
      />
      {showSubscriberBreakdown && (
        <>
          <StatsCard label="Активных" value={totals.subscribersActive ?? 0} icon={UserCheck} />
          <StatsCard label="Отписалось" value={totals.subscribersUnsubscribed ?? 0} icon={UserMinus} />
        </>
      )}
      <StatsCard
        label="Диалогов начато"
        value={totals.dialogues}
        icon={MessageCircle}
        hint={dialogueRate !== null ? `${dialogueRate}% от подписчиков` : undefined}
      />
    </div>
  );
}

function ActiveGroupStats({
  stats,
  projectId,
  groupId,
  onChanged,
}: {
  stats: GroupStatsActive;
  projectId: string;
  groupId: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
  });

  const [showGetLink, setShowGetLink] = useState(false);
  const [showAbTestDialog, setShowAbTestDialog] = useState(false);

  const stopTest = useMutation({
    mutationFn: () => api.delete(`/ab-test-groups/${groupId}`),
    onSuccess: () => router.push(`/projects/${projectId}/landings/history`),
  });

  const attachment = findGroupAttachment(domains, groupId);
  const label = groupLabelActive(stats);
  const groupTarget: GetLinkLanding = { id: groupId, name: label, project: { id: projectId } };
  const abTestTarget: AbTestDialogTarget = { projectId, groupId, preselectedIds: [] };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все лендинги
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">{label}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge>Активен</Badge>
              {attachment && (
                <a
                  href={attachmentUrl(attachment)}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-mono text-muted-foreground hover:underline"
                >
                  {attachment.domain}
                  {attachment.path === '/' ? '' : attachment.path}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {attachment && (
              <Button variant="outline" onClick={() => setShowGetLink(true)}>
                <Link2 className="w-4 h-4 mr-1.5" /> Получить ссылку
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowAbTestDialog(true)}>
              <Settings2 className="w-4 h-4 mr-1.5" /> Управлять
            </Button>
            <Button variant="outline" onClick={() => confirm('Завершить тест? Цифры застынут на текущий момент.') && stopTest.mutate()}>
              Завершить тест
            </Button>
          </div>
        </div>
      </div>

      <TotalsGrid totals={stats.totals} showSubscriberBreakdown />

      <AbTestComparisonCard members={stats.members} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Подписчики по дням (всего по группе)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.dailySubscribers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет данных.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.dailySubscribers}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Диалоги по дням (всего по группе)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.dailyDialogues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет данных.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.dailyDialogues}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                  <Line type="monotone" dataKey="count" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <GetLinkDialog landing={showGetLink ? groupTarget : null} attachment={attachment} onClose={() => setShowGetLink(false)} />
      <AbTestGroupDialog
        target={showAbTestDialog ? abTestTarget : null}
        domains={domains}
        onClose={() => setShowAbTestDialog(false)}
        onSaved={onChanged}
      />
    </div>
  );
}

function EndedGroupStats({ stats, projectId }: { stats: GroupStatsEnded; projectId: string }) {
  const label = groupLabelEnded(stats);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings/history`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> История тестов
        </Link>
        <h1 className="text-2xl font-bold">{label}</h1>
        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant="secondary">Завершён</Badge>
          <span className="text-xs text-muted-foreground">до {format(new Date(stats.endedAt), 'd MMM yyyy')}</span>
        </div>
      </div>

      <TotalsGrid totals={stats.totals} showSubscriberBreakdown={false} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">По вариантам ({stats.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-4 py-1">Вариант</th>
                <th className="pr-4 py-1">%</th>
                <th className="pr-4 py-1">Просмотров</th>
                <th className="pr-4 py-1">Кликов</th>
                <th className="pr-4 py-1">Подписчиков</th>
                <th className="py-1">Диалогов</th>
              </tr>
            </thead>
            <tbody>
              {stats.members.map((m) => (
                <tr key={m.landingId} className="border-t">
                  <td className="pr-4 py-1 font-medium">{m.name}</td>
                  <td className="pr-4 py-1">{m.weight ?? 0}%</td>
                  <td className="pr-4 py-1">{m.pageViews}</td>
                  <td className="pr-4 py-1">{m.leads}</td>
                  <td className="pr-4 py-1">{m.subscribes}</td>
                  <td className="py-1">{m.dialogues}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="pr-4 py-1">Итого</td>
                <td className="pr-4 py-1" />
                <td className="pr-4 py-1">{stats.totals.pageViews}</td>
                <td className="pr-4 py-1">{stats.totals.leads}</td>
                <td className="pr-4 py-1">{stats.totals.subscribes}</td>
                <td className="py-1">{stats.totals.dialogues}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
