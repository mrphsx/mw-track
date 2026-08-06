'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClientsFilter, ClientsFilterState } from '@/components/clients/clients-filter';
import { ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';
import { StudioClientsTable } from '../clients-table';
import { StudioLinkButton, StudioPill } from '../ui';

interface ProjectSummary {
  id: string;
  name: string;
}

interface ClientsResponse {
  items: ClientRow[];
  total: number;
  page: number;
  totalPages: number;
}

// "ours"/"external" — то же различие, что на обычной /projects/:id/clients (запрос
// пользователя 2026-07-31: "показывай так же внешних клиентов как на странице клиентов проекта").
type ClientOrigin = 'ours' | 'external';

// Studio-версия жёстко урезанной страницы Operator-а — см. classic (dashboard)/my-clients
// для полного комментария о причине (запрос пользователя 2026-07-30).
export default function StudioMyClientsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<ClientOrigin>('ours');
  const [filters, setFilters] = useState<ClientsFilterState>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectSummary[]>('/projects')).data,
  });

  // Выбор проекта прямо во время рендера, не через useEffect (запрос пользователя 2026-07-31:
  // "пусть изначально будет выбран какой-то проект") — useEffect применяется уже после первого
  // коммита, из-за чего дропдаун на мгновение показывал пустой плейсхолдер вместо имени проекта.
  if (!projectId && projects?.length) {
    setProjectId(projects[0].id);
  }

  const { data } = useQuery({
    queryKey: ['my-clients', projectId, origin, filters, search, page],
    queryFn: async () =>
      (
        await api.get<ClientsResponse>(`/projects/${projectId}/clients`, {
          params: {
            page,
            origin,
            channelType: filters.channelType,
            hasPurchase: filters.hasPurchase,
            hasDialogue: filters.hasDialogue,
            country: filters.country,
            minSpent: filters.minSpent,
            landingId: filters.landingId,
            search: search || undefined,
          },
        })
      ).data,
    enabled: !!projectId,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Клиенты</h1>
          {/* Строка всегда занимает место, даже до первого ответа (запрос пользователя
              2026-07-31: "дизайн прыгает немного") — раньше рендерилась только при наличии
              data, из-за чего высота шапки менялась между "нет данных" и "есть данные". */}
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Всего: {data ? data.total : '—'}</p>
        </div>
        {/* Поиск+дропдаун сгруппированы в один flex-элемент (баг-репорт пользователя
            2026-08-04: "поиск лидов встал по центру, из-за дропдауна с проектами") — раньше
            Input и Select были двумя ОТДЕЛЬНЫМИ элементами родительского justify-between ряда
            вместе с заголовком: при 3 элементах он распределяет отступы поровну между всеми
            парами, из-за чего поиск визуально уезжал к центру строки, а не стоял вплотную к
            дропдауну. Группировка — тот же приём, что и в классическом дереве (тот же баг там
            же, унаследован при переносе поиска в Studio). */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56 rounded-lg"
          />
          {projects && projects.length > 1 && (
            <Select value={projectId ?? undefined} onValueChange={(v) => { setProjectId(v); setPage(1); }}>
              <SelectTrigger className="w-56 rounded-lg">
                {/* Base UI Select.Value без children рендерит сырой value (id), не текст пункта
                    (4-й раз в проекте, см. clients-filter.tsx:161) — здесь этим value был id
                    проекта, баг был виден невооружённым глазом (запрос пользователя 2026-07-31). */}
                <SelectValue>{(v: string) => projects.find((p) => p.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Всегда видимый список доступных сегодня проектов (запрос пользователя 2026-07-31:
          "пусть ему сразу пишет доступные сегодня проекты") — не только внутри дропдауна,
          который вообще не рендерится при одном проекте, а состав может меняться day-to-day
          теперь, когда доступ выдаётся отдельно через /team или карточку проекта. */}
      {projects && projects.length > 0 && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Доступные проекты:</span>
          {projects.map((p) => (
            <StudioPill key={p.id} hue={p.id === projectId ? 'amber' : undefined}>
              {p.name}
            </StudioPill>
          ))}
        </div>
      )}

      {projectId && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
              <button
                type="button"
                onClick={() => { setOrigin('ours'); setPage(1); }}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  origin === 'ours'
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                Наши клиенты
              </button>
              <button
                type="button"
                onClick={() => { setOrigin('external'); setPage(1); }}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  origin === 'external'
                    ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                    : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
                }`}
              >
                Внешние контакты
              </button>
            </div>
            {origin === 'external' && (
              <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                Написали в личку/боту или вступили в канал не по нашей ссылке — не учитываются в статистике проекта.
              </p>
            )}
          </div>

          <ClientsFilter projectId={projectId} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

          <StudioClientsTable projectId={projectId} clients={data?.items ?? []} onSelect={setSelectedClientId} />

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <StudioLinkButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </StudioLinkButton>
              <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">
                {page} / {data.totalPages}
              </span>
              <StudioLinkButton size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Далее
              </StudioLinkButton>
            </div>
          )}

          <ClientDetailDrawer projectId={projectId} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
        </>
      )}
    </div>
  );
}
