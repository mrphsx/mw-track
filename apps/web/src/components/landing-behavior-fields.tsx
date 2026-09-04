'use client';

// Общие поля "поведения" лендинга — авторедирект и клоакинг по странам. Используется и на
// странице статистики лендинга (редактирование через PATCH /landings/:id), и в обеих формах
// создания (шаблон/ZIP) на /projects/[id]/landings — запрос пользователя 2026-07-03,
// "внедрить и при создании, а не только при редактировании".
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

// Дефолты — те же строки, что встроены в apps/sdk/src/browser.ts (HINT_DEFAULTS). Дублируются
// здесь как placeholder-подсказки в форме (запрос пользователя 2026-08-27: "оставьте поле
// пустым, чтобы вернуть значение по умолчанию") — держать в одном месте негде, SDK и apps/web
// не имеют общего пакета в монорепо (та же ситуация, что и с картой параметров ссылки).
export const TIKTOK_HINT_TEXT_DEFAULTS = {
  title: 'Open in your browser',
  subtitle: 'To join the channel, please open this page in your browser.',
  iosSteps: 'Tap the ⋯ menu at the top-right corner.\nChoose "Open in Browser".',
  androidSteps: 'Tap the ⋯ menu at the top-right corner.\nChoose "Open in browser".',
  openButtonText: 'Open in browser',
  copyButtonText: 'Copy link',
  copiedText: 'Link copied. Paste it into your browser.',
};

export interface LandingBehaviorState {
  autoRedirect: boolean;
  cloakingEnabled: boolean;
  countriesText: string;
  redirectUrl: string;
  // Доп. инструкции для TikTok (запрос пользователя 2026-08-25) — см. Landing.tiktokBrowserHint
  // в schema.prisma для полного разбора проблемы.
  tiktokBrowserHint: boolean;
  // Тексты попапа-подсказки (запрос пользователя 2026-08-27) — пустая строка = использовать
  // встроенный дефолт SDK, см. TIKTOK_HINT_TEXT_DEFAULTS выше.
  tiktokHintTitle: string;
  tiktokHintSubtitle: string;
  tiktokHintIosSteps: string;
  tiktokHintAndroidSteps: string;
  tiktokHintOpenButtonText: string;
  tiktokHintCopyButtonText: string;
  tiktokHintCopiedText: string;
}

export const EMPTY_LANDING_BEHAVIOR: LandingBehaviorState = {
  autoRedirect: false,
  cloakingEnabled: false,
  countriesText: '',
  redirectUrl: '',
  tiktokBrowserHint: false,
  tiktokHintTitle: '',
  tiktokHintSubtitle: '',
  tiktokHintIosSteps: '',
  tiktokHintAndroidSteps: '',
  tiktokHintOpenButtonText: '',
  tiktokHintCopyButtonText: '',
  tiktokHintCopiedText: '',
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
    tiktokBrowserHint: state.tiktokBrowserHint,
    tiktokHintTexts: {
      title: state.tiktokHintTitle,
      subtitle: state.tiktokHintSubtitle,
      iosSteps: state.tiktokHintIosSteps,
      androidSteps: state.tiktokHintAndroidSteps,
      openButtonText: state.tiktokHintOpenButtonText,
      copyButtonText: state.tiktokHintCopyButtonText,
      copiedText: state.tiktokHintCopiedText,
    },
  };
}

// true, если хотя бы одна опция реально включена/заполнена — чтобы не делать лишний PATCH
// сразу после создания, когда пользователь ничего не менял.
export function isLandingBehaviorNonDefault(state: LandingBehaviorState): boolean {
  return (
    state.autoRedirect ||
    state.cloakingEnabled ||
    state.tiktokBrowserHint ||
    [
      state.tiktokHintTitle,
      state.tiktokHintSubtitle,
      state.tiktokHintIosSteps,
      state.tiktokHintAndroidSteps,
      state.tiktokHintOpenButtonText,
      state.tiktokHintCopyButtonText,
      state.tiktokHintCopiedText,
    ].some((v) => v.trim())
  );
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
          <p className="text-xs text-muted-foreground mt-0.5">Переход в Telegram сразу при заходе на лендинг, без нажатия кнопки.</p>
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
          <p className="text-xs text-muted-foreground mt-0.5">
            Реальный лендинг видят только посетители из разрешённых стран, остальные уходят по резервной ссылке.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-cloaking`}
          checked={state.cloakingEnabled}
          onCheckedChange={(v) => onChange({ cloakingEnabled: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-tiktok-hint`}>Доп. инструкции для TikTok</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Решает проблему трафика из TikTok: во встроенном браузере приложения кнопка не открывает Telegram по диплинку.
            iOS — подсказываем нажать «···» вверху справа и выбрать «Open in Browser». Android — по клику автоматически
            открываем во внешнем браузере.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-tiktok-hint`}
          checked={state.tiktokBrowserHint}
          onCheckedChange={(v) => onChange({ tiktokBrowserHint: v })}
        />
      </div>

      {state.cloakingEnabled && (
        <div className="space-y-3 border-l-2 border-border pl-4 ml-1">
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
            <p className="text-xs text-muted-foreground">Если оставить пустым — используется Wikipedia по умолчанию.</p>
          </div>
        </div>
      )}

      {state.tiktokBrowserHint && (
        <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
          <div>
            <p className="text-sm font-medium">Тексты окна с инструкцией</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Тексты, которые видит лид во всплывающем окне. Оставьте поле пустым, чтобы вернуть значение по умолчанию.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-title`}>Заголовок</Label>
              <Input
                id={`${idPrefix}-tiktok-title`}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.title}
                value={state.tiktokHintTitle}
                onChange={(e) => onChange({ tiktokHintTitle: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-subtitle`}>Подзаголовок</Label>
              <Input
                id={`${idPrefix}-tiktok-subtitle`}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.subtitle}
                value={state.tiktokHintSubtitle}
                onChange={(e) => onChange({ tiktokHintSubtitle: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-ios-steps`}>Инструкция для iOS</Label>
              <Textarea
                id={`${idPrefix}-tiktok-ios-steps`}
                rows={3}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.iosSteps}
                value={state.tiktokHintIosSteps}
                onChange={(e) => onChange({ tiktokHintIosSteps: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Каждая строка — отдельный шаг (нумеруются автоматически).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-android-steps`}>Инструкция для Android</Label>
              <Textarea
                id={`${idPrefix}-tiktok-android-steps`}
                rows={3}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.androidSteps}
                value={state.tiktokHintAndroidSteps}
                onChange={(e) => onChange({ tiktokHintAndroidSteps: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Каждая строка — отдельный шаг (нумеруются автоматически).</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-open-btn`}>Кнопка «Открыть»</Label>
              <Input
                id={`${idPrefix}-tiktok-open-btn`}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.openButtonText}
                value={state.tiktokHintOpenButtonText}
                onChange={(e) => onChange({ tiktokHintOpenButtonText: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-copy-btn`}>Кнопка «Копировать»</Label>
              <Input
                id={`${idPrefix}-tiktok-copy-btn`}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.copyButtonText}
                value={state.tiktokHintCopyButtonText}
                onChange={(e) => onChange({ tiktokHintCopyButtonText: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-tiktok-copied`}>После копирования</Label>
              <Input
                id={`${idPrefix}-tiktok-copied`}
                placeholder={TIKTOK_HINT_TEXT_DEFAULTS.copiedText}
                value={state.tiktokHintCopiedText}
                onChange={(e) => onChange({ tiktokHintCopiedText: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Также текст на стрелке-указателе.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
