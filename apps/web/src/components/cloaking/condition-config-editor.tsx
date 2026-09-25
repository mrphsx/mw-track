'use client';

// Мини-редактор config конкретного условия — зеркалит форму, которую ждёт соответствующий
// evaluator на бэкенде (apps/api/src/modules/landings/cloaking/conditions/), одно ветвление на
// CloakingConditionField, тот же принцип "одна форма на тип", что и сам backend-реестр.
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { CloakingConditionField } from './cloaking-types';
import { TagListInput } from './tag-list-input';
import { SearchableMultiSelect } from './searchable-multi-select';
import { COUNTRY_OPTIONS } from './country-list';
import { BROWSER_OPTIONS } from './browser-list';
import { OS_OPTIONS } from './os-list';
import { LANGUAGE_OPTIONS } from './language-list';

const WEEKDAYS = [
  { value: 0, label: 'Вс' },
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
];

const TEXT_MATCH_MODES = [
  { value: 'contains', label: 'Содержит' },
  { value: 'regex', label: 'Regex' },
];

// Base UI SelectValue без children-функции показывает сырое value ('contains', 'empty', ...),
// а не русскую подпись из SelectItem — тот же повторяющийся баг, что уже чинился в проекте
// несколько раз (см. get-link-dialog.tsx). "empty" переведён по-разному в разных условиях, так
// что один общий словарь не подходит — у каждого Select ниже свой набор пар value/label,
// продублированный из его же SelectItem.
function modeLabel(labels: Record<string, string>, mode: string): string {
  return labels[mode] ?? mode;
}

