'use client';

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
import { StatsCard } from '@/components/shared/stats-card';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../../../ui';

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

// Studio-версия статистики A/B/n-группы (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. AbTestComparisonCard/AbTestGroupDialog/
// GetLinkDialog переиспользованы без изменений.
export default function StudioAbTestGroupStatsPage() {
  const { id: projectId, groupId } = useParams<{ id: string; groupId: string }>();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['ab-test-groups', groupId, 'stats'],
    queryFn: async () => (await api.get<GroupStats>(`/ab-test-groups/${groupId}/stats`)).data,
  });

  if (!stats) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;

  return isActiveStats(stats) ? (
    <ActiveGroupStats
      stats={stats}
      projectId={projectId}
      groupId={groupId}
      onChanged={() => queryClient.invalidateQueries({ queryKey: ['ab-test-groups', groupId, 'stats'] })}
    />
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
    onSuccess: () => router.push(`/dashboard/studio/projects/${projectId}/landings/history`),
  });

  const attachment = findGroupAttachment(domains, groupId);
  const label = groupLabelActive(stats);
  const groupTarget: GetLinkLanding = { id: groupId, name: label, project: { id: projectId } };
  const abTestTarget: AbTestDialogTarget = { projectId, groupId, preselectedIds: [] };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/studio/projects/${projectId}/landings`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все лендинги
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3] truncate">{label}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <StudioPill hue="sage">Активен</StudioPill>
              {attachment && (
                <a
                  href={attachmentUrl(attachment)}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-mono text-[#5F6B7A] dark:text-[#92A0AF] hover:underline"
                >
                  {attachment.domain}
                  {attachment.path === '/' ? '' : attachment.path}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {attachment && (
              <StudioLinkButton icon={Link2} onClick={() => setShowGetLink(true)}>
                Получить ссылку
              </StudioLinkButton>
            )}
            <StudioLinkButton icon={Settings2} onClick={() => setShowAbTestDialog(true)}>
              Управлять
            </StudioLinkButton>
            <StudioLinkButton onClick={() => confirm('Завершить тест? Цифры застынут на текущий момент.') && stopTest.mutate()}>
              Завершить тест
            </StudioLinkButton>
          </div>
        </div>
      </div>

      <TotalsGrid totals={stats.totals} showSubscriberBreakdown />

      <AbTestComparisonCard members={stats.members} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Подписчики по дням (всего по группе)</h2>
          {stats.dailySubscribers.length === 0 ? (
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пока нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.dailySubscribers}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                <Line type="monotone" dataKey="count" stroke="#1F4E9C" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Диалоги по дням (всего по группе)</h2>
          {stats.dailyDialogues.length === 0 ? (
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пока нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.dailyDialogues}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'd MMM')} fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => format(new Date(d), 'd MMM yyyy')} />
                <Line type="monotone" dataKey="count" stroke="#1F7A6C" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
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
          href={`/dashboard/studio/projects/${projectId}/landings/history`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> История тестов
        </Link>
        <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3]">{label}</h1>
        <div className="flex items-center gap-2 mt-1.5">
          <StudioPill hue="slate">Завершён</StudioPill>
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">до {format(new Date(stats.endedAt), 'd MMM yyyy')}</span>
        </div>
      </div>

      <TotalsGrid totals={stats.totals} showSubscriberBreakdown={false} />

      <div className={`${STUDIO_CARD} p-5 space-y-3 overflow-x-auto`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">По вариантам ({stats.members.length})</h2>
        <table className="text-sm w-full">
          <thead>
            <tr className="text-left text-[#5F6B7A] dark:text-[#92A0AF]">
              <th className="pr-4 py-1 font-medium">Вариант</th>
              <th className="pr-4 py-1 font-medium">%</th>
              <th className="pr-4 py-1 font-medium">Просмотров</th>
              <th className="pr-4 py-1 font-medium">Кликов</th>
              <th className="pr-4 py-1 font-medium">Подписчиков</th>
              <th className="py-1 font-medium">Диалогов</th>
            </tr>
          </thead>
          <tbody className="text-[#131A24] dark:text-[#E9EDF3]">
            {stats.members.map((m) => (
              <tr key={m.landingId} className="border-t border-[#DCE1E8] dark:border-white/10">
                <td className="pr-4 py-1 font-medium">{m.name}</td>
                <td className="pr-4 py-1">{m.weight ?? 0}%</td>
                <td className="pr-4 py-1">{m.pageViews}</td>
                <td className="pr-4 py-1">{m.leads}</td>
                <td className="pr-4 py-1">{m.subscribes}</td>
                <td className="py-1">{m.dialogues}</td>
              </tr>
            ))}
            <tr className="border-t border-[#DCE1E8] dark:border-white/10 font-semibold">
              <td className="pr-4 py-1">Итого</td>
              <td className="pr-4 py-1" />
              <td className="pr-4 py-1">{stats.totals.pageViews}</td>
              <td className="pr-4 py-1">{stats.totals.leads}</td>
              <td className="pr-4 py-1">{stats.totals.subscribes}</td>
              <td className="py-1">{stats.totals.dialogues}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
