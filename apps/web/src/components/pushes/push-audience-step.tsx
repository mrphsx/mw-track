'use client';

import { Flame, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

export interface PushAudienceFilter {
  channelTypes: string[];
  hasPurchase: boolean | undefined;
  countries: string;
  minSpent: string;
  inactiveDaysMin: string;
}

interface PushAudienceStepProps {
  value: PushAudienceFilter;
  onChange: (value: PushAudienceFilter) => void;
  audienceTotal: number | null;
  audienceReachable: number | null;
  isCalculating: boolean;
}

const CHANNEL_OPTIONS = ['TELEGRAM', 'WHATSAPP', 'INSTAGRAM'];

export function PushAudienceStep({ value, onChange, audienceTotal, audienceReachable, isCalculating }: PushAudienceStepProps) {
  const update = (patch: Partial<PushAudienceFilter>) => onChange({ ...value, ...patch });

  const toggleChannel = (channel: string) => {
    const channelTypes = value.channelTypes.includes(channel)
      ? value.channelTypes.filter((c) => c !== channel)
      : [...value.channelTypes, channel];
    update({ channelTypes });
  };

  const unreachable = audienceTotal !== null && audienceReachable !== null ? audienceTotal - audienceReachable : null;
  const reachablePct = audienceTotal ? Math.round(((audienceReachable ?? 0) / audienceTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Канал</Label>
          <div className="flex gap-3">
            {CHANNEL_OPTIONS.map((channel) => (
              <label key={channel} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={value.channelTypes.includes(channel)} onCheckedChange={() => toggleChannel(channel)} />
                {channel}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Покупки</Label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={value.hasPurchase === undefined} onChange={() => update({ hasPurchase: undefined })} />
              Все
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={value.hasPurchase === true} onChange={() => update({ hasPurchase: true })} />
              Только с покупками
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={value.hasPurchase === false} onChange={() => update({ hasPurchase: false })} />
              Только без покупок
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="countries">Страны (через запятую, коды)</Label>
          <Input id="countries" value={value.countries} onChange={(e) => update({ countries: e.target.value })} placeholder="US, GB, DE" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="minSpent">Потратил от, $</Label>
          <Input id="minSpent" type="number" value={value.minSpent} onChange={(e) => update({ minSpent: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inactiveDaysMin">Не активен, дней от</Label>
          <Input id="inactiveDaysMin" type="number" value={value.inactiveDaysMin} onChange={(e) => update({ inactiveDaysMin: e.target.value })} />
        </div>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          {isCalculating ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <Flame className="w-4 h-4 text-orange-500" /> По фильтру
                </span>
                <span className="font-bold">{audienceTotal ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> Доступны
                </span>
                <span className="font-bold">
                  {audienceReachable ?? '—'} {audienceTotal ? `(${reachablePct}%)` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <XCircle className="w-4 h-4 text-red-400" /> Недоступны
                </span>
                <span className="font-bold">{unreachable ?? '—'}</span>
              </div>
              <p className="text-xs text-gray-400 pt-1">«Недоступны» — заблокировали бота</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
