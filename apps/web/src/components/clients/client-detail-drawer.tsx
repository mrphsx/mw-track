'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ClientAvatar } from '@/components/clients/client-avatar';
import { formatDuration } from '@/components/clients/clients-table';

interface ClientDetail {
  id: string;
  tgFirstName: string | null;
  tgUsername: string | null;
  tgPhotoUrl: string | null;
  tgIsPremium: boolean | null;
  channelType: string | null;
  country: string | null;
  city: string | null;
  isSubscribed: boolean;
  isBotActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  subscribedAt: string | null;
  firstDialogueAt: string | null;
  dialogueMessageCount: number;
  fbclid: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  totalSpent: string;
  purchasesCount: number;
}

interface Purchase {
  id: string;
  amount: string;
  currency: string;
  source: string;
  createdAt: string;
}

interface ClientDetailDrawerProps {
  projectId: string;
  clientId: string | null;
  onClose: () => void;
}

export function ClientDetailDrawer({ projectId, clientId, onClose }: ClientDetailDrawerProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const base = `/projects/${projectId}/clients/${clientId}`;

  const { data: client } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => (await api.get<ClientDetail>(base)).data,
    enabled: !!clientId,
  });

  const { data: purchases } = useQuery({
    queryKey: ['client', clientId, 'purchases'],
    queryFn: async () => (await api.get<Purchase[]>(`${base}/purchases`)).data,
    enabled: !!clientId,
  });

  const addPurchase = useMutation({
    mutationFn: () => api.post(`${base}/purchases`, { amount: Number(amount), source: 'manual' }),
    onSuccess: () => {
      setAmount('');
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId, 'purchases'] });
    },
  });

  const removeClient = useMutation({
    mutationFn: () => api.delete(base),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
  });

  return (
    <Drawer open={!!clientId} onOpenChange={(open) => !open && onClose()} direction="right">
      <DrawerContent>
        {client && (
          <div className="flex flex-col h-full">
            <DrawerHeader className="border-b">
              <DrawerTitle className="flex items-center gap-2">
                <ClientAvatar
                  projectId={projectId}
                  clientId={client.id}
                  hasAvatar={!!client.tgPhotoUrl}
                  fallbackLetter={client.tgFirstName || client.tgUsername || '?'}
                />
                {client.tgFirstName || client.tgUsername || 'Клиент'}
                {client.tgIsPremium && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
              </DrawerTitle>
            </DrawerHeader>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{client.channelType}</Badge>
                  {client.tgUsername && <span className="text-sm text-gray-500">@{client.tgUsername}</span>}
                </div>
                <div className="text-sm text-gray-500">
                  {client.country || '—'} {client.city ? `· ${client.city}` : ''}
                </div>
                <div className="text-xs text-gray-400">Регистрация: {format(new Date(client.createdAt), 'd MMM yyyy')}</div>
                {client.lastActiveAt && (
                  <div className="text-xs text-gray-400">Активность: {format(new Date(client.lastActiveAt), 'd MMM yyyy')}</div>
                )}
                {/* Только для канальных клиентов (есть subscribedAt) — для PERSONAL_DM своего
                    события подписки нет, см. запрос пользователя 2026-07-04 "если это канал". */}
                {client.subscribedAt && client.firstDialogueAt && (
                  <div className="text-xs text-gray-400">
                    Первый диалог: через {formatDuration(client.subscribedAt, client.firstDialogueAt)} после подписки
                  </div>
                )}
                <div>
                  {!client.isBotActive ? (
                    <Badge variant="destructive">Заблокировал бота</Badge>
                  ) : !client.isSubscribed ? (
                    <Badge variant="secondary">Отписался</Badge>
                  ) : (
                    <Badge>Активен</Badge>
                  )}
                </div>
              </section>

              <Separator />

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Источник трафика</h3>
                <div className="text-sm text-gray-600">UTM Source: {client.utmSource || '—'}</div>
                <div className="text-sm text-gray-600">UTM Campaign: {client.utmCampaign || '—'}</div>
                {client.fbclid && <div className="text-sm text-gray-600">fbclid: {client.fbclid.slice(0, 16)}...</div>}
              </section>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Финансы</h3>
                <div className="text-sm text-gray-600">Всего потрачено: ${Number(client.totalSpent).toFixed(2)}</div>
                <div className="text-sm text-gray-600">Покупок: {client.purchasesCount}</div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Сумма $"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-32"
                  />
                  <Button size="sm" disabled={!amount || addPurchase.isPending} onClick={() => addPurchase.mutate()}>
                    + Добавить покупку
                  </Button>
                </div>
              </section>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">История покупок</h3>
                {purchases?.length === 0 && <p className="text-sm text-gray-400">Покупок нет.</p>}
                {purchases?.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{format(new Date(p.createdAt), 'd MMM yyyy')}</span>
                    <span className="text-gray-500">{p.source}</span>
                    <span className="font-medium">
                      {Number(p.amount).toFixed(2)} {p.currency}
                    </span>
                  </div>
                ))}
              </section>
            </div>

            <div className="border-t p-4">
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => {
                  if (confirm('Удалить клиента и его персональные данные (GDPR)?')) removeClient.mutate();
                }}
              >
                <Trash2 className="w-4 h-4 mr-1.5" /> Удалить (GDPR)
              </Button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
