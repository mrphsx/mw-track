'use client';

// Журнал заблокированных клоакингом заходов (запрос пользователя 2026-09-25: "сохранять логи
// фильтрации... кто по какому условию и когда был отфильтрован") — самодостаточный компонент со
// своими запросами, тот же принцип, что CloakingRulesSection/CloakingPrelandingUpload: один
// компонент монтируется одинаково там, где нужен (сейчас — только Studio, см.
// feedback_studio_only_ui_changes в памяти, страница new UI фичи, а не багфикс существующей —
// но правило то же самое: не мирроить в classic без явной просьбы). Логируются ТОЛЬКО реально
// заблокированные визиты (решение пользователя 2026-09-25) — этот компонент не показывает
// пропущенных посетителей вообще, только тех, кого клоакинг остановил.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CLOAKING_ACTION_LABELS, CLOAKING_FIELD_LABELS, CloakingConditionField, CloakingRuleApiShape } from './cloaking-types';
import { CloakingLogsResponse, summarizeConditionConfig } from '@/lib/cloaking-logs';

const FILTERABLE_FIELDS: CloakingConditionField[] = [
  'COUNTRY', 'REGION', 'CITY', 'IP', 'REFERRER', 'USER_AGENT', 'X_REQUESTED_WITH', 'LANGUAGE',
  'BROWSER', 'BROWSER_VERSION', 'OS', 'OS_VERSION', 'DEVICE_TYPE', 'DEVICE_MODEL', 'PARAMETER',
  'DATE_BETWEEN', 'TIMETABLE', 'LIMIT_CLICKS', 'BOT', 'UNIQUENESS',
];

const ALL = '__all__';

export function CloakingLogsTable({ landingId, containerClassName }: { landingId: string; containerClassName?: string }) {
  const [ruleId, setRuleId] = useState(ALL);
  const [field, setField] = useState<typeof ALL | CloakingConditionField>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data: rules } = useQuery({
    queryKey: ['landing', landingId, 'cloaking-rules'],
    queryFn: async () => (await api.get<CloakingRuleApiShape[]>(`/landings/${landingId}/cloaking/rules`)).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['landing', landingId, 'cloaking-logs', { ruleId, field, from, to, page }],
    queryFn: async () =>
      (
        await api.get<CloakingLogsResponse>(`/landings/${landingId}/cloaking/logs`, {
          params: {
            ruleId: ruleId === ALL ? undefined : ruleId,
            field: field === ALL ? undefined : field,
            from: from || undefined,
            to: to || undefined,
            page,
          },
        })
      ).data,
  });

  const handleRuleChange = (v: string | null) => {
    if (!v) return;
    setRuleId(v);
    setPage(1);
  };
  const handleFieldChange = (v: string | null) => {
    if (!v) return;
    setField(v as typeof ALL | CloakingConditionField);
    setPage(1);
  };
  const handleDateChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className={cn('space-y-4', containerClassName)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Правило</label>
          <Select value={ruleId} onValueChange={handleRuleChange}>
            <SelectTrigger className="w-56">
              <SelectValue>{(v: string) => (v === ALL ? 'Все правила' : rules?.find((r) => r.id === v)?.name || 'Без названия')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все правила</SelectItem>
              {rules?.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name || 'Без названия'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Условие</label>
          <Select value={field} onValueChange={handleFieldChange}>
            <SelectTrigger className="w-56">
              <SelectValue>{(v: string) => (v === ALL ? 'Все условия' : CLOAKING_FIELD_LABELS[v as CloakingConditionField])}</SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              <SelectItem value={ALL}>Все условия</SelectItem>
              {FILTERABLE_FIELDS.map((f) => (
                <SelectItem key={f} value={f}>
                  {CLOAKING_FIELD_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">С даты</label>
          <Input type="date" value={from} onChange={(e) => handleDateChange(setFrom)(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">По дату</label>
          <Input type="date" value={to} onChange={(e) => handleDateChange(setTo)(e.target.value)} className="w-40" />
        </div>

        {(ruleId !== ALL || field !== ALL || from || to) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRuleId(ALL);
              setField(ALL);
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            Сбросить
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Когда</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Правило / действие</th>
              <th className="px-3 py-2 font-medium">Сработавшие условия</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">IP / гео</th>
              <th className="px-3 py-2 font-medium">ОС / браузер</th>
              <th className="px-3 py-2 font-medium">Referrer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Загрузка...
                </td>
              </tr>
            )}
            {!isLoading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Заблокированных заходов пока нет.
                </td>
              </tr>
            )}
            {data?.rows.map((row) => {
              const { ua, geo } = row.requestSnapshot;
              const osBrowser = [ua.os, ua.browser].filter(Boolean).join(' / ') || '—';
              const geoStr = [geo.country, geo.region, geo.city].filter(Boolean).join(', ') || '—';
              return (
                <tr key={row.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{format(new Date(row.createdAt), 'd MMM yyyy, HH:mm')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div>{row.ruleName || (row.ruleId ? 'Без названия' : <span className="text-muted-foreground italic">правило удалено</span>)}</div>
                    <div className="text-xs text-muted-foreground">{CLOAKING_ACTION_LABELS[row.action]}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.matchedConditions.length === 0 ? (
                      <span className="text-muted-foreground">без условий (catch-all)</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {row.matchedConditions.map((c, i) => (
                          <li key={i}>
                            <span className="font-medium">{CLOAKING_FIELD_LABELS[c.field]}</span>
                            {c.negate && <span className="text-muted-foreground"> (НЕ)</span>}
                            {': '}
                            <span className="text-muted-foreground">{summarizeConditionConfig(c.field, c.config)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-mono text-xs">{row.requestSnapshot.ip || '—'}</div>
                    <div className="text-xs text-muted-foreground">{geoStr}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{osBrowser}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={row.requestSnapshot.referrer || undefined}>
                    {row.requestSnapshot.referrer || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Всего: {data.total}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>
              Стр. {page} из {totalPages}
            </span>
            <Button type="button" variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
