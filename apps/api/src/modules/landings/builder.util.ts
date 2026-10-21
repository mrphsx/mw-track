// Конструктор лендингов (запрос пользователя 2026-10-20, переработан 2026-10-21). Один шаблон
// (templates/builder), всё оформление и шаги — в Landing.builderConfig.
//
// Шаги бывают трёх видов: «Вопрос» (надпись, вопрос, пояснение, кнопки), «Карточка канала»
// (аватар, название, подписчики, описание, кнопки — как в обычных лендингах) и «Фото / видео».
// У любого шага может быть своё фото или видео (2026-10-21): круг («кружок» владельца канала),
// скруглённое или прямоугольник, размер, обводка, место в шаге, автозапуск без звука. У каждого шага своё
// оформление: попап вкл/выкл, цвет и прозрачность, стекло, тень, скругление, отступы, ширина,
// выравнивание, шрифты и кнопки, анимация появления. Общие настройки — шрифт, акцент, цвет текста
// и фон страницы.
//
// Весь видимый текст отдаётся сервером прямо в HTML (краулер Facebook скрипты почти не выполняет),
// скрипт шаблона только переключает шаги. Кнопка «в канал» — ссылка на {{TG_REDIRECT_URL}} с
// data-track="Lead", как у остальных шаблонов.
//
// Старый формат (2026-10-20: layout/textTheme наверху, шаги без kind/style) читается как раньше:
// resolveBuilderConfig переводит его в новый, и такие лендинги выглядят так же, как до переделки.

export const BUILDER_TEMPLATE_ID = 'builder';

export const BUILDER_LIMITS = {
  eyebrow: 80,
  title: 200,
  subtitle: 800,
  buttonText: 60,
  url: 500,
  minScreens: 1,
  maxScreens: 6,
  minButtons: 0,
  maxButtons: 4,
  maxJsonBytes: 40_000,
};

// Внутри названий — только одинарные кавычки: значение уходит в style="..." страницы.
// Только шрифты, которые есть в браузерах без загрузки (кроме manrope — он был у первой версии
// конструктора и грузится с Google Fonts, оставлен ради уже созданных лендингов).
export const BUILDER_FONTS: Record<string, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Verdana, sans-serif",
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
  impact: "Impact, 'Arial Black', sans-serif",
  manrope: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export type BuilderButtonStyle = 'filled' | 'outline' | 'soft' | 'plain';
export type BuilderButtonAction = 'telegram' | 'next' | 'url' | 'none';
export type BuilderScreenKind = 'question' | 'channel' | 'media';

export interface BuilderMedia {
  type: 'image' | 'video';
  url: string;
  // Кадр-обложка видео (показывается, пока видео грузится).
  poster: string;
  shape: 'circle' | 'rounded' | 'rect';
  size: number; // ширина, px
  radius: number; // для «скруглённого»
  position: 'top' | 'middle' | 'bottom'; // над заголовком / между заголовком и текстом / под текстом
  autoplay: boolean; // видео: сразу, без звука, по кругу; нажатие включает звук
  controls: boolean;
  ringColor: string; // обводка; пусто — без обводки
  ringWidth: number;
  shadow: boolean;
}

export interface BuilderButton {
  text: string;
  style: BuilderButtonStyle;
  action: BuilderButtonAction;
  url?: string;
  // Свой цвет кнопки; пусто — акцентный цвет.
  color: string;
  pulse: boolean;
}

export interface BuilderScreenStyle {
  card: boolean;
  cardColor: string;
  cardOpacity: number; // 0-100
  glass: boolean;
  shadow: 'none' | 'soft' | 'strong';
  radius: number;
  padding: number;
  width: number;
  align: 'center' | 'left';
  titleSize: number;
  titleWeight: number;
  titleColor: string; // пусто — общий цвет текста
  textSize: number;
  textColor: string; // пусто — приглушённый общий цвет
  btnLayout: 'row' | 'column';
  btnRadius: number;
  btnHeight: number;
  btnSize: number;
  btnWeight: number;
  animation: 'none' | 'fade' | 'slide' | 'zoom';
  avatarSize: number;
}

