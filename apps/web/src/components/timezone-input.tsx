'use client';

// Часовой пояс проекта (запрос пользователя 2026-07-04, диалоги с клиентами) — проект может
// целиться в аудиторию на другом конце света, "сутки" во всех дневных графиках считаются по
// этой зоне, не по UTC. ~400 IANA-зон — datalist вместо Select: нативный поиск по вводу
// браузером, без отдельного компонента-комбобокса.
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

export function TimezoneInput({ value, onChange, id = 'timezone' }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Часовой пояс проекта</Label>
      <Input id={id} list={`${id}-options`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="UTC" />
      <datalist id={`${id}-options`}>
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      <p className="text-xs text-gray-500">
        Влияет на границы &laquo;суток&raquo; во всех дневных графиках этого проекта (подписки, диалоги,
        события) — полезно, если аудитория проекта на другом конце света.
      </p>
    </div>
  );
}
