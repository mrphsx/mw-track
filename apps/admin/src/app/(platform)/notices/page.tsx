'use client';

// Объявления в колокол оповещений СРМ (запрос пользователя 2026-10-02: "хочу чтобы я с панели
// администрации мог отправлять выбранным компаниям (либо всем) оповещение"). Отправка создаёт
// AdminNotice: при выборе "всем" — одну строку с companyId: null (её увидят и компании,
// зарегистрированные позже), при выборе компаний — по строке на компанию. Состояние
// "прочитано"/"скрыто" живёт на стороне получателя, у каждого сотрудника своё.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { isAxiosError } from 'axios';
import { Megaphone, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
}

interface NoticeRow {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  company: { id: string; name: string } | null;
  createdByEmail: string;
  interactions: number;
}

type Target = 'all' | 'selected';

export default function NoticesPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('selected');
  const [selected, setSelected] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // limit 200 — компаний на платформе сейчас десятки; поиск ниже фильтрует уже загруженное,
  // чтобы отметки не слетали при каждом вводе символа.
  const { data: companies } = useQuery({
    queryKey: ['admin-companies-all'],
    queryFn: async () =>
      (await api.get<{ items: CompanyRow[] }>('/admin/companies', { params: { page: 1, limit: 200 } })).data.items,
  });

  const { data: notices } = useQuery({
    queryKey: ['admin-notices'],
    queryFn: async () => (await api.get<{ items: NoticeRow[]; total: number }>('/admin/notices')).data,
  });

  const visibleCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return companies ?? [];
    return (companies ?? []).filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
  }, [companies, companySearch]);

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ created: number; toAll: boolean }>('/admin/notices', {
          title: title.trim(),
          body: body.trim(),
          companyIds: target === 'all' ? undefined : selected,
        })
      ).data,
    onSuccess: (res) => {
      setError(null);
      setSent(res.toAll ? 'Отправлено всем компаниям' : `Отправлено компаниям: ${res.created}`);
      setTitle('');
      setBody('');
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['admin-notices'] });
    },
    onError: (e) => {
      setSent(null);
      setError(isAxiosError(e) ? (e.response?.data as { message?: string })?.message ?? e.message : 'Не удалось отправить');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/notices/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-notices'] }),
  });

  const canSend =
    title.trim().length > 0 && body.trim().length > 0 && (target === 'all' || selected.length > 0) && !send.isPending;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Оповещения компаниям</h1>
        <p className="mt-1 text-sm text-gray-500">
          Объявление появится в колоколе оповещений у всех сотрудников выбранных компаний. Каждый сотрудник сам
          помечает его прочитанным и может скрыть кнопкой «Очистить все».
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="notice-title">Заголовок</Label>
            <Input
              id="notice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Плановые работы 5 октября"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notice-body">Текст</Label>
            <textarea
              id="notice-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="С 02:00 до 04:00 UTC возможны короткие перерывы в отправке рассылок."
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-400"
            />
            <p className="text-xs text-gray-500">{body.length} / 2000</p>
          </div>

          <div className="space-y-2">
            <Label>Кому</Label>
            <div className="flex gap-2">
              <Button variant={target === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setTarget('all')}>
                Всем компаниям
              </Button>
              <Button
                variant={target === 'selected' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTarget('selected')}
              >
                Выбранным
              </Button>
            </div>
            {target === 'all' && (
              <p className="text-xs text-gray-500">
                Увидят все компании, включая те, что зарегистрируются позже.
              </p>
            )}
          </div>

          {target === 'selected' && (
            <div className="space-y-2">
              <Input
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Поиск компании..."
              />
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
                {visibleCompanies.length === 0 && <p className="p-2 text-sm text-gray-500">Ничего не найдено</p>}
                {visibleCompanies.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span className="truncate">{c.name}</span>
                    <span className="truncate text-xs text-gray-400">{c.slug}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500">Выбрано: {selected.length}</p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {sent && <p className="text-sm text-green-600">{sent}</p>}

          <Button onClick={() => send.mutate()} disabled={!canSend}>
            <Megaphone className="mr-1.5 h-4 w-4" />
            {send.isPending ? 'Отправка...' : 'Отправить'}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Отправленные</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Заголовок</TableHead>
                  <TableHead>Кому</TableHead>
                  <TableHead>Отправил</TableHead>
                  <TableHead>Когда</TableHead>
                  <TableHead>Открыли</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {notices?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                      Пока ничего не отправляли
                    </TableCell>
                  </TableRow>
                )}
                {notices?.items.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>
                      <div className="font-medium">{n.title}</div>
                      <div className="max-w-md truncate text-xs text-gray-500">{n.body}</div>
                    </TableCell>
                    <TableCell>
                      {n.company ? (
                        <span className="text-sm">{n.company.name}</span>
                      ) : (
                        <Badge variant="secondary">Все компании</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">{n.createdByEmail}</TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {format(new Date(n.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{n.interactions}</TableCell>
                    <TableCell className="text-right">
                      {/* Отозвать ошибочное объявление — строка удаляется, вместе с ней оно
                          пропадает из колокола у всех получателей. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(n.id)}
                        disabled={remove.isPending && remove.variables === n.id}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