export interface BuilderScreen {
  kind: BuilderScreenKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  // Только для карточки канала.
  showAvatar: boolean;
  subscribersText: string;
  media: BuilderMedia | null;
  buttons: BuilderButton[];
  style: BuilderScreenStyle;
}

export interface BuilderBackground {
  type: 'color' | 'gradient' | 'image';
  color: string;
  from: string;
  to: string;
  angle: number;
  // Ключ загруженного фото в StorageService (landing-builder-bg/<landingId>/...).
  imageKey: string | null;
  dim: number; // 0-80 %
  blur: number; // 0-20 px
}

export interface BuilderConfig {
  version: 2;
  font: string;
  accentColor: string;
  textColor: string;
  background: BuilderBackground;
  screens: BuilderScreen[];
}

export const BUILDER_CARD_STYLE: BuilderScreenStyle = {
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

export const BUILDER_PAGE_STYLE: BuilderScreenStyle = {
  ...BUILDER_CARD_STYLE,
  card: false,
  glass: false,
  shadow: 'none',
  padding: 8,
  width: 420,
  titleSize: 38,
  titleWeight: 800,
  textSize: 16,
  btnLayout: 'column',
  btnRadius: 999,
  btnHeight: 58,
  btnSize: 17,
  btnWeight: 700,
  avatarSize: 112,
};

export const BUILDER_DEFAULTS: BuilderConfig = {
  version: 2,
  font: 'system',
  accentColor: '#0A84FF',
  textColor: '#FFFFFF',
  background: { type: 'gradient', color: '#141414', from: '#5B4A9E', to: '#8A3F6E', angle: 160, imageKey: null, dim: 30, blur: 0 },
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
        { text: 'Да', style: 'filled', action: 'telegram', color: '', pulse: false },
      ],
      style: BUILDER_CARD_STYLE,
    },
  ],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function str(value: unknown, fallback: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string') return fallback;
  const t = value.slice(0, max);
  return t.trim() || allowEmpty ? t : fallback;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : fallback;
}
function optColor(value: unknown): string {
  return typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : '';
}
function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > BUILDER_LIMITS.url) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveButton(raw: unknown): BuilderButton {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const action = oneOf(b.action, ['telegram', 'next', 'url', 'none'] as const, 'telegram');
  const url = isSafeHttpUrl(b.url) ? b.url : undefined;
  return {
    text: str(b.text, 'Да', BUILDER_LIMITS.buttonText, false),
    style: oneOf(b.style, ['filled', 'outline', 'soft', 'plain'] as const, 'filled'),
    // Ссылка без адреса ведёт в Telegram — кнопка не должна оказаться мёртвой.
    action: action === 'url' && !url ? 'telegram' : action,
    ...(action === 'url' && url ? { url } : {}),
    color: optColor(b.color),
    pulse: bool(b.pulse, false),
  };
}

function resolveStyle(raw: unknown, base: BuilderScreenStyle): BuilderScreenStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    card: bool(s.card, base.card),
    cardColor: color(s.cardColor, base.cardColor),
    cardOpacity: num(s.cardOpacity, base.cardOpacity, 0, 100),
    glass: bool(s.glass, base.glass),
    shadow: oneOf(s.shadow, ['none', 'soft', 'strong'] as const, base.shadow),
    radius: num(s.radius, base.radius, 0, 48),
    padding: num(s.padding, base.padding, 0, 64),
    width: num(s.width, base.width, 220, 720),
    align: oneOf(s.align, ['center', 'left'] as const, base.align),
    titleSize: num(s.titleSize, base.titleSize, 12, 64),
    titleWeight: num(s.titleWeight, base.titleWeight, 300, 900),
    titleColor: optColor(s.titleColor),
    textSize: num(s.textSize, base.textSize, 10, 28),
    textColor: optColor(s.textColor),
    btnLayout: oneOf(s.btnLayout, ['row', 'column'] as const, base.btnLayout),
    btnRadius: num(s.btnRadius, base.btnRadius, 0, 999),
    btnHeight: num(s.btnHeight, base.btnHeight, 32, 80),
    btnSize: num(s.btnSize, base.btnSize, 11, 28),
    btnWeight: num(s.btnWeight, base.btnWeight, 300, 900),
    animation: oneOf(s.animation, ['none', 'fade', 'slide', 'zoom'] as const, base.animation),
    avatarSize: num(s.avatarSize, base.avatarSize, 32, 200),
  };
}

