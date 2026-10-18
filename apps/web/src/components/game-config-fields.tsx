'use client';

// Настройки игровых шаблонов (запрос пользователя 2026-10-18: "сделай все поля настраиваемыми").
// Один компонент на четыре игры — показывает только поля той игры, что выбрана. Дефолты повторяют
// apps/api/src/modules/landings/game.util.ts: форма сразу показывает то, что увидит посетитель.

import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export const GAME_TEMPLATE_KINDS = {
  'game-wheel': 'wheel',
  'game-scratch': 'scratch',
  'game-boxes': 'boxes',
  'game-quiz': 'quiz',
} as const;

type GameTemplateId = keyof typeof GAME_TEMPLATE_KINDS;
type GameKind = (typeof GAME_TEMPLATE_KINDS)[GameTemplateId];

export function isGameTemplateId(templateId: string | null | undefined): templateId is GameTemplateId {
  return !!templateId && templateId in GAME_TEMPLATE_KINDS;
}

export interface GameQuizQuestion {
  question: string;
  options: string[];
}

export interface GameConfig {
  title: string;
  subtitle: string;
  prizeCaption: string;
  prizeNote: string;
  winButtonText: string;
  finePrint: string;
  accentColor: string;
  segments: string[];
  winIndex: number;
  spinLabel: string;
  prize: string;
  coverText: string;
  revealAllText: string;
  boxPrizes: string[];
  questions: GameQuizQuestion[];
  resultTitle: string;
}

const COMMON: Omit<GameConfig, 'title' | 'subtitle' | 'prizeCaption'> = {
  prizeNote: 'Tu regalo te espera en el canal',
  winButtonText: 'Recibir mi {prize}',
  finePrint: 'Regalo garantizado para cada suscriptor. Se entrega dentro del canal.',
  accentColor: '#2AABEE',
  segments: ['−10%', 'Envío gratis', 'Guía PDF', '−20%', 'Bono VIP', '−15%'],
  winIndex: 3,
  spinLabel: 'GIRAR',
  prize: '−20%',
  coverText: 'RASPA AQUÍ',
  revealAllText: 'raspar todo',
  boxPrizes: ['−15%', 'Bono', '−20%'],
  questions: [
    { question: '¿Qué te interesa más?', options: ['Ropa y calzado', 'Electrónica', 'Hogar y cocina'] },
    { question: '¿Con qué frecuencia compras en línea?', options: ['Cada semana', 'Una vez al mes', 'Casi nunca'] },
  ],
  resultTitle: '¡Listo! Tu regalo',
};

const BY_KIND: Record<GameKind, Partial<GameConfig>> = {
  wheel: { title: 'Gira la rueda de regalos', subtitle: 'Un giro gratis · todos reciben un regalo', prizeCaption: 'en tu próxima compra' },
  scratch: { title: 'Raspa y descubre tu regalo', subtitle: 'Pasa el dedo sobre la tarjeta', prizeCaption: 'en tu primera compra', prize: '−25%' },
  boxes: { title: 'Elige una caja', subtitle: 'Hay un regalo en cada una', prizeCaption: 'tu regalo elegido' },
  quiz: { title: 'Responde y recibe tu regalo', subtitle: '2 preguntas · 10 segundos', prizeCaption: 'en tu próxima compra' },
};

export const GAME_DEFAULT_BUTTON_TEXT = 'Unirme al canal';

export function defaultGameConfig(templateId: GameTemplateId): GameConfig {
  return JSON.parse(JSON.stringify({ ...COMMON, ...BY_KIND[GAME_TEMPLATE_KINDS[templateId]] })) as GameConfig;
}

