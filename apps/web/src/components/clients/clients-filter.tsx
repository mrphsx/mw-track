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

  const update = (patch: Partial<ClientsFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Filter className="w-4 h-4 mr-1.5" /> Фильтры
      </Button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 border rounded-lg bg-white">
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
        </div>
      )}
    </div>
  );
}
