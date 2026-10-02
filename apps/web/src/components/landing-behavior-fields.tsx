'use client';

// Общие поля "поведения" лендинга — авторедирект и Lead-переключатели. Используется и на
// странице статистики лендинга (редактирование через PATCH /landings/:id), и в обеих формах
// создания (шаблон/ZIP) на /projects/[id]/landings — запрос пользователя 2026-07-03,
// "внедрить и при создании, а не только при редактировании". Клоакинг с 2026-09-24 живёт
// целиком на отдельной странице /cloaking (движок правил, см. components/cloaking/) — этот файл
// его больше не касается вообще, ни здесь, ни в формах создания.
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';

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

// Дополнительный попап (запрос клиентов 2026-10-02) — те же дефолты, что в
// apps/api/src/modules/landings/extra-popup.util.ts (EXTRA_POPUP_DEFAULTS): здесь они нужны как
// placeholder-подсказки и как начальный набор кнопок в форме. Дублируются по той же причине, что
// и тексты подсказки TikTok выше — общего пакета между apps/api и apps/web в монорепо нет.
// Тот же id, что в apps/api/src/modules/landings/extra-popup.util.ts.
export const AGE_GATE_TEMPLATE_ID = 'age-gate-invite';

// Таймер обратного отсчёта (запрос пользователя 2026-10-02: "не будет лучше включить его под
// каждый лэндинг как доп опцию"). Дефолты продублированы из
// apps/api/src/modules/landings/countdown.util.ts (COUNTDOWN_DEFAULTS) — нужны как
// placeholder-подсказки; общего пакета между apps/api и apps/web в монорепо нет.
// У этого шаблона таймер уже внутри собственной вёрстки — там опция не показывается.
export const COUNTDOWN_TEMPLATE_ID = 'countdown-urgency';
export const COUNTDOWN_DEFAULTS = {
  label: '🔒 Доступ закроется через',
  spotsText: '🔥 Осталось 14 мест из 50',
  minutes: 60,
};

export const EXTRA_POPUP_DEFAULTS = {
  title: 'Тебе есть 18 лет?',
  text: 'Подтвердите возраст, чтобы продолжить',
};

export type ExtraPopupAction = 'NEXT_STEP' | 'FINAL' | 'NONE';

export interface ExtraPopupButtonState {
  text: string;
  action: ExtraPopupAction;
}

// Подписи ровно теми словами, которыми действия назвал пользователь в запросе.
export const EXTRA_POPUP_ACTION_LABELS: Record<ExtraPopupAction, string> = {
  NEXT_STEP: 'Второй (главный) попап — след. шаг',
  FINAL: 'Конечный ресурс',
  NONE: 'Без действия',
};

export const EXTRA_POPUP_ACTION_ORDER: ExtraPopupAction[] = ['NEXT_STEP', 'FINAL', 'NONE'];

export const MAX_EXTRA_POPUP_BUTTONS = 4;

// Начальная настройка по умолчанию — вопрос про 18 лет, «Да» ведёт на следующий шаг, «Нет» сразу
// на конечный ресурс (явное требование пользователя).
export const DEFAULT_EXTRA_POPUP_BUTTONS: ExtraPopupButtonState[] = [
  { text: 'Да', action: 'NEXT_STEP' },
  { text: 'Нет', action: 'FINAL' },
];

export interface LandingBehaviorState {
  autoRedirect: boolean;
  // Отправка события Lead (запрос пользователя 2026-09-15) — см. Landing.leadOnClick /
  // Landing.leadOnAutoRedirect в schema.prisma.
  leadOnClick: boolean;
  leadOnAutoRedirect: boolean;
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
  // Дополнительный попап (запрос клиентов 2026-10-02) — см. Landing.extraPopupEnabled в
  // schema.prisma. Пустой заголовок/текст = подставить дефолт, как и у текстов TikTok.
  extraPopupEnabled: boolean;
  extraPopupTitle: string;
  extraPopupText: string;
  extraPopupButtons: ExtraPopupButtonState[];
  // Таймер обратного отсчёта (запрос пользователя 2026-10-02). countdownMinutes — строка, а не
  // число: это поле ввода, пустое значение в нём должно оставаться пустым, а не превращаться в 0.
  countdownEnabled: boolean;
  countdownLabel: string;
  countdownSpotsText: string;
  countdownMinutes: string;
}

export const EMPTY_LANDING_BEHAVIOR: LandingBehaviorState = {
  autoRedirect: false,
  leadOnClick: true,
  leadOnAutoRedirect: false,
  tiktokBrowserHint: false,
  tiktokHintTitle: '',
  tiktokHintSubtitle: '',
  tiktokHintIosSteps: '',
  tiktokHintAndroidSteps: '',
  tiktokHintOpenButtonText: '',
  tiktokHintCopyButtonText: '',
  tiktokHintCopiedText: '',
  extraPopupEnabled: false,
  extraPopupTitle: '',
  extraPopupText: '',
  extraPopupButtons: DEFAULT_EXTRA_POPUP_BUTTONS,
  countdownEnabled: false,
  countdownLabel: '',
  countdownSpotsText: '',
  countdownMinutes: '',
};

