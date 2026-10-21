// Типы и заготовки конструктора лендингов — зеркало apps/api/src/modules/landings/builder.util.ts
// (формат version 2). Сервер всё равно приводит конфиг к допустимым значениям сам, здесь — то,
// что нужно форме: значения по умолчанию, списки вариантов и заготовки.

export const BUILDER_TEMPLATE_ID = 'builder';
export const MAX_SCREENS = 6;
export const MAX_BUTTONS = 4;

export type ButtonStyle = 'filled' | 'outline' | 'soft' | 'plain';
export type ButtonAction = 'telegram' | 'next' | 'url' | 'none';
export type ScreenKind = 'question' | 'channel' | 'media';

// Своё фото/видео шага (2026-10-21): круг («кружок»), скруглённое или прямоугольник.
export interface BuilderMedia {
  type: 'image' | 'video';
  url: string;
  poster: string;
  shape: 'circle' | 'rounded' | 'rect';
  size: number;
  radius: number;
  position: 'top' | 'middle' | 'bottom';
  autoplay: boolean;
  controls: boolean;
  ringColor: string;
  ringWidth: number;
  shadow: boolean;
}

export interface BuilderButton {
  text: string;
  style: ButtonStyle;
  action: ButtonAction;
  url?: string;
  color: string;
  pulse: boolean;
}

export interface ScreenStyle {
  card: boolean;
  cardColor: string;
  cardOpacity: number;
  glass: boolean;
  shadow: 'none' | 'soft' | 'strong';
  radius: number;
  padding: number;
  width: number;
  align: 'center' | 'left';
  titleSize: number;
  titleWeight: number;
  titleColor: string;
  textSize: number;
  textColor: string;
  btnLayout: 'row' | 'column';
  btnRadius: number;
  btnHeight: number;
  btnSize: number;
  btnWeight: number;
  animation: 'none' | 'fade' | 'slide' | 'zoom';
  avatarSize: number;
}

export interface BuilderScreen {
  kind: ScreenKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  showAvatar: boolean;
  subscribersText: string;
  media: BuilderMedia | null;
  buttons: BuilderButton[];
  style: ScreenStyle;
}

export interface BuilderBackground {
  type: 'color' | 'gradient' | 'image';
  color: string;
  from: string;
  to: string;
  angle: number;
  imageKey?: string | null;
  dim: number;
  blur: number;
}

export interface BuilderConfig {
  version: 2;
  font: string;
  accentColor: string;
  textColor: string;
  background: BuilderBackground;
  screens: BuilderScreen[];
}