function resolveMedia(raw: unknown): BuilderMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!isSafeHttpUrl(m.url)) return null;
  const type = oneOf(m.type, ['image', 'video'] as const, 'image');
  return {
    type,
    url: m.url,
    poster: type === 'video' && isSafeHttpUrl(m.poster) ? m.poster : '',
    shape: oneOf(m.shape, ['circle', 'rounded', 'rect'] as const, 'rounded'),
    size: num(m.size, 240, 48, 720),
    radius: num(m.radius, 18, 0, 80),
    position: oneOf(m.position, ['top', 'middle', 'bottom'] as const, 'top'),
    autoplay: bool(m.autoplay, true),
    controls: bool(m.controls, false),
    ringColor: optColor(m.ringColor),
    ringWidth: num(m.ringWidth, 0, 0, 12),
    shadow: bool(m.shadow, false),
  };
}

function resolveScreen(raw: unknown, base: BuilderScreenStyle): BuilderScreen {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = oneOf(s.kind, ['question', 'channel', 'media'] as const, 'question');
  const buttons = (Array.isArray(s.buttons) ? s.buttons : []).slice(0, BUILDER_LIMITS.maxButtons).map(resolveButton);
  return {
    kind,
    eyebrow: str(s.eyebrow, '', BUILDER_LIMITS.eyebrow),
    title: str(s.title, kind === 'channel' ? '{channel}' : '', BUILDER_LIMITS.title),
    subtitle: str(s.subtitle, '', BUILDER_LIMITS.subtitle),
    showAvatar: bool(s.showAvatar, true),
    subscribersText: str(s.subscribersText, kind === 'channel' ? '{count} подписчиков' : '', BUILDER_LIMITS.eyebrow),
    media: resolveMedia(s.media),
    buttons,
    style: resolveStyle(s.style, base),
  };
}

export function resolveBuilderConfig(raw: unknown): BuilderConfig {
  const def = BUILDER_DEFAULTS;
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bg = (c.background && typeof c.background === 'object' ? c.background : {}) as Record<string, unknown>;

  // Первая версия: вид (card/page) и тема текста были общими для всех шагов, шрифт — Manrope.
  const legacy = c.version !== 2;
  const legacyBase = c.layout === 'page' ? BUILDER_PAGE_STYLE : BUILDER_CARD_STYLE;
  const legacyLight = c.textTheme !== 'dark';
  const legacyStyle: BuilderScreenStyle = {
    ...legacyBase,
    cardColor: legacyLight ? '#28282C' : '#FFFFFF',
    cardOpacity: 86,
  };

  const screensRaw = (Array.isArray(c.screens) ? c.screens : []).slice(0, BUILDER_LIMITS.maxScreens);
  let screens = screensRaw.map((s) => {
    if (!legacy) return resolveScreen(s, BUILDER_CARD_STYLE);
    // Старые кнопки на «окне» были текстовыми, «залитая» — жирнее; новые стили их повторяют.
    const old = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const screen = resolveScreen({ ...old, kind: 'question', style: {} }, legacyStyle);
    if (c.layout !== 'page') screen.buttons = screen.buttons.map((b) => ({ ...b, style: b.style === 'filled' ? 'plain' : b.style }));
    if (c.layout !== 'page') screen.style = { ...screen.style, btnWeight: 600 };
    return screen;
  });
  if (screens.length < BUILDER_LIMITS.minScreens) screens = def.screens;

  return {
    version: 2,
    font: legacy ? 'manrope' : typeof c.font === 'string' && c.font in BUILDER_FONTS ? c.font : def.font,
    accentColor: color(c.accentColor, def.accentColor),
    textColor: legacy ? (legacyLight ? '#FFFFFF' : '#111111') : color(c.textColor, def.textColor),
    background: {
      type: oneOf(bg.type, ['color', 'gradient', 'image'] as const, def.background.type),
      color: color(bg.color, def.background.color),
      from: color(bg.from, def.background.from),
      to: color(bg.to, def.background.to),
      angle: num(bg.angle, def.background.angle, 0, 360),
      imageKey: typeof bg.imageKey === 'string' && /^landing-builder-bg\/[A-Za-z0-9_.\-/]+$/.test(bg.imageKey) ? bg.imageKey : null,
      dim: num(bg.dim, def.background.dim, 0, 80),
      blur: num(bg.blur, def.background.blur, 0, 20),
    },
    screens,
  };
}

