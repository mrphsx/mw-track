'use client';

// Часовой пояс проекта (запрос пользователя 2026-07-04, диалоги с клиентами) — проект может
// целиться в аудиторию на другом конце света, "сутки" во всех дневных графиках считаются по
// этой зоне, не по UTC. ~400 IANA-зон — datalist вместо Select: нативный поиск по вводу
// браузером, без отдельного компонента-комбобокса.
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

export function TimezoneInput({
  value,
  onChange,
  id = 'timezone',
  label = 'Часовой пояс проекта',
  hint = 'Влияет на границы «суток» во всех дневных графиках этого проекта (подписки, диалоги, события) — полезно, если аудитория проекта на другом конце света.',
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  // label/hint — опциональные (запрос пользователя 2026-08-05: тот же инпут переиспользован для
  // часового пояса отправки рассылки, где текст должен быть другим) — дефолт сохраняет исходный
  // текст для уже существующих вызовов (настройки проекта, создание проекта).
  label?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} list={`${id}-options`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="UTC" />
      <datalist id={`${id}-options`}>
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
