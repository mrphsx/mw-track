'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, Eye, Globe, Link2, MessageCircle, MousePointerClick, SplitSquareHorizontal, UserCheck, UserMinus, Users } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { STATUS_LABEL, TYPE_LABEL, DomainOption } from '@/lib/landings';
import { StatsCard } from '@/components/shared/stats-card';
import { ClientsTable, ClientRow } from '@/components/clients/clients-table';
import {
  LandingBehaviorFields,
  LandingBehaviorState,
  EMPTY_LANDING_BEHAVIOR,
  behaviorStateToPayload,
} from '@/components/landing-behavior-fields';
import { LandingContentCard } from '@/components/landing-content-card';
import { GetLinkDialog } from '@/components/get-link-dialog';
import { AbTestDialogTarget, AbTestGroupDialog, LandingDomainDialog, LandingDomainRef } from '@/components/landing-card';
import { AbTestComparisonCard, AbTestMemberStats, LandingVariantStats } from '@/components/landings/ab-test-comparison-card';
import { STUDIO_CARD, StudioLinkButton, StudioPill } from '../../../../ui';

// Приглушённый текст Studio (запрос пользователя 2026-08-03: "карточки просмотров, кликов итд
// в темной теме серые") — передаётся в StatsCard вместо дефолтного text-muted-foreground
// (плейсхолдер-токен, см. память dark_theme_rollout), тот же цвет, что и везде на этой странице.
const STUDIO_MUTED = 'text-[#5F6B7A] dark:text-[#92A0AF]';

interface ProjectChannelInfo {
  channel: { tgChannelMembersCount: number | null } | null;
}

interface LandingStats extends LandingVariantStats {
  abTestGroup?: { groupId: string; members: AbTestMemberStats[] };
}

interface ClientsResponse {
  items: ClientRow[];
  total: number;
}

interface LandingFull {
  id: string;
  autoRedirect: boolean;
  cloakingEnabled: boolean;
  cloakingCountries: string[];
  cloakingRedirectUrl: string | null;
}