export const FONT_OPTIONS: { value: string; label: string; css: string }[] = [
  { value: 'system', label: 'Системный', css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" },
  { value: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { value: 'helvetica', label: 'Helvetica', css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { value: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { value: 'tahoma', label: 'Tahoma', css: 'Tahoma, Verdana, sans-serif' },
  { value: 'trebuchet', label: 'Trebuchet MS', css: "'Trebuchet MS', Helvetica, sans-serif" },
  { value: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { value: 'times', label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { value: 'courier', label: 'Courier New', css: "'Courier New', Courier, monospace" },
  { value: 'impact', label: 'Impact', css: "Impact, 'Arial Black', sans-serif" },
  { value: 'manrope', label: 'Manrope (Google)', css: "'Manrope', sans-serif" },
];

export const CARD_STYLE: ScreenStyle = {
  card: true,
  cardColor: '#28282C',
  cardOpacity: 86,
  glass: true,
  shadow: 'soft',
  radius: 18,
  padding: 20,
  width: 300,
  align: 'center',
  titleSize: 18,
  titleWeight: 800,
  titleColor: '',
  textSize: 14,
  textColor: '',
  btnLayout: 'row',
  btnRadius: 0,
  btnHeight: 50,
  btnSize: 17,
  btnWeight: 600,
  animation: 'fade',
  avatarSize: 88,
};

export const PAGE_STYLE: ScreenStyle = {
  ...CARD_STYLE,
  card: false,
  glass: false,
  shadow: 'none',
  padding: 8,
  width: 420,
  titleSize: 38,
  textSize: 16,
  btnLayout: 'column',
  btnRadius: 999,
  btnHeight: 58,
  btnWeight: 700,
  avatarSize: 112,
};

export const CHANNEL_STYLE: ScreenStyle = {
  ...CARD_STYLE,
  cardColor: '#1E1E1E',
  cardOpacity: 100,
  glass: false,
  radius: 24,
  padding: 24,
  width: 340,
  titleSize: 24,
  textSize: 15,
  btnLayout: 'column',
  btnRadius: 12,
  btnHeight: 52,
  btnWeight: 700,
  animation: 'zoom',
  avatarSize: 104,
};

export function newMediaFor(type: 'image' | 'video', url: string, poster: string, prev?: BuilderMedia | null): BuilderMedia {
  if (prev) return { ...prev, type, url, poster };
  return type === 'video'
    ? { type, url, poster, shape: 'circle', size: 220, radius: 18, position: 'top', autoplay: true, controls: false, ringColor: '', ringWidth: 3, shadow: true }
    : { type, url, poster: '', shape: 'rounded', size: 280, radius: 18, position: 'top', autoplay: false, controls: false, ringColor: '', ringWidth: 0, shadow: false };
}

export function newQuestionScreen(style: ScreenStyle = CARD_STYLE): BuilderScreen {
  return {
    kind: 'question',
    eyebrow: '',
    title: 'Новый вопрос?',
    subtitle: '',
    showAvatar: true,
    subscribersText: '',
    media: null,
    buttons: [
      { text: 'Нет', style: 'outline', action: 'telegram', color: '', pulse: false },
      { text: 'Да', style: 'filled', action: 'telegram', color: '', pulse: false },
    ],
    style: { ...style },
  };
}

export function newChannelScreen(): BuilderScreen {
  return {
    kind: 'channel',
    eyebrow: '',
    title: '{channel}',
    subtitle: 'Подписывайся, чтобы не пропустить главное',
    showAvatar: true,
    subscribersText: '{count} подписчиков',
    media: null,
    buttons: [{ text: 'Вступить в канал', style: 'filled', action: 'telegram', color: '', pulse: true }],
    style: { ...CHANNEL_STYLE },
  };
}

// Шаг «Фото / видео»: медиа крупно, короткая подпись и кнопка дальше.
export function newMediaScreen(): BuilderScreen {
  return {
    kind: 'media',
    eyebrow: '',
    title: 'Посмотри, что внутри',
    subtitle: '',
    showAvatar: false,
    subscribersText: '',
    media: null,
    buttons: [{ text: 'Дальше', style: 'filled', action: 'next', color: '', pulse: false }],
    style: { ...CHANNEL_STYLE, animation: 'fade' },
  };
}

export const PRESETS: { id: string; label: string; config: BuilderConfig }[] = [
  {
    id: 'ios',
    label: 'Окно iOS на градиенте',
    config: {
      version: 2,
      font: 'system',
      accentColor: '#0A84FF',
      textColor: '#FFFFFF',
      background: { type: 'gradient', color: '#141414', from: '#5B4A9E', to: '#8A3F6E', angle: 160, dim: 30, blur: 0 },
      screens: [
        {
          kind: 'question',
          eyebrow: '',
          title: 'Тебе больше 18 лет?',
          subtitle: 'Подтверди возраст, чтобы продолжить',
          showAvatar: true,
          subscribersText: '',
          media: null,
          buttons: [
            { text: 'Нет', style: 'plain', action: 'telegram', color: '', pulse: false },
            { text: 'Да', style: 'plain', action: 'telegram', color: '', pulse: false },
          ],
          style: { ...CARD_STYLE },
        },
      ],
    },
  },
  {
    id: 'white',
    label: 'Белый, крупный вопрос',
    config: {
      version: 2,
      font: 'helvetica',
      accentColor: '#111111',
      textColor: '#111111',
      background: { type: 'color', color: '#FFFFFF', from: '#FFFFFF', to: '#EDEDED', angle: 180, dim: 30, blur: 0 },
      screens: [
        {
          kind: 'question',
          eyebrow: '',
          title: 'Тебе есть 18 лет?',
          subtitle: '',
          showAvatar: true,
          subscribersText: '',
          media: null,
          buttons: [
            { text: 'ДА', style: 'filled', action: 'telegram', color: '', pulse: false },
            { text: 'НЕТ', style: 'outline', action: 'telegram', color: '', pulse: false },
          ],
          style: { ...PAGE_STYLE },
        },
      ],
    },
  },
  {
    id: 'dark',
    label: 'Тёмный с красной кнопкой',
    config: {
      version: 2,
      font: 'system',
      accentColor: '#E5484D',
      textColor: '#FFFFFF',
      background: { type: 'color', color: '#0E0E10', from: '#1A1A1F', to: '#0E0E10', angle: 180, dim: 30, blur: 0 },
      screens: [
        {
          kind: 'question',
          eyebrow: 'Только для Польши 🇵🇱',
          title: 'Ты живёшь в Польше?',
          subtitle: '',
          showAvatar: true,
          subscribersText: '',
          media: null,
          buttons: [
            { text: 'Нет', style: 'outline', action: 'telegram', color: '', pulse: false },
            { text: 'Да', style: 'filled', action: 'telegram', color: '', pulse: false },
          ],
          style: { ...PAGE_STYLE },
        },
      ],
    },
  },
  {
    id: 'age-channel',
    label: 'Вопрос → карточка канала',
    config: {
      version: 2,
      font: 'system',
      accentColor: '#2AABEE',
      textColor: '#FFFFFF',
      background: { type: 'gradient', color: '#0E1621', from: '#17212B', to: '#0E1621', angle: 180, dim: 30, blur: 0 },
      screens: [
        {
          kind: 'question',
          eyebrow: '',
          title: 'Тебе больше 18 лет?',
          subtitle: 'Канал только для взрослых',
          showAvatar: true,
          subscribersText: '',
          media: null,
          buttons: [
            { text: 'Нет', style: 'plain', action: 'telegram', color: '', pulse: false },
            { text: 'Да', style: 'plain', action: 'next', color: '', pulse: false },
          ],
          style: { ...CARD_STYLE },
        },
        newChannelScreen(),
      ],
    },
  },
  {
    id: 'owner',
    label: 'Кружок автора → канал',
    config: {
      version: 2,
      font: 'system',
      accentColor: '#2AABEE',
      textColor: '#FFFFFF',
      background: { type: 'gradient', color: '#0E1621', from: '#17212B', to: '#0E1621', angle: 180, dim: 30, blur: 0 },
      screens: [
        {
          ...newMediaScreen(),
          title: 'Привет! Я автор канала 👋',
          subtitle: 'Загрузите своё видео-кружок во вкладке «Содержимое»',
          style: { ...CHANNEL_STYLE, card: false, glass: false, shadow: 'none', animation: 'zoom' },
        },
        newChannelScreen(),
      ],
    },
  },
];

export function defaultBuilderConfig(): BuilderConfig {
  return structuredClone(PRESETS[0].config);
}

// Сохранённый конфиг уже приведён сервером к версии 2; на всякий случай дополняем пропуски.
export function normalizeBuilderConfig(raw: unknown): BuilderConfig {
  const def = defaultBuilderConfig();
  if (!raw || typeof raw !== 'object') return def;
  const c = raw as Partial<BuilderConfig>;
  if (c.version !== 2) return def;
  return {
    ...def,
    ...c,
    version: 2,
    background: { ...def.background, ...(c.background ?? {}) },
    screens: (c.screens?.length ? c.screens : def.screens).map((s) => ({
      ...newQuestionScreen(),
      ...s,
      media: s.media ?? null,
      style: { ...(s.kind === 'channel' ? CHANNEL_STYLE : CARD_STYLE), ...(s.style ?? {}) },
      buttons: (s.buttons ?? []).map((b) => ({ ...b, color: b.color ?? '', pulse: b.pulse ?? false })),
    })),
  };
}

export const STYLE_LABELS = { filled: 'Залитая', outline: 'Контур', soft: 'Мягкая', plain: 'Текст' } as const;
export const ACTION_LABELS = { telegram: 'В канал', next: 'След. шаг', url: 'Ссылка', none: 'Ничего' } as const;
export const ANIMATION_LABELS = { none: 'Нет', fade: 'Появление', slide: 'Снизу', zoom: 'Увеличение' } as const;
export const SHADOW_LABELS = { none: 'Нет', soft: 'Мягкая', strong: 'Сильная' } as const;
export const KIND_LABELS = { question: 'Вопрос', channel: 'Карточка канала', media: 'Фото / видео' } as const;