function toIsoOrEmpty(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ConditionConfigEditor({
  field,
  config,
  onChange,
}: {
  field: CloakingConditionField;
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  switch (field) {
    case 'COUNTRY':
      return <SearchableMultiSelect options={COUNTRY_OPTIONS} value={(config.countries as string[]) ?? []} onChange={(countries) => set({ countries })} placeholder="Выбрать страны..." searchPlaceholder="Поиск страны..." />;
    case 'REGION':
      return <TagListInput value={(config.regions as string[]) ?? []} onChange={(regions) => set({ regions })} placeholder="MSK, SPE" uppercase />;
    case 'CITY':
      return <TagListInput value={(config.cities as string[]) ?? []} onChange={(cities) => set({ cities })} placeholder="Moscow, Kyiv" />;
    case 'IP': {
      // Быстрые чекбоксы "весь IPv4"/"весь IPv6" (запрос пользователя 2026-09-25, "как в
      // Keitaro, чтобы можно было отдельно выбирать ipv6") — никакого нового поля в config не
      // нужно: это просто UI-удобство поверх уже работающего механизма (ipaddr.js понимает
      // 0.0.0.0/0 и ::/0 как "весь адрес этой версии" — проверено live 2026-09-24). Чекбокс
      // отражает, есть ли соответствующий /0-диапазон в списке, и просто добавляет/убирает его
      // же — TagListInput ниже остаётся рабочим для точечных адресов/подсетей как и раньше.
      const ranges = (config.ranges as string[]) ?? [];
      const blockAllV4 = ranges.includes('0.0.0.0/0');
      const blockAllV6 = ranges.includes('::/0');
      const toggleRange = (token: string, on: boolean) =>
        set({ ranges: on ? Array.from(new Set([...ranges, token])) : ranges.filter((r) => r !== token) });

      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={blockAllV4} onCheckedChange={(v) => toggleRange('0.0.0.0/0', v === true)} />
              Весь IPv4
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={blockAllV6} onCheckedChange={(v) => toggleRange('::/0', v === true)} />
              Весь IPv6
            </label>
          </div>
          <TagListInput value={ranges} onChange={(next) => set({ ranges: next })} placeholder="1.2.3.4, 5.6.7.0/24, 2001:db8::/32" />
        </div>
      );
    }
    case 'LANGUAGE':
      return (
        <SearchableMultiSelect
          options={LANGUAGE_OPTIONS}
          value={(config.languages as string[]) ?? []}
          onChange={(languages) => set({ languages })}
          placeholder="Выбрать языки..."
          searchPlaceholder="Поиск языка..."
        />
      );
    case 'BROWSER':
      return <SearchableMultiSelect options={BROWSER_OPTIONS} value={(config.browsers as string[]) ?? []} onChange={(browsers) => set({ browsers })} placeholder="Выбрать браузеры..." searchPlaceholder="Поиск браузера..." />;
    case 'BROWSER_VERSION':
    case 'OS_VERSION':
      return <TagListInput value={(config.versions as string[]) ?? []} onChange={(versions) => set({ versions })} placeholder="16, 17.2" />;
    case 'OS':
      return <SearchableMultiSelect options={OS_OPTIONS} value={(config.values as string[]) ?? []} onChange={(values) => set({ values })} placeholder="Выбрать ОС..." searchPlaceholder="Поиск ОС..." />;

    case 'DEVICE_TYPE':
      return (
        <div className="space-y-1.5">
          <MultiSelect
            options={[
              { value: 'desktop', label: 'Десктоп' },
              { value: 'mobile', label: 'Мобильный телефон' },
              { value: 'tablet', label: 'Планшет' },
              { value: 'console', label: 'Игровая консоль' },
              { value: 'smarttv', label: 'Телевизор' },
              { value: 'wearable', label: 'Носимое устройство' },
              { value: 'embedded', label: 'Встроенное устройство' },
              { value: 'other', label: 'Другое/неизвестно' },
            ]}
            value={(config.types as string[]) ?? []}
            onChange={(types) => set({ types })}
          />
          <p className="text-[11px] text-muted-foreground">
            Категории &laquo;Камера&raquo;, &laquo;Автомобильный браузер&raquo;, &laquo;Плеер&raquo; и т.п. наш детектор (ua-parser-js) не различает — их здесь нет.
          </p>
        </div>
      );

    case 'REFERRER':
      return (
        <div className="space-y-2">
          <Select value={(config.mode as string) ?? 'contains'} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) => modeLabel({ contains: 'Содержит', regex: 'Regex', empty: 'Referrer пустой', search_engine: 'Переход из поисковика' }, v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              {TEXT_MATCH_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
              <SelectItem value="empty">Referrer пустой</SelectItem>
              <SelectItem value="search_engine">Переход из поисковика</SelectItem>
            </SelectContent>
          </Select>
          {config.mode !== 'empty' && config.mode !== 'search_engine' && (
            <Input value={(config.pattern as string) ?? ''} onChange={(e) => set({ pattern: e.target.value })} placeholder="facebook.com" />
          )}
        </div>
      );

    case 'USER_AGENT':
      return (
        <div className="space-y-2">
          <Select value={(config.mode as string) ?? 'contains'} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => modeLabel({ contains: 'Содержит', regex: 'Regex', empty: 'User-Agent пустой' }, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              {TEXT_MATCH_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
              <SelectItem value="empty">User-Agent пустой</SelectItem>
            </SelectContent>
          </Select>
          {config.mode !== 'empty' && <Input value={(config.pattern as string) ?? ''} onChange={(e) => set({ pattern: e.target.value })} placeholder="bot|crawler" />}
        </div>
      );

    case 'X_REQUESTED_WITH':
    case 'DEVICE_MODEL':
      return (
        <div className="space-y-2">
          <Select value={(config.mode as string) ?? 'contains'} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => modeLabel({ contains: 'Содержит', regex: 'Regex' }, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              {TEXT_MATCH_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={(config.pattern as string) ?? ''} onChange={(e) => set({ pattern: e.target.value })} placeholder={field === 'DEVICE_MODEL' ? 'iPhone' : 'XMLHttpRequest'} />
        </div>
      );

    case 'PARAMETER':
      return (
        <div className="space-y-2">
          <Input value={(config.name as string) ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Имя параметра, напр. utm_source" />
          <Select value={(config.mode as string) ?? 'contains'} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) =>
                  modeLabel({ equals: 'Равен', contains: 'Содержит', regex: 'Regex', empty: 'Пустой/отсутствует', not_empty: 'Заполнен' }, v)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              <SelectItem value="equals">Равен</SelectItem>
              <SelectItem value="contains">Содержит</SelectItem>
              <SelectItem value="regex">Regex</SelectItem>
              <SelectItem value="empty">Пустой/отсутствует</SelectItem>
              <SelectItem value="not_empty">Заполнен</SelectItem>
            </SelectContent>
          </Select>
          {config.mode !== 'empty' && config.mode !== 'not_empty' && (
            <Input value={(config.pattern as string) ?? ''} onChange={(e) => set({ pattern: e.target.value })} placeholder="facebook" />
          )}
        </div>
      );

    case 'DATE_BETWEEN':
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">С</Label>
            <Input type="datetime-local" value={isoToLocalInput((config.from as string) ?? '')} onChange={(e) => set({ from: toIsoOrEmpty(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">По</Label>
            <Input type="datetime-local" value={isoToLocalInput((config.to as string) ?? '')} onChange={(e) => set({ to: toIsoOrEmpty(e.target.value) })} />
          </div>
        </div>
      );

    case 'TIMETABLE':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const days = (config.days as number[]) ?? [];
              const checked = days.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => set({ days: checked ? days.filter((x) => x !== d.value) : [...days, d.value] })}
                  className={`px-2 py-1 rounded-md text-xs border ${checked ? 'bg-primary text-primary-foreground border-primary' : 'border-input'}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Час с</Label>
              <Input type="number" min={0} max={23} value={(config.hourFrom as number) ?? 0} onChange={(e) => set({ hourFrom: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Час по</Label>
              <Input type="number" min={0} max={23} value={(config.hourTo as number) ?? 23} onChange={(e) => set({ hourTo: Number(e.target.value) })} />
            </div>
          </div>
          <Input value={(config.timezone as string) ?? ''} onChange={(e) => set({ timezone: e.target.value })} placeholder="Europe/Moscow" />
        </div>
      );

    case 'LIMIT_CLICKS':
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Лимит показов</Label>
            <Input type="number" min={1} value={(config.max as number) ?? 100} onChange={(e) => set({ max: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Окно, сек (пусто = навсегда)</Label>
            <Input
              type="number"
              min={1}
              value={(config.windowSeconds as number) ?? ''}
              onChange={(e) => set({ windowSeconds: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </div>
      );

    case 'UNIQUENESS':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select value={(config.scope as string) ?? 'ip'} onValueChange={(scope) => set({ scope })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => modeLabel({ ip: 'По IP', ip_ua: 'По IP + User-Agent' }, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[26rem]">
              <SelectItem value="ip">По IP</SelectItem>
              <SelectItem value="ip_ua">По IP + User-Agent</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            placeholder="Окно, сек (по умолч. 30 дней)"
            value={(config.windowSeconds as number) ?? ''}
            onChange={(e) => set({ windowSeconds: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      );

    case 'BOT':
      return (
        <p className="text-xs text-muted-foreground">
          Эвристика без настроек: пустой User-Agent или IP из известного датацентрового диапазона (AWS/GCP/Azure/DigitalOcean/Hetzner/OVH). Слабее платной базы ботов
          — реальный пользователь на VPN тоже может под неё попасть.
        </p>
      );

    default:
      return null;
  }
}