// Тот же формат, что и LandingsService.update() ждёт от PATCH — используется и после
// создания (см. страницу списка лендингов), и на странице редактирования. Клоакинг сюда не
// входит вообще — с 2026-09-24 это отдельный движок правил (components/cloaking/), сохраняется
// только на странице /cloaking через свои собственные роуты, никогда через это PATCH.
export function behaviorStateToPayload(state: LandingBehaviorState) {
  return {
    autoRedirect: state.autoRedirect,
    leadOnClick: state.leadOnClick,
    leadOnAutoRedirect: state.leadOnAutoRedirect,
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
    extraPopupEnabled: state.extraPopupEnabled,
    extraPopupConfig: {
      title: state.extraPopupTitle,
      text: state.extraPopupText,
      // Кнопки без текста не отправляем: бэкенд требует непустой текст у каждой кнопки, а пустой
      // массив не принимает вовсе — если не осталось ни одной, пусть подставит свои дефолты.
      buttons: state.extraPopupButtons.filter((b) => b.text.trim()).length
        ? state.extraPopupButtons.filter((b) => b.text.trim()).map((b) => ({ text: b.text.trim(), action: b.action }))
        : undefined,
    },
    countdownEnabled: state.countdownEnabled,
    countdownConfig: {
      label: state.countdownLabel,
      // Пустая строка отправляется как есть — так убирается вторая строка блока; у label пустое
      // значение означает "взять дефолт" (см. resolveCountdown на бэкенде).
      spotsText: state.countdownSpotsText,
      minutes: state.countdownMinutes.trim() ? Number(state.countdownMinutes) : undefined,
    },
  };
}

export function optionsOnlyPayload(state: LandingBehaviorState) {
  const full = behaviorStateToPayload(state);
  return {
    autoRedirect: full.autoRedirect,
    leadOnClick: full.leadOnClick,
    leadOnAutoRedirect: full.leadOnAutoRedirect,
    tiktokBrowserHint: full.tiktokBrowserHint,
    tiktokHintTexts: full.tiktokHintTexts,
    extraPopupEnabled: full.extraPopupEnabled,
    extraPopupConfig: full.extraPopupConfig,
    countdownEnabled: full.countdownEnabled,
    countdownConfig: full.countdownConfig,
  };
}

