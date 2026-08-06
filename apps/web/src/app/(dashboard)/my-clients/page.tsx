'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClientsFilter, ClientsFilterState } from '@/components/clients/clients-filter';
import { ClientsTable, ClientRow } from '@/components/clients/clients-table';
import { ClientDetailDrawer } from '@/components/clients/client-detail-drawer';

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

// "ours"/"external" — то же самое различие, что на обычной /projects/:id/clients (запрос
// пользователя 2026-07-31: "показывай так же внешних клиентов как на странице клиентов проекта").
type ClientOrigin = 'ours' | 'external';

// Жёстко урезанная страница для Operator (запрос пользователя 2026-07-30: "только одну
// страницу, страницу клиентов их проекта") — та же ClientsFilter/ClientsTable/ClientDetailDrawer,
// что и на обычной /projects/:id/clients, но проект выбирается здесь, а не берётся из URL
// (у Operator может быть доступ к нескольким проектам сразу — подтверждено пользователем:
// выпадающий переключатель, а не просто первый попавшийся).
export default function MyClientsPage() {
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

  // Выбор проекта по умолчанию — прямо во время рендера (запрос пользователя 2026-07-31:
  // "пусть изначально будет выбран какой-то проект"), а не через useEffect: эффект применяется
  // ПОСЛЕ первой отрисовки/коммита, из-за чего дропдаун на мгновение показывал пустой
  // плейсхолдер, а не имя проекта. Этот паттерн (setState прямо в теле рендера под guard'ом от
  // повторного срабатывания) уже используется в этом кодбейзе, см. team/[userId]/edit/page.tsx.
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Клиенты</h1>
          {/* Строка всегда занимает место, даже пока data ещё не пришли (запрос пользователя
              2026-07-31: "дизайн прыгает немного" при первой загрузке) — раньше весь <p>
              рендерился только при наличии data, из-за чего высота шапки менялась между "нет
              данных" и "есть данные"; keepPreviousData спасает только повторные запросы, не
              самый первый. */}
          <p className="text-sm text-muted-foreground">Всего: {data ? data.total : '—'}</p>
        </div>
        {/* Поиск+дропдаун сгруппированы в один flex-элемент (баг-репорт пользователя
            2026-08-04: "поиск лидов встал по центру, из-за дропдауна с проектами") — раньше
            Input и Select были двумя ОТДЕЛЬНЫМИ элементами родительского justify-between ряда
            вместе с заголовком: при 3 элементах он распределяет отступы поровну между всеми
            парами, из-за чего поиск визуально уезжал к центру строки, а не стоял вплотную к
            дропдауну. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Имя, username, user_id..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56"
          />
          {projects && projects.length > 1 && (
            <Select value={projectId ?? undefined} onValueChange={(v) => { setProjectId(v); setPage(1); }}>
              <SelectTrigger className="w-56">
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
          <span className="text-xs text-muted-foreground">Доступные проекты:</span>
          {projects.map((p) => (
            <Badge key={p.id} variant={p.id === projectId ? 'default' : 'secondary'}>
              {p.name}
            </Badge>
          ))}
        </div>
      )}

      {projectId && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => { setOrigin('ours'); setPage(1); }}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  origin === 'ours' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Наши клиенты
              </button>
              <button
                type="button"
                onClick={() => { setOrigin('external'); setPage(1); }}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  origin === 'external' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Внешние контакты
              </button>
            </div>
            {origin === 'external' && (
              <p className="text-xs text-muted-foreground">
                Написали в личку/боту или вступили в канал не по нашей ссылке — не учитываются в статистике проекта.
              </p>
            )}
          </div>

          <ClientsFilter projectId={projectId} value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

          <div className="border rounded-lg bg-card">
            <ClientsTable projectId={projectId} clients={data?.items ?? []} onSelect={setSelectedClientId} />
          </div>

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {data.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Далее
              </Button>
            </div>
          )}

          <ClientDetailDrawer projectId={projectId} clientId={selectedClientId} onClose={() => setSelectedClientId(null)} />
        </>
      )}
    </div>
  );
}
