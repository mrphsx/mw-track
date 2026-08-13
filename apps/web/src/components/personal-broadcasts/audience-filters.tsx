'use client';

import { Flame, CheckCircle2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export interface PersonalBroadcastFilterState {
  dialogueSince: string;
  dialogueUntil: string;
  hasPurchase: boolean | undefined;
  minPurchasesCount: string;
  maxPurchasesCount: string;
  minSpent: string;
  maxSpent: string;
  lastPurchaseSince: string;
  lastPurchaseUntil: string;
  isSubscribed: boolean | undefined;
  subscribedSince: string;
  subscribedUntil: string;
  unsubscribedSince: string;
  unsubscribedUntil: string;
  country: string;
  inactiveDaysMin: string;
  folderId: string;
}

export const EMPTY_PERSONAL_BROADCAST_FILTER: PersonalBroadcastFilterState = {
  dialogueSince: '',
  dialogueUntil: '',
  hasPurchase: undefined,
  minPurchasesCount: '',
  maxPurchasesCount: '',
  minSpent: '',
  maxSpent: '',
  lastPurchaseSince: '',
  lastPurchaseUntil: '',
  isSubscribed: undefined,
  subscribedSince: '',
  subscribedUntil: '',
  unsubscribedSince: '',
  unsubscribedUntil: '',
  country: '',
  inactiveDaysMin: '',
  folderId: '',
};

// Форма хранит фильтр в UI-удобном виде (строки для инпутов) — тот же transform-паттерн, что
// buildFilterPayload у push-composer.tsx, перед отправкой на бэкенд (PersonalBroadcastFilterDto).
export function buildPersonalBroadcastFilterPayload(f: PersonalBroadcastFilterState) {
  return {
    dialogueSince: f.dialogueSince || undefined,
    dialogueUntil: f.dialogueUntil || undefined,
    hasPurchase: f.hasPurchase,
    minPurchasesCount: f.minPurchasesCount ? Number(f.minPurchasesCount) : undefined,
    maxPurchasesCount: f.maxPurchasesCount ? Number(f.maxPurchasesCount) : undefined,
    minSpent: f.minSpent ? Number(f.minSpent) : undefined,
    maxSpent: f.maxSpent ? Number(f.maxSpent) : undefined,
    lastPurchaseSince: f.lastPurchaseSince || undefined,
    lastPurchaseUntil: f.lastPurchaseUntil || undefined,
    isSubscribed: f.isSubscribed,
    subscribedSince: f.subscribedSince || undefined,
    subscribedUntil: f.subscribedUntil || undefined,
    unsubscribedSince: f.unsubscribedSince || undefined,
    unsubscribedUntil: f.unsubscribedUntil || undefined,
    country: f.country
      ? f.country
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : undefined,
    inactiveDaysMin: f.inactiveDaysMin ? Number(f.inactiveDaysMin) : undefined,
    folderId: f.folderId ? Number(f.folderId) : undefined,
  };
}

interface Props {
  value: PersonalBroadcastFilterState;
  onChange: (value: PersonalBroadcastFilterState) => void;
  folders: { id: number; title: string }[];
  audienceTotal: number | null;
  isCalculating: boolean;
  // Отличаем "запрос не удался" (например 504 на холодном списке диалогов у аккаунта с
  // тысячами контактов) от настоящего "0 подходящих" — до этого оба случая рендерились
  // одинаково как "—", пользователь не мог отличить ошибку от честного нуля.
  calcError?: boolean;
  // Studio (тот же containerClassName-паттерн, что уже у PushAudienceStep) — обычный shadcn
  // Card в тёмной теме Studio красится в плейсхолдер --card, не в настоящий #171F2B.
  containerClassName?: string;
}

const TRI_STATE_LABEL: Record<'all' | 'yes' | 'no', string> = { all: 'Все', yes: 'Да', no: 'Нет' };

function TriStateRadio({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean | undefined) => void }) {
  const current: 'all' | 'yes' | 'no' = value === undefined ? 'all' : value ? 'yes' : 'no';
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-3 text-sm">
        {(['all', 'yes', 'no'] as const).map((opt) => (
          <label key={opt} className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={current === opt}
              onChange={() => onChange(opt === 'all' ? undefined : opt === 'yes')}
            />
            {TRI_STATE_LABEL[opt]}
          </label>
        ))}
      </div>
    </div>
  );
}