// true, если хотя бы одна опция реально включена/заполнена — чтобы не делать лишний PATCH
// сразу после создания, когда пользователь ничего не менял.
export function isLandingBehaviorNonDefault(state: LandingBehaviorState): boolean {
  return (
    state.autoRedirect ||
    !state.leadOnClick ||
    state.leadOnAutoRedirect ||
    state.tiktokBrowserHint ||
    state.extraPopupEnabled ||
    state.countdownEnabled ||
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
  templateId,
}: {
  idPrefix: string;
  state: LandingBehaviorState;
  onChange: (patch: Partial<LandingBehaviorState>) => void;
  // Нужен только для того, чтобы скрыть дополнительный попап у шаблона «Проверка возраста +
  // приглашение»: у него такой попап уже встроен (бэкенд такую настройку там и не примет, см.
  // LandingsService.assertExtraPopupAllowed).
  templateId?: string | null;
}) {
  const buttons = state.extraPopupButtons.length ? state.extraPopupButtons : DEFAULT_EXTRA_POPUP_BUTTONS;
  const patchButton = (index: number, patch: Partial<ExtraPopupButtonState>) =>
    onChange({ extraPopupButtons: buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
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

      <div className="rounded-md border border-border p-3 space-y-4">
        <p className="text-sm font-medium">События Lead</p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor={`${idPrefix}-lead-on-click`}>При клике на кнопку</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Отправлять событие Lead, когда человек реально нажал кнопку перехода в Telegram.
            </p>
          </div>
          <Switch
            id={`${idPrefix}-lead-on-click`}
            checked={state.leadOnClick}
            onCheckedChange={(v) => onChange({ leadOnClick: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor={`${idPrefix}-lead-on-auto-redirect`}>При авто-редиректе</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Отправлять Lead при автоматическом переходе, без нажатия кнопки. По умолчанию выключено:
              авторедирект срабатывает почти на каждом визите, поэтому такой Lead численно равен просмотрам —
              для Facebook/TikTok это конверсия на каждом клике, и оптимизация пикселя перестаёт различать
              заинтересованных и случайных. Дублей не будет (в пределах визита Lead отправляется один раз),
              но и сигнала в таком событии почти нет.
            </p>
          </div>
          <Switch
            id={`${idPrefix}-lead-on-auto-redirect`}
            checked={state.leadOnAutoRedirect}
            onCheckedChange={(v) => onChange({ leadOnAutoRedirect: v })}
          />
        </div>
      </div>

      {templateId !== COUNTDOWN_TEMPLATE_ID && (
        <div className="rounded-md border border-border p-3 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={`${idPrefix}-countdown`}>Таймер обратного отсчёта</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Блок с убывающим временем над кнопкой перехода. Отсчёт начинается заново у каждого посетителя.
              </p>
            </div>
            <Switch
              id={`${idPrefix}-countdown`}
              checked={state.countdownEnabled}
              onCheckedChange={(v) => onChange({ countdownEnabled: v })}
            />
          </div>

          {state.countdownEnabled && (
            <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  {/* id поля НЕ `-countdown-label`: Label переключателя выше сам получает
                      id `${idPrefix}-countdown-label` (htmlFor + "-label"), и вышел бы дубликат
                      id в разметке — подпись перестала бы указывать на своё поле. */}
                  <Label htmlFor={`${idPrefix}-countdown-text`}>Подпись над таймером</Label>
                  <Input
                    id={`${idPrefix}-countdown-text`}
                    placeholder={COUNTDOWN_DEFAULTS.label}
                    value={state.countdownLabel}
                    onChange={(e) => onChange({ countdownLabel: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-countdown-minutes`}>Сколько минут отсчитывать</Label>
                  <Input
                    id={`${idPrefix}-countdown-minutes`}
                    inputMode="numeric"
                    placeholder={String(COUNTDOWN_DEFAULTS.minutes)}
                    value={state.countdownMinutes}
                    onChange={(e) => onChange({ countdownMinutes: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-countdown-spots`}>Строка под таймером</Label>
                <Input
                  id={`${idPrefix}-countdown-spots`}
                  placeholder={COUNTDOWN_DEFAULTS.spotsText}
                  value={state.countdownSpotsText}
                  onChange={(e) => onChange({ countdownSpotsText: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Оставьте пустой, если вторая строка не нужна.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {templateId !== AGE_GATE_TEMPLATE_ID && (
        <div className="rounded-md border border-border p-3 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={`${idPrefix}-extra-popup`}>Дополнительный попап</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Окно с вопросом поверх лендинга: пока посетитель не ответит, ни лендинг, ни переход не откроются.
              </p>
            </div>
            <Switch
              id={`${idPrefix}-extra-popup`}
              checked={state.extraPopupEnabled}
              onCheckedChange={(v) => onChange({ extraPopupEnabled: v })}
            />
          </div>

          {state.extraPopupEnabled && (
            <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-extra-popup-title`}>Заголовок</Label>
                  <Input
                    id={`${idPrefix}-extra-popup-title`}
                    placeholder={EXTRA_POPUP_DEFAULTS.title}
                    value={state.extraPopupTitle}
                    onChange={(e) => onChange({ extraPopupTitle: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-extra-popup-text`}>Текст под заголовком</Label>
                  <Input
                    id={`${idPrefix}-extra-popup-text`}
                    placeholder={EXTRA_POPUP_DEFAULTS.text}
                    value={state.extraPopupText}
                    onChange={(e) => onChange({ extraPopupText: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Кнопки</p>

                {buttons.map((button, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Input
                      aria-label={`Текст кнопки ${index + 1}`}
                      placeholder="Текст кнопки"
                      className="flex-1"
                      value={button.text}
                      onChange={(e) => patchButton(index, { text: e.target.value })}
                    />
                    <Select value={button.action} onValueChange={(v) => patchButton(index, { action: v as ExtraPopupAction })}>
                      <SelectTrigger className="w-[15rem]">
                        {/* Без children-функции Base UI показал бы сырое NEXT_STEP/FINAL/NONE —
                            повторяющийся баг, см. get-link-dialog.tsx и components/cloaking. */}
                        <SelectValue>{(v: ExtraPopupAction) => EXTRA_POPUP_ACTION_LABELS[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="w-auto min-w-(--anchor-width)">
                        {EXTRA_POPUP_ACTION_ORDER.map((action) => (
                          <SelectItem key={action} value={action}>
                            {EXTRA_POPUP_ACTION_LABELS[action]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {buttons.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Удалить кнопку ${index + 1}`}
                        onClick={() => onChange({ extraPopupButtons: buttons.filter((_, i) => i !== index) })}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}

                {buttons.length < MAX_EXTRA_POPUP_BUTTONS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange({ extraPopupButtons: [...buttons, { text: '', action: 'NONE' }] })}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Добавить кнопку
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
