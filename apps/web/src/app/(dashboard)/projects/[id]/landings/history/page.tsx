'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AbTestGroupItem, groupAutoLabel } from '@/lib/landings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Завершённые A/B/n-тесты — вынесены на отдельную страницу (запрос пользователя 2026-07-17:
// "завершенные тесты в другую страницу, эта получится слишком большой") из
// /projects/[id]/landings, где раньше жили вместе с активными тестами и сеткой лендингов.
// Read-only: цифры застыли на момент остановки (LandingsService.stopAbTestGroup), см.
// resultsSnapshot — не пересчитываются live.
export default function AbTestHistoryPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: abTestGroups, isLoading } = useQuery({
    queryKey: ['ab-test-groups', projectId],
    queryFn: async () => (await api.get<AbTestGroupItem[]>(`/projects/${projectId}/ab-test-groups`)).data,
  });

  const endedGroups = (abTestGroups ?? []).filter((g) => g.endedAt);

  const deleteHistory = useMutation({
    mutationFn: (groupId: string) => api.delete(`/ab-test-groups/${groupId}/history`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ab-test-groups', projectId] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Лендинги
        </Link>
        <h1 className="text-2xl font-bold">История A/B/n-тестов</h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && endedGroups.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Завершённых тестов пока нет.</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {endedGroups.map((g) => {
          const members = g.resultsSnapshot ?? [];
          const totals = members.reduce(
            (acc, m) => ({
              pageViews: acc.pageViews + m.pageViews,
              leads: acc.leads + m.leads,
              subscribes: acc.subscribes + m.subscribes,
              dialogues: acc.dialogues + m.dialogues,
            }),
            { pageViews: 0, leads: 0, subscribes: 0, dialogues: 0 },
          );
          return (
            <Card
              key={g.id}
              onClick={() => router.push(`/projects/${projectId}/landings/groups/${g.id}`)}
              className="cursor-pointer transition-colors hover:ring-foreground/20"
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{g.name || groupAutoLabel(g)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(g.createdAt), 'd MMM yyyy')} — {format(new Date(g.endedAt!), 'd MMM yyyy')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteHistory.mutate(g.id);
                    }}
                    disabled={deleteHistory.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="overflow-x-auto">
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
                      {members.map((m) => (
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
                        <td className="pr-4 py-1">{totals.pageViews}</td>
                        <td className="pr-4 py-1">{totals.leads}</td>
                        <td className="pr-4 py-1">{totals.subscribes}</td>
                        <td className="py-1">{totals.dialogues}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
