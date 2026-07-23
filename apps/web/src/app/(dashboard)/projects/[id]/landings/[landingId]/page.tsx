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
import { STATUS_LABEL, TYPE_LABEL, LandingType, LandingStatus, DomainOption } from '@/lib/landings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface ProjectChannelInfo {
  channel: { tgChannelMembersCount: number | null } | null;
}

interface LandingVariantStats {
  landing: { id: string; name: string; type: LandingType; status: LandingStatus };
  subscribers: { total: number; active: number; unsubscribed: number };
  funnel: { pageViews: number; leads: number; subscribes: number };
  dialogues: { total: number; dailyDialogues: { date: string; count: number }[] };
  dailySubscribers: { date: string; count: number }[];
  attachment: { domain: string; path: string } | null;
}

// A/B/n-тестирование (Фаза 3.2) — присутствует, только если лендинг состоит в группе
// (см. LandingsService.getStats: computeLandingStats зовётся по разу на каждого участника).
interface AbTestMemberStats extends LandingVariantStats {
  weight: number;
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

// Опции лендинга (запрос пользователя 2026-07-03): авторедирект в Telegram без клика по
// кнопке и клоакинг по странам (allow-list + резервная ссылка для остальных). Отдельный
// GET /landings/:id (не /stats — тот про аналитику, эти поля про поведение самого лендинга),
// PATCH сохраняет всё сразу одним запросом.
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Опции лендинга</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LandingBehaviorFields idPrefix="opt" state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} />

        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LandingStatsPage() {
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

  // Точная привязка "подписчик пришёл именно с этого лендинга" сейчас работает только для
  // приватных каналов с заявкой (см. Client.landingId) — для других режимов список будет
  // пустым, даже если у лендинга есть реальные подписчики канала в целом (см. карточку
  // проекта/канала для общей цифры).
  const { data: clients } = useQuery({
    queryKey: ['landing', landingId, 'clients'],
    queryFn: async () => (await api.get<ClientsResponse>(`/projects/${projectId}/clients`, { params: { landingId, limit: 50 } })).data,
  });

  const leadRate = stats && stats.funnel.pageViews > 0 ? Math.round((stats.funnel.leads / stats.funnel.pageViews) * 100) : null;
  const subscribeRate = stats && stats.funnel.leads > 0 ? Math.round((stats.funnel.subscribes / stats.funnel.leads) * 100) : null;

  const [showGetLink, setShowGetLink] = useState(false);
  const [showDomainDialog, setShowDomainDialog] = useState(false);
  const [showAbTestDialog, setShowAbTestDialog] = useState(false);

  // /landings/:id/preview требует авторизации (JWT) — обычный <a href> не донесёт токен,
  // поэтому грузим как блоб через тот же api-клиент, что и остальной SPA, и открываем
  // готовый HTML в новой вкладке (тот же паттерн, что и на /projects/[id]/landings).
  const preview = async () => {
    const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  if (!stats) return <p className="text-sm text-gray-500">Загрузка...</p>;

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
          className="text-sm text-gray-500 hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Все лендинги
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{stats.landing.name}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline">{TYPE_LABEL[stats.landing.type]}</Badge>
              <Badge variant={stats.landing.status === 'PUBLISHED' ? 'default' : 'secondary'}>
                {STATUS_LABEL[stats.landing.status]}
              </Badge>
              {stats.attachment && (
                <a
                  href={`https://${stats.attachment.domain}${stats.attachment.path === '/' ? '' : stats.attachment.path}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-mono text-gray-500 hover:underline"
                >
                  {stats.attachment.domain}
                  {stats.attachment.path === '/' ? '' : stats.attachment.path}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowDomainDialog(true)}>
              <Globe className="w-4 h-4 mr-1.5" /> {stats.attachment ? 'Сменить домен' : 'Привязать домен'}
            </Button>
            {stats.attachment && (
              <Button variant="outline" onClick={() => setShowGetLink(true)}>
                <Link2 className="w-4 h-4 mr-1.5" /> Получить ссылку
              </Button>
            )}
            <Button variant="outline" onClick={preview}>
              <Eye className="w-4 h-4 mr-1.5" /> Предпросмотр
            </Button>
            <Button variant="outline" onClick={() => setShowAbTestDialog(true)}>
              <SplitSquareHorizontal className="w-4 h-4 mr-1.5" /> {stats.abTestGroup ? 'A/B/n-тест' : 'Запустить A/B/n-тест'}
            </Button>
          </div>
        </div>
      </div>

      {stats.landing.type === 'TEMPLATE' && (
        <LandingContentCard landingId={landingId} channelMembersCount={project?.channel?.tgChannelMembersCount ?? null} />
      )}

      <LandingOptionsCard landingId={landingId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard label="Просмотров" value={stats.funnel.pageViews} icon={Eye} />
        <StatsCard
          label="Кликов на кнопку"
          value={stats.funnel.leads}
          icon={MousePointerClick}
          hint={leadRate !== null ? `${leadRate}% от просмотров` : undefined}
        />
        <StatsCard
          label="Подписчиков"
          value={stats.subscribers.total}
          icon={Users}
          hint={subscribeRate !== null ? `${subscribeRate}% от кликов` : undefined}
        />
        <StatsCard label="Активных" value={stats.subscribers.active} icon={UserCheck} />
        <StatsCard label="Отписалось" value={stats.subscribers.unsubscribed} icon={UserMinus} />
        <StatsCard
          label="Диалогов начато"
          value={stats.dialogues.total}
          icon={MessageCircle}
          hint={
            stats.subscribers.total > 0 ? `${Math.round((stats.dialogues.total / stats.subscribers.total) * 100)}% от подписчиков` : undefined
          }
        />
      </div>

      {stats.abTestGroup && <AbTestComparisonCard members={stats.abTestGroup.members} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Подписчики по дням</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.dailySubscribers.length === 0 ? (
              <p className="text-sm text-gray-500">Пока нет данных.</p>
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
            <CardTitle className="text-base">Диалоги по дням</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.dialogues.dailyDialogues.length === 0 ? (
              <p className="text-sm text-gray-500">Пока нет данных.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.dialogues.dailyDialogues}>
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

      <div>
        <h2 className="text-lg font-semibold mb-3">Подписчики этого лендинга</h2>
        {!clients?.items.length ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              Пока нет подписчиков, привязанных именно к этому лендингу.
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg bg-white">
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

// Сравнительный блок A/B/n (Фаза 3.2, расширено с пары до произвольного числа вариантов) —
// та же форма конверсии, что и обычные StatsCard выше (клики/просмотры, подписки/клики),
// просто рядом для всех участников группы сразу — по одной строке на каждого.
function AbTestComparisonCard({ members }: { members: AbTestMemberStats[] }) {
  const row = (label: string, member: AbTestMemberStats) => {
    const leadRate = member.funnel.pageViews > 0 ? Math.round((member.funnel.leads / member.funnel.pageViews) * 100) : null;
    const subscribeRate = member.funnel.leads > 0 ? Math.round((member.funnel.subscribes / member.funnel.leads) * 100) : null;
    return (
      <div key={member.landing.id} className="border rounded-md p-3 space-y-2">
        <p className="font-medium truncate">
          {label} ({member.weight}%): {member.landing.name}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-gray-500">Просмотров</p>
            <p className="font-medium">{member.funnel.pageViews}</p>
          </div>
          <div>
            <p className="text-gray-500">Кликов</p>
            <p className="font-medium">
              {member.funnel.leads} {leadRate !== null && <span className="text-gray-400">({leadRate}%)</span>}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Подписчиков</p>
            <p className="font-medium">
              {member.subscribers.total} {subscribeRate !== null && <span className="text-gray-400">({subscribeRate}%)</span>}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Диалогов</p>
            <p className="font-medium">{member.dialogues.total}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">A/B/n-тест ({members.length} вариантов)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{members.map((m, i) => row(String.fromCharCode(65 + i), m))}</CardContent>
    </Card>
  );
}
