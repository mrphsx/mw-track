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
import { DIALOGUE_SOURCE_LABEL, formatDuration } from '@/components/clients/clients-table';

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
  dialogueSource: 'PERSONAL_ACCOUNT' | 'BOT_DIRECT' | 'MANAGER_CONFIRM' | 'CRM_BUTTON' | null;
  fbclid: string | null;
  ttclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  // Рекламные макросы + пиксель (запрос пользователя 2026-07-24: "нужно показать все данные
  // чтобы баера видели, пикселя, кампании, sources все, с какого лэндинга и так далее") —
  // сырые id + уже резолвленные человеко-читаемые подписи (ClientsService.getClientDetail,
  // buyerId/pixelId — мягкие ссылки без @relation, см. schema.prisma).
  pixelId: string | null;
  pixelLabel: string | null;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  placement: string | null;
  siteSourceName: string | null;
  buyerId: string | null;
  buyerName: string | null;
  landingId: string | null;
  landingName: string | null;
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
                  {client.tgUsername && <span className="text-sm text-muted-foreground">@{client.tgUsername}</span>}
                </div>
                <div className="text-sm text-muted-foreground">
                  {client.country || '—'} {client.city ? `· ${client.city}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">Регистрация: {format(new Date(client.createdAt), 'd MMM yyyy')}</div>
                {client.lastActiveAt && (
                  <div className="text-xs text-muted-foreground">Активность: {format(new Date(client.lastActiveAt), 'd MMM yyyy')}</div>
                )}
                {/* Только для канальных клиентов (есть subscribedAt) — для PERSONAL_DM своего
                    события подписки нет, см. запрос пользователя 2026-07-04 "если это канал". */}
                {client.firstDialogueAt && (
                  <div className="text-xs text-muted-foreground">
                    Первый диалог: {format(new Date(client.firstDialogueAt), 'd MMM yyyy, HH:mm')}
                    {/* Задержка от подписки — только для канальных клиентов (есть subscribedAt),
                        для PERSONAL_DM своего события подписки нет (запрос пользователя
                        2026-07-04 "если это канал"). Явный timestamp добавлен 2026-07-30 —
                        раньше здесь была видна только относительная задержка, без самого
                        момента диалога. */}
                    {client.subscribedAt && ` (через ${formatDuration(client.subscribedAt, client.firstDialogueAt)} после подписки)`}
                    {client.dialogueSource && ` — ${DIALOGUE_SOURCE_LABEL[client.dialogueSource]}`}
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
                {/* Расширено 2026-07-24 (запрос пользователя: "нужно показать все данные чтобы
                    баера видели, пикселя, кампании, sources все, с какого лэндинга и так
                    далее, абсолютно все") — раньше тут были только utmSource/utmCampaign/
                    fbclid, остальные рекламные поля Client (baер/пиксель/объявление/группа
                    объявлений/кампания/площадка/лендинг) вообще не показывались нигде в
                    карточке. */}
                <h3 className="text-sm font-semibold">Источник трафика</h3>
                <div className="text-sm text-muted-foreground">Баер: {client.buyerName || (client.buyerId ? client.buyerId : 'Без баера')}</div>
                <div className="text-sm text-muted-foreground">Пиксель: {client.pixelLabel || '—'}</div>
                <div className="text-sm text-muted-foreground">Лендинг: {client.landingName || '—'}</div>
                <div className="text-sm text-muted-foreground">Кампания: {client.campaignName || client.campaignId || '—'}</div>
                <div className="text-sm text-muted-foreground">Объявление: {client.adName || client.adId || '—'}</div>
                <div className="text-sm text-muted-foreground">Группа объявлений: {client.adsetName || client.adsetId || '—'}</div>
                <div className="text-sm text-muted-foreground">Площадка: {client.placement || '—'}</div>
                <div className="text-sm text-muted-foreground">Источник показа: {client.siteSourceName || '—'}</div>
                <div className="text-sm text-muted-foreground">UTM Source: {client.utmSource || '—'}</div>
                <div className="text-sm text-muted-foreground">UTM Medium: {client.utmMedium || '—'}</div>
                <div className="text-sm text-muted-foreground">UTM Campaign: {client.utmCampaign || '—'}</div>
                <div className="text-sm text-muted-foreground">UTM Content: {client.utmContent || '—'}</div>
                <div className="text-sm text-muted-foreground">UTM Term: {client.utmTerm || '—'}</div>
                {client.fbclid && <div className="text-sm text-muted-foreground">fbclid: {client.fbclid.slice(0, 24)}...</div>}
                {client.ttclid && <div className="text-sm text-muted-foreground">ttclid: {client.ttclid.slice(0, 24)}...</div>}
              </section>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Финансы</h3>
                <div className="text-sm text-muted-foreground">Всего потрачено: ${Number(client.totalSpent).toFixed(2)}</div>
                <div className="text-sm text-muted-foreground">Покупок: {client.purchasesCount}</div>
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
                {purchases?.length === 0 && <p className="text-sm text-muted-foreground">Покупок нет.</p>}
                {purchases?.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{format(new Date(p.createdAt), 'd MMM yyyy')}</span>
                    <span className="text-muted-foreground">{p.source}</span>
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
