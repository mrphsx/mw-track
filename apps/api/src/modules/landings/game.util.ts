// Игровые лендинги с подарком (запрос пользователя 2026-10-18: "колесо фортуны или что-то другое
// более в форме игры с призами... сразу думай чтобы это было хорошо для фб ботов"). Четыре шаблона
// с одной общей вёрсткой (templates/game/template.html): колесо подарков, стиралка, три коробки,
// мини-опрос. Отличается только игровая зона, поэтому все четыре id рендерятся из одной папки,
// а какая игра на странице — решает {{GAME_KIND}}.
//
// Все тексты игры настраиваются ("сделай все поля настраиваемыми") и хранятся одним JSON в
// Landing.gameConfig, как countdownConfig/extraPopupConfig: пустой или отсутствующий ключ = дефолт
// этого ключа для конкретной игры.
//
// Модерация Facebook: подарок гарантирован каждому (так и написано в finePrint по умолчанию), нет
// ставки и проигрыша, приз не денежный — это промо-механика, а не азартная игра. Весь видимый
// текст (заголовок, подпись, кнопка, сноска) отдаётся сервером прямо в HTML, а скрипт только
// строит саму игру: краулер Facebook скрипты почти не выполняет и должен видеть нормальную
// страницу. Кнопка в канал рабочая ещё до игры.

export const GAME_TEMPLATE_FOLDER = 'game';

export const GAME_KINDS = {
  'game-wheel': 'wheel',
  'game-scratch': 'scratch',
  'game-boxes': 'boxes',
  'game-quiz': 'quiz',
} as const;

export type GameTemplateId = keyof typeof GAME_KINDS;
export type GameKind = (typeof GAME_KINDS)[GameTemplateId];

export function isGameTemplate(templateId: string | null | undefined): templateId is GameTemplateId {
  return !!templateId && templateId in GAME_KINDS;
}

export const GAME_LIMITS = {
  text: 120,
  longText: 300,
  minSegments: 4,
  maxSegments: 8,
  boxes: 3,
  minQuestions: 1,
  maxQuestions: 3,
  minOptions: 2,
  maxOptions: 4,
};

export interface QuizQuestion {
  question: string;
  options: string[];
}

export interface GameConfig {
  title: string;
  subtitle: string;
  prizeCaption: string;
  prizeNote: string;
  // {prize} подставляется текстом выигранного приза
  winButtonText: string;
  finePrint: string;
  accentColor: string;
  // колесо
  segments: string[];
  winIndex: number;
  spinLabel: string;
  // стиралка и опрос — приз задаётся напрямую
  prize: string;
  coverText: string;
  revealAllText: string;
  // коробки
  boxPrizes: string[];
  // опрос
  questions: QuizQuestion[];
  resultTitle: string;
}

const COMMON_DEFAULTS = {
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

const KIND_DEFAULTS: Record<GameKind, Pick<GameConfig, 'title' | 'subtitle' | 'prizeCaption'> & Partial<GameConfig>> = {
  wheel: { title: 'Gira la rueda de regalos', subtitle: 'Un giro gratis · todos reciben un regalo', prizeCaption: 'en tu próxima compra' },
  scratch: { title: 'Raspa y descubre tu regalo', subtitle: 'Pasa el dedo sobre la tarjeta', prizeCaption: 'en tu primera compra', prize: '−25%' },
  boxes: { title: 'Elige una caja', subtitle: 'Hay un regalo en cada una', prizeCaption: 'tu regalo elegido' },
  quiz: { title: 'Responde y recibe tu regalo', subtitle: '2 preguntas · 10 segundos', prizeCaption: 'en tu próxima compra' },
};

export function defaultGameConfig(kind: GameKind): GameConfig {
  return { ...COMMON_DEFAULTS, ...KIND_DEFAULTS[kind] } as GameConfig;
}

function str(value: unknown, fallback: string, max = GAME_LIMITS.text): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function strList(value: unknown, fallback: string[], min: number, max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((v): v is string => typeof v === 'string' && !!v.trim())
    .map((v) => v.trim().slice(0, GAME_LIMITS.text))
    .slice(0, max);
  return list.length >= min ? list : fallback;
}

export function resolveGameConfig(kind: GameKind, raw: unknown): GameConfig {
  const def = defaultGameConfig(kind);
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const segments = strList(c.segments, def.segments, GAME_LIMITS.minSegments, GAME_LIMITS.maxSegments);
  const winIndex = Number(c.winIndex);

  let questions = def.questions;
  if (Array.isArray(c.questions)) {
    const parsed = c.questions
      .map((q) => {
        const item = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
        const question = typeof item.question === 'string' ? item.question.trim().slice(0, GAME_LIMITS.text) : '';
        const options = strList(item.options, [], GAME_LIMITS.minOptions, GAME_LIMITS.maxOptions);
        return question && options.length ? { question, options } : null;
      })
      .filter((q): q is QuizQuestion => !!q)
      .slice(0, GAME_LIMITS.maxQuestions);
    if (parsed.length >= GAME_LIMITS.minQuestions) questions = parsed;
  }

  const boxes = strList(c.boxPrizes, def.boxPrizes, GAME_LIMITS.boxes, GAME_LIMITS.boxes);

  return {
    title: str(c.title, def.title),
    subtitle: str(c.subtitle, def.subtitle),
    prizeCaption: str(c.prizeCaption, def.prizeCaption),
    prizeNote: str(c.prizeNote, def.prizeNote),
    winButtonText: str(c.winButtonText, def.winButtonText),
    finePrint: str(c.finePrint, def.finePrint, GAME_LIMITS.longText),
    accentColor: typeof c.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.accentColor) ? c.accentColor : def.accentColor,
    segments,
    winIndex: Number.isInteger(winIndex) && winIndex >= 0 && winIndex < segments.length ? winIndex : Math.min(def.winIndex, segments.length - 1),
    spinLabel: str(c.spinLabel, def.spinLabel, 20),
    prize: str(c.prize, def.prize, 40),
    coverText: str(c.coverText, def.coverText, 40),
    revealAllText: str(c.revealAllText, def.revealAllText, 40),
    boxPrizes: boxes,
    questions,
    resultTitle: str(c.resultTitle, def.resultTitle),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// JSON внутри <script type="application/json"> — экранируем всё, что может закрыть тег или
// сломать разбор: "<" (</script>), а также U+2028/U+2029.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

// Переменные для template.html: тексты, видимые без скрипта, экранированы для HTML; полный конфиг
// игры — JSON для скрипта страницы.
export function buildGameVars(templateId: GameTemplateId, raw: unknown): Record<string, string> {
  const kind = GAME_KINDS[templateId];
  const config = resolveGameConfig(kind, raw);
  return {
    GAME_KIND: kind,
    GAME_TITLE: escapeHtml(config.title),
    GAME_SUBTITLE: escapeHtml(config.subtitle),
    GAME_FINE_PRINT: escapeHtml(config.finePrint),
    GAME_ACCENT: config.accentColor,
    GAME_CONFIG_JSON: jsonForScript({ kind, ...config }),
  };
}
