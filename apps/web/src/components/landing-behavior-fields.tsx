'use client';

// Общие поля "поведения" лендинга — авторедирект и клоакинг по странам. Используется и на
// странице статистики лендинга (редактирование через PATCH /landings/:id), и в обеих формах
// создания (шаблон/ZIP) на /projects/[id]/landings — запрос пользователя 2026-07-03,
// "внедрить и при создании, а не только при редактировании".
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface LandingBehaviorState {
  autoRedirect: boolean;
  cloakingEnabled: boolean;
  countriesText: string;
  redirectUrl: string;
}

export const EMPTY_LANDING_BEHAVIOR: LandingBehaviorState = {
  autoRedirect: false,
  cloakingEnabled: false,
  countriesText: '',
  redirectUrl: '',
};

// Тот же формат, что и LandingsService.update() ждёт от PATCH — используется и после
// создания (см. страницу списка лендингов), и на странице редактирования.
export function behaviorStateToPayload(state: LandingBehaviorState) {
  const cloakingCountries = Array.from(
    new Set(
      state.countriesText
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  return {
    autoRedirect: state.autoRedirect,
    cloakingEnabled: state.cloakingEnabled,
    cloakingCountries,
    cloakingRedirectUrl: state.redirectUrl,
  };
}

// true, если хотя бы одна опция реально включена/заполнена — чтобы не делать лишний PATCH
// сразу после создания, когда пользователь ничего не менял.
export function isLandingBehaviorNonDefault(state: LandingBehaviorState): boolean {
  return state.autoRedirect || state.cloakingEnabled;
}

export function LandingBehaviorFields({
  idPrefix,
  state,
  onChange,
}: {
  idPrefix: string;
  state: LandingBehaviorState;
  onChange: (patch: Partial<LandingBehaviorState>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-auto-redirect`}>Авторедирект</Label>
          <p className="text-xs text-gray-500 mt-0.5">Переход в Telegram сразу при заходе на лендинг, без нажатия кнопки.</p>
        </div>
        <Switch
          id={`${idPrefix}-auto-redirect`}
          checked={state.autoRedirect}
          onCheckedChange={(v) => onChange({ autoRedirect: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-cloaking`}>Клоакинг по странам</Label>
          <p className="text-xs text-gray-500 mt-0.5">
            Реальный лендинг видят только посетители из разрешённых стран, остальные уходят по резервной ссылке.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-cloaking`}
          checked={state.cloakingEnabled}
          onCheckedChange={(v) => onChange({ cloakingEnabled: v })}
        />
      </div>

      {state.cloakingEnabled && (
        <div className="space-y-3 border-l-2 border-gray-100 pl-4 ml-1">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-cloaking-countries`}>Разрешённые страны (коды ISO 3166-1, через запятую)</Label>
            <Input
              id={`${idPrefix}-cloaking-countries`}
              placeholder="RU, UA, KZ"
              value={state.countriesText}
              onChange={(e) => onChange({ countriesText: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-cloaking-url`}>Ссылка для остальных стран</Label>
            <Input
              id={`${idPrefix}-cloaking-url`}
              placeholder="https://en.wikipedia.org"
              value={state.redirectUrl}
              onChange={(e) => onChange({ redirectUrl: e.target.value })}
            />
            <p className="text-xs text-gray-400">Если оставить пустым — используется Wikipedia по умолчанию.</p>
          </div>
        </div>
      )}
    </div>
  );
}