// Ошибка для пользователя, если конфиг явно неправильный (иначе null). Всё остальное
// resolveBuilderConfig молча приводит к допустимым значениям.
export function validateBuilderConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'Неверные настройки конструктора';
  if (JSON.stringify(raw).length > BUILDER_LIMITS.maxJsonBytes) return 'Слишком большие настройки конструктора';
  const screens = (raw as { screens?: unknown }).screens;
  if (!Array.isArray(screens) || screens.length < BUILDER_LIMITS.minScreens) return 'Добавьте хотя бы один шаг';
  if (screens.length > BUILDER_LIMITS.maxScreens) return `Не больше ${BUILDER_LIMITS.maxScreens} шагов`;
  for (const [i, s] of screens.entries()) {
    const buttons = (s as { buttons?: unknown })?.buttons;
    if (Array.isArray(buttons) && buttons.length > BUILDER_LIMITS.maxButtons) return `Шаг ${i + 1}: не больше ${BUILDER_LIMITS.maxButtons} кнопок`;
    for (const b of Array.isArray(buttons) ? buttons : []) {
      const btn = b as { action?: unknown; url?: unknown };
      if (btn?.action === 'url' && !isSafeHttpUrl(btn.url)) return `Шаг ${i + 1}: ссылка кнопки должна начинаться с https://`;
    }
    const media = (s as { media?: { url?: unknown } | null })?.media;
    if (media && !isSafeHttpUrl(media.url)) return `Шаг ${i + 1}: у фото/видео неверная ссылка`;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
// Текст на залитой кнопке — белый или почти чёрный, смотря что читается на её цвете.
function readableOn(hex: string): string {
  const lum = hexToRgb(hex)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  return lum > 0.45 ? '#111111' : '#FFFFFF';
}

export interface BuilderRenderOptions {
  // Готовый URL фото фона (публичный эндпоинт лендинга или blob: в живом превью редактора).
  imageUrl: string | null;
  // Аватар канала/лендинга для карточек канала (публичный эндпоинт или blob: в превью).
  avatarUrl?: string | null;
  channelTitle?: string;
  subscribersCount?: string;
  // Какой шаг показать первым (только живое превью редактора).
  startScreen?: number;
}

// Значение уходит в url('...') внутри style="" — допускаем только безопасные символы.
function safeAssetUrl(url: string | null | undefined): string | null {
  return url && /^(https?:|blob:)[A-Za-z0-9:/._?=&%~-]+$/.test(url) ? url : null;
}

// Число подписчиков из templateData хранится как есть («14200») — показываем с разделителями.
function formatCount(raw: string | undefined): string {
  const v = (raw || '').trim();
  return /^\d+$/.test(v) ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : v;
}

function fillPlaceholders(text: string, options: BuilderRenderOptions): string {
  return text.replace(/\{channel\}/g, options.channelTitle || '').replace(/\{count\}/g, formatCount(options.subscribersCount));
}

function buttonHtml(button: BuilderButton, isLastScreen: boolean, accent: string, iosRow: boolean): string {
  const label = escapeHtml(button.text);
  const base = button.color || accent;
  const vars = `--btn:${base};--btn-on:${readableOn(base)};--btn-soft:${rgba(base, 0.16)}`;
  const cls = `b-btn b-btn--${button.style}${button.pulse ? ' b-btn--pulse' : ''}${iosRow ? ' b-btn--ios' : ''}`;
  // «Следующий шаг» на последнем шаге ведёт туда же, куда и кнопка в Telegram.
  const action = button.action === 'next' && isLastScreen ? 'telegram' : button.action;
  switch (action) {
    case 'telegram':
      return `<a class="${cls}" style="${vars}" href="{{TG_REDIRECT_URL}}" data-track="Lead">${label}</a>`;
    case 'url':
      return `<a class="${cls}" style="${vars}" href="${escapeHtml(button.url!)}" rel="noopener">${label}</a>`;
    case 'next':
      return `<button type="button" class="${cls}" style="${vars}" data-b-next>${label}</button>`;
    default:
      return `<button type="button" class="${cls}" style="${vars}">${label}</button>`;
  }
}

function mediaHtml(media: BuilderMedia, accent: string): string {
  const url = escapeHtml(media.url);
  const ring = media.ringWidth > 0 ? `box-shadow:0 0 0 ${media.ringWidth}px ${media.ringColor || accent}${media.shadow ? ',0 18px 40px -12px rgba(0,0,0,.6)' : ''};` : media.shadow ? 'box-shadow:0 18px 40px -12px rgba(0,0,0,.6);' : '';
  const radius = media.shape === 'circle' ? '50%' : media.shape === 'rounded' ? `${media.radius}px` : '0';
  const box = `width:${media.size}px;border-radius:${radius};${ring}${media.shape === 'circle' ? 'aspect-ratio:1/1;' : ''}`;
  let inner: string;
  if (media.type === 'video') {
    const poster = media.poster ? ` poster="${escapeHtml(media.poster)}"` : '';
    // Автозапуск в мобильных браузерах возможен только без звука — звук включается нажатием.
    const auto = media.autoplay ? ' autoplay muted loop data-b-sound' : '';
    inner = `<video src="${url}"${poster} playsinline webkit-playsinline preload="metadata"${auto}${media.controls ? ' controls' : ''}></video>${
      media.autoplay && !media.controls ? '<span class="b-media__sound" aria-hidden="true">🔇</span>' : ''
    }`;
  } else {
    inner = `<img src="${url}" alt="" loading="lazy">`;
  }
  return `<div class="b-media b-media--${media.shape}" style="${box}">${inner}</div>`;
}

function screenHtml(screen: BuilderScreen, index: number, total: number, config: BuilderConfig, options: BuilderRenderOptions, visible: boolean): string {
  const st = screen.style;
  const text = st.titleColor || config.textColor;
  const muted = st.textColor || rgba(config.textColor, 0.66);
  const line = rgba(st.card ? st.titleColor || config.textColor : config.textColor, 0.18);
  const cardBg = st.card ? rgba(st.cardColor, st.cardOpacity / 100) : 'transparent';
  const vars = [
    `--s-card:${cardBg}`,
    `--s-radius:${st.radius}px`,
    `--s-pad:${st.padding}px`,
    `--s-width:${st.width}px`,
    `--s-title-size:${st.titleSize}px`,
    `--s-title-weight:${st.titleWeight}`,
    `--s-title:${text}`,
    `--s-text-size:${st.textSize}px`,
    `--s-muted:${muted}`,
    `--s-line:${line}`,
    `--s-btn-radius:${st.btnRadius}px`,
    `--s-btn-height:${st.btnHeight}px`,
    `--s-btn-size:${st.btnSize}px`,
    `--s-btn-weight:${st.btnWeight}`,
    `--s-avatar:${st.avatarSize}px`,
    `--s-align:${st.align}`,
  ].join(';');
  const classes = [
    'b-screen',
    st.card ? 'b-screen--card' : 'b-screen--page',
    st.glass && st.card ? 'b-screen--glass' : '',
    `b-shadow--${st.card ? st.shadow : 'none'}`,
    `b-anim--${st.animation}`,
    `b-align--${st.align}`,
  ]
    .filter(Boolean)
    .join(' ');

  const last = index === total - 1;
  // «Окно в стиле iOS»: попап, кнопки в ряд и все текстовые — кнопки во всю ширину с линиями.
  const ios = st.card && st.btnLayout === 'row' && screen.buttons.length > 0 && screen.buttons.every((b) => b.style === 'plain');
  const buttons = screen.buttons.map((b) => buttonHtml(b, last, config.accentColor, ios)).join('');
  const actionsCls = `b-actions b-actions--${st.btnLayout}${ios ? ' b-actions--ios' : ''}`;

  const eyebrow = screen.eyebrow ? `<div class="b-eyebrow"><span>${escapeHtml(fillPlaceholders(screen.eyebrow, options))}</span></div>` : '';
  const title = screen.title ? `<h1 class="b-title">${escapeHtml(fillPlaceholders(screen.title, options))}</h1>` : '';
  const subtitle = screen.subtitle
    ? `<p class="b-subtitle">${escapeHtml(fillPlaceholders(screen.subtitle, options)).replace(/\n/g, '<br>')}</p>`
    : '';

  let head = '';
  if (screen.kind === 'channel') {
    const avatarUrl = safeAssetUrl(options.avatarUrl ?? null);
    const initial = escapeHtml((options.channelTitle || 'C').trim().charAt(0).toUpperCase() || 'C');
    // Буква-заглушка лежит под картинкой: если фото не загрузится, картинка скрывается и видна буква.
    const avatar = screen.showAvatar
      ? `<div class="b-avatar b-avatar--initial" style="--btn:${config.accentColor}">${initial}${
          avatarUrl ? `<img src="${avatarUrl.replace(/&/g, '&amp;')}" alt="" onerror="this.remove()">` : ''
        }</div>`
      : '';
    const subs = screen.subscribersText ? `<div class="b-subs">${escapeHtml(fillPlaceholders(screen.subscribersText, options))}</div>` : '';
    head = `${avatar}${eyebrow}${title}${subs}`;
  } else {
    head = `${eyebrow}${title}`;
  }

  const media = screen.media ? mediaHtml(screen.media, config.accentColor) : '';
  const pos = screen.media?.position ?? 'top';
  const body =
    pos === 'top' ? `${media}${head}${subtitle}` : pos === 'middle' ? `${head}${media}${subtitle}` : `${head}${subtitle}${media}`;

  return `<section class="${classes}" style="${vars}"${visible ? '' : ' hidden'} data-b-screen="${index}">
  <div class="b-body">${body}</div>
  ${buttons ? `<div class="${actionsCls}">${buttons}</div>` : ''}
</section>`;
}

export function buildBuilderVars(raw: unknown, options: BuilderRenderOptions): Record<string, string> {
  const config = resolveBuilderConfig(raw);
  const bg = config.background;

  const imageUrl = safeAssetUrl(options.imageUrl);
  let background: string;
  if (bg.type === 'image' && imageUrl) {
    background = `${bg.color} url('${imageUrl.replace(/&/g, '&amp;')}') center / cover no-repeat`;
  } else if (bg.type === 'gradient' || (bg.type === 'image' && !imageUrl)) {
    background = `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
  } else {
    background = bg.color;
  }
  const imageActive = bg.type === 'image' && !!imageUrl;

  const cssVars = [
    `--b-bg: ${background}`,
    `--b-dim: ${imageActive ? bg.dim / 100 : 0}`,
    `--b-blur: ${imageActive ? bg.blur : 0}px`,
    `--b-font: ${BUILDER_FONTS[config.font] ?? BUILDER_FONTS.system}`,
    `--b-text: ${config.textColor}`,
  ].join('; ');

  const total = config.screens.length;
  const start = Math.min(Math.max(options.startScreen ?? 0, 0), total - 1);
  const screens = config.screens.map((screen, i) => screenHtml(screen, i, total, config, options, i === start)).join('\n');
  const firstTitle = fillPlaceholders(config.screens[0].title, options) || options.channelTitle || '';

  return {
    BUILDER_STYLE_VARS: cssVars,
    BUILDER_SCREENS: screens,
    BUILDER_TITLE: escapeHtml(firstTitle),
    BUILDER_THEME_COLOR: bg.type === 'color' ? bg.color : bg.from,
    BUILDER_FONT_LINK:
      config.font === 'manrope'
        ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">'
        : '',
  };
}
