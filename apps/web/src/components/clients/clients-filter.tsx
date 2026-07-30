'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ClientsFilterState {
  channelType?: string;
  hasPurchase?: string;
  hasDialogue?: string;
  country?: string;
  minSpent?: string;
  landingId?: string;
  // Рекламная атрибуция (запрос пользователя 2026-07-24: "в фильтры добавь все эти варианты
  // фильтрации" — те же поля, что теперь показываются в карточке клиента).
  buyerId?: string;
  pixelId?: string;
  campaignName?: string;
  adName?: string;
  adsetName?: string;
  siteSourceName?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

interface ClientsFilterProps {
  projectId: string;
  value: ClientsFilterState;
  onChange: (value: ClientsFilterState) => void;
}

// Без children-рендер-пропа у SelectValue триггер показывает сырое value ("all"/"true"), а не
// подпись пункта — тот же класс проблемы, что уже чинили у выбора платформы пикселя/проекта
// при создании лендинга (Base UI не резолвит подпись сама по себе без items или children).
const CHANNEL_LABEL: Record<string, string> = { all: 'Все', TELEGRAM: 'Telegram', WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram' };
const PURCHASE_LABEL: Record<string, string> = { all: 'Все', true: 'Только с покупками', false: 'Только без покупок' };
const DIALOGUE_LABEL: Record<string, string> = { all: 'Все', true: 'Только с диалогом', false: 'Только без диалога' };

export function ClientsFilter({ projectId, value, onChange }: ClientsFilterProps) {
  const [open, setOpen] = useState(false);

  // Точная привязка "подписчик пришёл именно с этого лендинга" сейчас работает только для
  // приватных каналов с заявкой (см. Client.landingId) — список лендингов всё равно
  // показываем всех, у клиентов с других режимов просто не будет landingId, фильтр
  // по ним ничего не найдёт (что и ожидаемо).
  const { data: landings } = useQuery({
    queryKey: ['landings', projectId],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>(`/projects/${projectId}/landings`)).data,
    enabled: open,
  });

  // Баер/пиксель — реальные выпадающие списки (запрос пользователя 2026-07-24), а не
  // свободный текст: id известен заранее, в отличие от кампании/объявления, которые заводятся
  // на стороне рекламной площадки и существуют только как текст на Client (см. поля ниже).
  const { data: team } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<{ id: string; firstName: string; lastName: string | null }[]>('/team')).data,
    enabled: open,
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId, 'pixels'],
    queryFn: async () =>
      (await api.get<{ pixels: { id: string; label: string | null; platform: string }[] }>(`/projects/${projectId}`)).data,
    enabled: open,
  });
  const pixels = project?.pixels ?? [];

  const update = (patch: Partial<ClientsFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Filter className="w-4 h-4 mr-1.5" /> Фильтры
      </Button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 border rounded-lg bg-card">
          <div className="space-y-1.5">
            <Label className="text-xs">Канал</Label>
            <Select value={value.channelType || 'all'} onValueChange={(v) => update({ channelType: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => CHANNEL_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="TELEGRAM">Telegram</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="INSTAGRAM">Instagram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Покупки</Label>
            <Select value={value.hasPurchase ?? 'all'} onValueChange={(v) => update({ hasPurchase: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => PURCHASE_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="true">Только с покупками</SelectItem>
                <SelectItem value="false">Только без покупок</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Диалог</Label>
            <Select value={value.hasDialogue ?? 'all'} onValueChange={(v) => update({ hasDialogue: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => DIALOGUE_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="true">Только с диалогом</SelectItem>
                <SelectItem value="false">Только без диалога</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-country" className="text-xs">Страна (код)</Label>
            <Input
              id="filter-country"
              placeholder="US"
              value={value.country || ''}
              onChange={(e) => update({ country: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-minSpent" className="text-xs">Потратил от, $</Label>
            <Input
              id="filter-minSpent"
              type="number"
              value={value.minSpent || ''}
              onChange={(e) => update({ minSpent: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Лендинг</Label>
            <Select value={value.landingId || 'all'} onValueChange={(v) => update({ landingId: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === 'all' ? 'Все' : landings?.find((l) => l.id === v)?.name ?? v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {landings?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Рекламная атрибуция (запрос пользователя 2026-07-24: "в фильтры добавь все эти
              варианты фильтрации" — баер/пиксель/кампания/объявление/utm, те же поля, что
              теперь показываются в карточке клиента). Баер/пиксель — реальные выпадающие
              списки (id известен заранее), остальное — свободный текст, как уже было у
              utmSource/utmCampaign. */}
          <div className="space-y-1.5">
            <Label className="text-xs">Баер</Label>
            <Select value={value.buyerId || 'all'} onValueChange={(v) => update({ buyerId: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === 'all'
                      ? 'Все'
                      : v === 'none'
                        ? 'Без баера'
                        : (() => {
                            const u = team?.find((t) => t.id === v);
                            return u ? `${u.firstName} ${u.lastName || ''}`.trim() : v;
                          })()
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="none">Без баера</SelectItem>
                {team?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName || ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Пиксель</Label>
            <Select value={value.pixelId || 'all'} onValueChange={(v) => update({ pixelId: !v || v === 'all' ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === 'all' ? 'Все' : pixels.find((p) => p.id === v)?.label || pixels.find((p) => p.id === v)?.platform || v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {pixels.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label || p.platform}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-campaignName" className="text-xs">Кампания</Label>
            <Input
              id="filter-campaignName"
              value={value.campaignName || ''}
              onChange={(e) => update({ campaignName: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-adName" className="text-xs">Объявление</Label>
            <Input
              id="filter-adName"
              value={value.adName || ''}
              onChange={(e) => update({ adName: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-adsetName" className="text-xs">Группа объявлений</Label>
            <Input
              id="filter-adsetName"
              value={value.adsetName || ''}
              onChange={(e) => update({ adsetName: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-siteSourceName" className="text-xs">Источник показа</Label>
            <Input
              id="filter-siteSourceName"
              value={value.siteSourceName || ''}
              onChange={(e) => update({ siteSourceName: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-utmSource" className="text-xs">UTM Source</Label>
            <Input
              id="filter-utmSource"
              value={value.utmSource || ''}
              onChange={(e) => update({ utmSource: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-utmMedium" className="text-xs">UTM Medium</Label>
            <Input
              id="filter-utmMedium"
              value={value.utmMedium || ''}
              onChange={(e) => update({ utmMedium: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-utmCampaign" className="text-xs">UTM Campaign</Label>
            <Input
              id="filter-utmCampaign"
              value={value.utmCampaign || ''}
              onChange={(e) => update({ utmCampaign: e.target.value || undefined })}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-utmContent" className="text-xs">UTM Content</Label>
            <Input
              id="filter-utmContent"
              value={value.utmContent || ''}
              onChange={(e) => update({ utmContent: e.target.value || undefined })}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