// Сохранённый конфиг лендинга поверх дефолтов: пустые/отсутствующие ключи берут дефолт игры.
export function mergeGameConfig(templateId: GameTemplateId, saved: Partial<GameConfig> | null | undefined): GameConfig {
  const base = defaultGameConfig(templateId);
  if (!saved) return base;
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof GameConfig)[]) {
    const v = saved[key];
    if (v === undefined || v === null || v === '') continue;
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

const MAX_SEGMENTS = 8;
const MIN_SEGMENTS = 4;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

function Field({ id, label, value, onChange, hint, maxLength = 120 }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; maxLength?: number }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function GameConfigFields({
  templateId,
  value,
  onChange,
  idPrefix,
}: {
  templateId: GameTemplateId;
  value: GameConfig;
  onChange: (next: GameConfig) => void;
  idPrefix: string;
}) {
  const kind = GAME_TEMPLATE_KINDS[templateId];
  const set = <K extends keyof GameConfig>(key: K, v: GameConfig[K]) => onChange({ ...value, [key]: v });
  const id = (s: string) => `${idPrefix}-game-${s}`;

  const setSegment = (i: number, v: string) => set('segments', value.segments.map((s, j) => (j === i ? v : s)));
  const removeSegment = (i: number) => {
    const segments = value.segments.filter((_, j) => j !== i);
    const winIndex = value.winIndex === i ? 0 : value.winIndex > i ? value.winIndex - 1 : value.winIndex;
    onChange({ ...value, segments, winIndex });
  };

  const setQuestion = (qi: number, patch: Partial<GameQuizQuestion>) =>
    set('questions', value.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)));

  return (
    <div className="space-y-4 border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">
        Игра и приз. Подарок получает каждый посетитель. Не обещайте то, чего не выдадите в канале, и не используйте
        денежные суммы, слова про ставки, деньги и инвестиции — это главные причины отказа модерации.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('title')} label="Заголовок игры" value={value.title} onChange={(v) => set('title', v)} />
        <Field id={id('subtitle')} label="Подпись под заголовком" value={value.subtitle} onChange={(v) => set('subtitle', v)} />
      </div>

      {kind === 'wheel' && (
        <div className="space-y-2">
          <Label>Секторы колеса</Label>
          <p className="text-xs text-muted-foreground">От {MIN_SEGMENTS} до {MAX_SEGMENTS}. Отметьте сектор, на котором колесо остановится.</p>
          <div className="space-y-2">
            {value.segments.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  id={id(`win-${i}`)}
                  name={id('win')}
                  checked={value.winIndex === i}
                  onChange={() => set('winIndex', i)}
                  aria-label={`Выпадает сектор ${i + 1}`}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <Input id={id(`seg-${i}`)} value={s} maxLength={40} onChange={(e) => setSegment(i, e.target.value)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  disabled={value.segments.length <= MIN_SEGMENTS}
                  onClick={() => removeSegment(i)}
                  aria-label="Убрать сектор"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          {value.segments.length < MAX_SEGMENTS && (
            <Button type="button" variant="outline" size="sm" onClick={() => set('segments', [...value.segments, 'Regalo'])}>
              <Plus className="size-4 mr-1" /> Добавить сектор
            </Button>
          )}
          <div className="max-w-60">
            <Field id={id('spin')} label="Надпись в центре колеса" value={value.spinLabel} maxLength={20} onChange={(v) => set('spinLabel', v)} />
          </div>
        </div>
      )}

      {kind === 'scratch' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={id('prize')} label="Приз под слоем" value={value.prize} maxLength={40} onChange={(v) => set('prize', v)} />
          <Field id={id('cover')} label="Надпись на слое" value={value.coverText} maxLength={40} onChange={(v) => set('coverText', v)} />
          <Field id={id('reveal')} label="Ссылка «стереть всё»" value={value.revealAllText} maxLength={40} onChange={(v) => set('revealAllText', v)} />
        </div>
      )}

      {kind === 'boxes' && (
        <div className="space-y-1.5">
          <Label>Подарок в каждой коробке</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {value.boxPrizes.map((p, i) => (
              <Input
                key={i}
                id={id(`box-${i}`)}
                value={p}
                maxLength={40}
                aria-label={`Коробка ${i + 1}`}
                onChange={(e) => set('boxPrizes', value.boxPrizes.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
          </div>
        </div>
      )}

      {kind === 'quiz' && (
        <div className="space-y-3">
          {value.questions.map((q, qi) => (
            <div key={qi} className="space-y-2 rounded-md border p-2.5">
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <Field id={id(`q-${qi}`)} label={`Вопрос ${qi + 1}`} value={q.question} onChange={(v) => setQuestion(qi, { question: v })} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={value.questions.length <= 1}
                  onClick={() => set('questions', value.questions.filter((_, j) => j !== qi))}
                  aria-label="Убрать вопрос"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((o, oi) => (
                  <div key={oi} className="flex items-center gap-1">
                    <Input
                      id={id(`q-${qi}-o-${oi}`)}
                      value={o}
                      maxLength={120}
                      aria-label={`Ответ ${oi + 1}`}
                      onChange={(e) => setQuestion(qi, { options: q.options.map((x, j) => (j === oi ? e.target.value : x)) })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled={q.options.length <= MIN_OPTIONS}
                      onClick={() => setQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })}
                      aria-label="Убрать ответ"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {q.options.length < MAX_OPTIONS && (
                <Button type="button" variant="outline" size="sm" onClick={() => setQuestion(qi, { options: [...q.options, 'Otra opción'] })}>
                  <Plus className="size-4 mr-1" /> Ответ
                </Button>
              )}
            </div>
          ))}
          {value.questions.length < MAX_QUESTIONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set('questions', [...value.questions, { question: 'Nueva pregunta', options: ['Sí', 'No'] }])}
            >
              <Plus className="size-4 mr-1" /> Добавить вопрос
            </Button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id('result')} label="Заголовок после ответов" value={value.resultTitle} onChange={(v) => set('resultTitle', v)} />
            <Field id={id('qprize')} label="Приз" value={value.prize} maxLength={40} onChange={(v) => set('prize', v)} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t">
        <Field id={id('caption')} label="Подпись под призом" value={value.prizeCaption} onChange={(v) => set('prizeCaption', v)} />
        <Field id={id('note')} label="Строка под подписью" value={value.prizeNote} onChange={(v) => set('prizeNote', v)} />
        <Field
          id={id('winbtn')}
          label="Текст кнопки после выигрыша"
          value={value.winButtonText}
          onChange={(v) => set('winButtonText', v)}
          hint="{prize} заменится на выигранный приз"
        />
        <div className="space-y-1.5">
          <Label htmlFor={id('color')}>Цвет кнопки и игры</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id={id('color')}
              value={value.accentColor}
              onChange={(e) => set('accentColor', e.target.value)}
              className="h-9 w-12 rounded border bg-transparent p-0.5"
            />
            <span className="text-sm text-muted-foreground tabular-nums">{value.accentColor.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('fine')}>Сноска внизу страницы</Label>
        <Textarea id={id('fine')} rows={2} maxLength={300} value={value.finePrint} onChange={(e) => set('finePrint', e.target.value)} />
      </div>
    </div>
  );
}