function LandingOptionsCard({ landingId }: { landingId: string }) {
  const queryClient = useQueryClient();

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'full'],
    queryFn: async () => (await api.get<LandingFull>(`/landings/${landingId}`)).data,
  });

  const [state, setState] = useState<LandingBehaviorState>(EMPTY_LANDING_BEHAVIOR);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!landing) return;
    setState({
      autoRedirect: landing.autoRedirect,
      cloakingEnabled: landing.cloakingEnabled,
      countriesText: landing.cloakingCountries.join(', '),
      redirectUrl: landing.cloakingRedirectUrl || '',
    });
  }, [landing]);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/landings/${landingId}`, behaviorStateToPayload(state));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'full'] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить настройки'),
  });

  if (!landing) return null;

  return (
    <div className={`${STUDIO_CARD} p-5 space-y-4`}>
      <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Опции лендинга</h2>
      <LandingBehaviorFields idPrefix="opt" state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <StudioLinkButton variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Сохраняем...' : 'Сохранить'}
      </StudioLinkButton>
    </div>
  );
}

// Studio-версия детальной страницы лендинга (запрос пользователя 2026-07-30: "добей остальные
// оставшиеся страницы") — логика 1:1 с классической. LandingContentCard/LandingBehaviorFields/
// ClientsTable/GetLinkDialog/LandingDomainDialog/AbTestGroupDialog/AbTestComparisonCard
// переиспользованы без изменений (тот же принцип, что и у LandingCard на странице списка).
export default function StudioLandingStatsPage() {
  const { id: projectId, landingId } = useParams<{ id: string; landingId: string }>();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['landing', landingId, 'stats'],
    queryFn: async () => (await api.get<LandingStats>(`/landings/${landingId}/stats`)).data,
  });

  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId, 'channel-info'],
    queryFn: async () => (await api.get<ProjectChannelInfo>(`/projects/${projectId}`)).data,
  });

  const { data: clients } = useQuery({
    queryKey: ['landing', landingId, 'clients'],
    queryFn: async () => (await api.get<ClientsResponse>(`/projects/${projectId}/clients`, { params: { landingId, limit: 50 } })).data,
  });

  const leadRate = stats && stats.funnel.pageViews > 0 ? Math.round((stats.funnel.leads / stats.funnel.pageViews) * 100) : null;
  const subscribeRate = stats && stats.funnel.leads > 0 ? Math.round((stats.funnel.subscribes / stats.funnel.leads) * 100) : null;

  const [showGetLink, setShowGetLink] = useState(false);
  const [showDomainDialog, setShowDomainDialog] = useState(false);
  const [showAbTestDialog, setShowAbTestDialog] = useState(false);

  const preview = async () => {
    const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  if (!stats) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;

  const landingRef: LandingDomainRef = { id: landingId, name: stats.landing.name, project: { id: projectId } };
  const abTestTarget: AbTestDialogTarget = {
    projectId,
    groupId: stats.abTestGroup?.groupId ?? null,
    preselectedIds: stats.abTestGroup ? [] : [landingId],
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все лендинги
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3] truncate">{stats.landing.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <StudioPill hue="slate">{TYPE_LABEL[stats.landing.type]}</StudioPill>
              <StudioPill hue={stats.landing.status === 'PUBLISHED' ? 'sage' : 'slate'}>{STATUS_LABEL[stats.landing.status]}</StudioPill>
              {stats.attachment && (
                <a
                  href={`https://${stats.attachment.domain}${stats.attachment.path === '/' ? '' : stats.attachment.path}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-mono text-[#5F6B7A] dark:text-[#92A0AF] hover:underline"
                >
                  {stats.attachment.domain}
                  {stats.attachment.path === '/' ? '' : stats.attachment.path}
                </a>
              )}
            </div>
            {/* Автор (запрос пользователя 2026-08-03: "на странице лэндинга не видно кто
                создал лэндинг") */}
            {stats.landing.createdBy && (
              <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-1">
                Создал: {stats.landing.createdBy.firstName} {stats.landing.createdBy.lastName ?? ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StudioLinkButton icon={Globe} onClick={() => setShowDomainDialog(true)}>
              {stats.attachment ? 'Сменить домен' : 'Привязать домен'}
            </StudioLinkButton>
            {stats.attachment && (
              <StudioLinkButton icon={Link2} onClick={() => setShowGetLink(true)}>
                Получить ссылку
              </StudioLinkButton>
            )}
            <StudioLinkButton icon={Eye} onClick={preview}>
              Предпросмотр
            </StudioLinkButton>
            <StudioLinkButton icon={SplitSquareHorizontal} onClick={() => setShowAbTestDialog(true)}>
              {stats.abTestGroup ? 'A/B/n-тест' : 'Запустить A/B/n-тест'}
            </StudioLinkButton>
          </div>
        </div>
      </div>

      {stats.landing.type === 'TEMPLATE' && (
        <LandingContentCard
          landingId={landingId}
          channelMembersCount={project?.channel?.tgChannelMembersCount ?? null}
          containerClassName={`${STUDIO_CARD} p-5 space-y-4`}
          titleClassName="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]"
          mutedClassName="text-[#5F6B7A] dark:text-[#92A0AF]"
        />
      )}

      <LandingOptionsCard landingId={landingId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard label="Просмотров" value={stats.funnel.pageViews} icon={Eye} containerClassName={STUDIO_CARD} mutedClassName={STUDIO_MUTED} />
        <StatsCard
          label="Кликов на кнопку"
          value={stats.funnel.leads}
          icon={MousePointerClick}
          hint={leadRate !== null ? `${leadRate}% от просмотров` : undefined}
          containerClassName={STUDIO_CARD}
          mutedClassName={STUDIO_MUTED}
        />
        <StatsCard
          label="Подписчиков"
          value={stats.subscribers.total}
          icon={Users}
          hint={subscribeRate !== null ? `${subscribeRate}% от кликов` : undefined}
          containerClassName={STUDIO_CARD}
          mutedClassName={STUDIO_MUTED}
        />
        <StatsCard label="Активных" value={stats.subscribers.active} icon={UserCheck} containerClassName={STUDIO_CARD} mutedClassName={STUDIO_MUTED} />
        <StatsCard
          label="Отписалось"
          value={stats.subscribers.unsubscribed}
          icon={UserMinus}
          containerClassName={STUDIO_CARD}
          mutedClassName={STUDIO_MUTED}
        />
        <StatsCard
          label="Диалогов начато"
          value={stats.dialogues.total}
          icon={MessageCircle}
          hint={
            stats.subscribers.total > 0 ? `${Math.round((stats.dialogues.total / stats.subscribers.total) * 100)}% от подписчиков` : undefined
          }
          containerClassName={STUDIO_CARD}
          mutedClassName={STUDIO_MUTED}
        />
      </div>

      {stats.abTestGroup && <AbTestComparisonCard members={stats.abTestGroup.members} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${STUDIO_CARD} p-5 space-y-3`}>
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Подписчики по дням</h2>
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
          <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Диалоги по дням</h2>
          {stats.dialogues.dailyDialogues.length === 0 ? (
            <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Пока нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.dialogues.dailyDialogues}>
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

      <div>
        <h2 className="text-lg font-semibold mb-3 text-[#131A24] dark:text-[#E9EDF3]">Подписчики этого лендинга</h2>
        {!clients?.items.length ? (
          <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>
            Пока нет подписчиков, привязанных именно к этому лендингу.
          </div>
        ) : (
          <div className={STUDIO_CARD}>
            <ClientsTable projectId={projectId} clients={clients.items} onSelect={() => {}} />
          </div>
        )}
      </div>

      <GetLinkDialog landing={showGetLink ? landingRef : null} attachment={stats.attachment} onClose={() => setShowGetLink(false)} />
      <LandingDomainDialog
        landing={showDomainDialog ? landingRef : null}
        domains={domains}
        onClose={() => setShowDomainDialog(false)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'stats'] })}
      />
      <AbTestGroupDialog
        target={showAbTestDialog ? abTestTarget : null}
        domains={domains}
        onClose={() => setShowAbTestDialog(false)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'stats'] })}
      />
    </div>
  );
}