// Максимально подробные фильтры аудитории (запрос пользователя 2026-08-06: "максимально
// подробные филтры по аудитории... по депозитам, по давности депозита, диалог, подписки итд" +
// "даже похорошему по папкам которые уже созданы в телеграме") — заметно богаче PushAudienceStep.
// С 2026-08-06 (запрос "пушить не только клиентов из СРМ, но и всех остальных, даже внешних")
// базовая аудитория — ВЕСЬ живой список диалогов личного Telegram-аккаунта
// (TelegramPersonalService.getAllDialogs), а не только строки Client с dialogueSource=
// 'PERSONAL_ACCOUNT'. Фильтры про покупки/подписку/страну ниже применяются к данным CRM там, где
// они есть для конкретного диалога — у внешних контактов без Client их просто нет, что
// естественно исключает их из фильтров вроде "Есть депозит: Да", но не из рассылки в целом.
export function PersonalBroadcastAudienceFilters({ value, onChange, folders, audienceTotal, isCalculating, calcError, containerClassName }: Props) {
  const update = (patch: Partial<PersonalBroadcastFilterState>) => onChange({ ...value, ...patch });

  const summary = (
    <div className="p-5 space-y-2">
      {isCalculating ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-xs">Считаем аудиторию — для аккаунтов с большим числом диалогов может занять до пары минут</span>
        </div>
      ) : calcError ? (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-red-500">Не удалось посчитать аудиторию</span>
          <span className="text-xs text-muted-foreground">повторите позже</span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            <Flame className="w-4 h-4 text-orange-500" /> Подходит под фильтр
          </span>
          <span className="font-bold text-lg">{audienceTotal ?? '—'}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
        Учитываются все диалоги личного аккаунта, включая внешних — диалог проверяется ещё раз прямо перед отправкой каждому.
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Диалог — с даты</Label>
          <Input type="date" value={value.dialogueSince} onChange={(e) => update({ dialogueSince: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Диалог — по дату</Label>
          <Input type="date" value={value.dialogueUntil} onChange={(e) => update({ dialogueUntil: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TriStateRadio label="Есть депозит" value={value.hasPurchase} onChange={(v) => update({ hasPurchase: v })} />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Депозитов от</Label>
            <Input type="number" value={value.minPurchasesCount} onChange={(e) => update({ minPurchasesCount: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Депозитов до</Label>
            <Input type="number" value={value.maxPurchasesCount} onChange={(e) => update({ maxPurchasesCount: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Сумма от, $</Label>
            <Input type="number" value={value.minSpent} onChange={(e) => update({ minSpent: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Сумма до, $</Label>
            <Input type="number" value={value.maxSpent} onChange={(e) => update({ maxSpent: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Депозит после</Label>
            <Input type="date" value={value.lastPurchaseSince} onChange={(e) => update({ lastPurchaseSince: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Депозит до</Label>
            <Input type="date" value={value.lastPurchaseUntil} onChange={(e) => update({ lastPurchaseUntil: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TriStateRadio label="Подписан" value={value.isSubscribed} onChange={(v) => update({ isSubscribed: v })} />
        <div className="space-y-1.5">
          <Label>Страны (через запятую, коды)</Label>
          <Input value={value.country} onChange={(e) => update({ country: e.target.value })} placeholder="US, GB, DE" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Подписан после</Label>
            <Input type="date" value={value.subscribedSince} onChange={(e) => update({ subscribedSince: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Подписан до</Label>
            <Input type="date" value={value.subscribedUntil} onChange={(e) => update({ subscribedUntil: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Отписан после</Label>
            <Input type="date" value={value.unsubscribedSince} onChange={(e) => update({ unsubscribedSince: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Отписан до</Label>
            <Input type="date" value={value.unsubscribedUntil} onChange={(e) => update({ unsubscribedUntil: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Неактивен, дней от</Label>
          <Input type="number" value={value.inactiveDaysMin} onChange={(e) => update({ inactiveDaysMin: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Папка Telegram</Label>
          <select
            className="w-full border rounded-md text-sm px-2 h-9 bg-background"
            value={value.folderId}
            onChange={(e) => update({ folderId: e.target.value })}
          >
            <option value="">Любая (без фильтра по папке)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          {folders.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Учитываются только явно добавленные в папку чаты — папки по правилам (контакты/группы/боты) не поддерживаются.
            </p>
          )}
        </div>
      </div>

      {containerClassName ? <div className={containerClassName}>{summary}</div> : <Card>{summary}</Card>}
    </div>
  );
}
