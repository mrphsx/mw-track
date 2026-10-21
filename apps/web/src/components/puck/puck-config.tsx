'use client';

// Набор блоков визуального редактора лендингов (Puck, запрос пользователя 2026-10-21: «настрой его
// под нас максимально»). Один и тот же конфиг рендерит страницу и в редакторе, и в готовый HTML
// (см. puck-export.tsx) — разница только в metadata.mode:
//  - 'edit'   — реальные название/аватар канала, попапы и шаги показаны прямо в потоке страницы,
//               скрытые на устройстве блоки — полупрозрачные, кнопки никуда не ведут;
//  - 'export' — вместо данных канала плейсхолдеры {{CHANNEL_TITLE}}/{{CHANNEL_AVATAR}}/{{PUCK_SUBSCRIBERS}}, кнопка
//               «в канал» ведёт на {{TG_REDIRECT_URL}} с data-track="Lead"; сервер подставляет
//               значения при показе лендинга, как у обычных шаблонов.
// Поведение (шаги, попапы, таймер) живёт в скрипте templates/puck/template.html и опирается на
// атрибуты data-pk-*.

import type { ComponentConfig, Config, Slot } from '@puckeditor/core';
import type { CSSProperties, ReactNode } from 'react';
import { BASE_CSS, FONTS, SHADOWS, fontCss, fontHref, isSafeUrl, withAlpha } from './puck-styles';
import { AssetUploader, ImageUploader, colorField, imageField, num, radio, select, text, textarea, videoField, yesNo } from './puck-fields';

export interface PuckMeta {
  mode?: 'edit' | 'export';
  channel?: { title: string; avatarUrl: string | null; subscribers: string };
}

interface PuckCtx {
  metadata?: unknown;
}
const metaOf = (puck: PuckCtx | undefined): PuckMeta => (puck?.metadata ?? {}) as PuckMeta;
const isExport = (puck: PuckCtx | undefined) => metaOf(puck).mode === 'export';

// ---- Общие настройки блока: отступы, видимость, анимация ----

interface BoxProps {
  mt: number;
  mb: number;
  hideOn: 'none' | 'mobile' | 'desktop';
  anim: 'none' | 'fade' | 'up' | 'zoom' | 'left' | 'shake';
  animDelay: number;
}

const BOX_DEFAULTS: BoxProps = { mt: 0, mb: 0, hideOn: 'none', anim: 'none', animDelay: 0 };

const boxFields = {
  mt: num('Отступ сверху, px', 0, 300),
  mb: num('Отступ снизу, px', 0, 300),
  hideOn: select('Показывать', { none: 'Везде', mobile: 'Только на компьютере', desktop: 'Только на телефоне' }),
  anim: select('Анимация появления', { none: 'Нет', fade: 'Проявление', up: 'Снизу вверх', zoom: 'Увеличение', left: 'Слева', shake: 'Покачивание (повтор)' }),
  animDelay: num('Задержка анимации, сек', 0, 10, 0.1),
};

function boxClass(p: Partial<BoxProps>, editing: boolean): string {
  const c: string[] = [];
  if (p.hideOn === 'mobile') c.push(editing ? 'pk-ghost-m' : 'pk-hide-m');
  if (p.hideOn === 'desktop') c.push(editing ? 'pk-ghost-d' : 'pk-hide-d');
  if (p.anim && p.anim !== 'none') c.push(`pk-a-${p.anim}`);
  return c.join(' ');
}

function boxStyle(p: Partial<BoxProps>): CSSProperties {
  return {
    marginTop: p.mt || undefined,
    marginBottom: p.mb || undefined,
    animationDelay: p.animDelay ? `${p.animDelay}s` : undefined,
  };
}

const ALIGN = { left: 'Слева', center: 'По центру', right: 'Справа' } as const;
type Align = keyof typeof ALIGN;
const flexAlign = (a: Align | undefined) => (a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center');

const FONT_OPTIONS = { inherit: 'Как у страницы', ...Object.fromEntries(FONTS.map((f) => [f.value, f.label])) } as Record<string, string>;
const WEIGHTS = { '400': 'Обычный', '500': 'Средний', '600': 'Полужирный', '700': 'Жирный', '800': 'Очень жирный', '900': 'Чёрный' };

function FontLink({ font }: { font?: string }) {
  const href = fontHref(font);
  return href ? <link rel="stylesheet" href={href} /> : null;
}

function sizeVars(size: number | undefined, sizeMobile: number | undefined): CSSProperties {
  return { ['--fs' as string]: `${size || 16}px`, ['--fs-m' as string]: sizeMobile ? `${sizeMobile}px` : undefined } as CSSProperties;
}

// Подпись над блоком-контейнером в редакторе (шаг, попап) — на готовой странице её нет.
function EditorTag({ children, color = '#2563eb' }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ position: 'absolute', top: -11, left: 10, zIndex: 5, background: color, color: '#fff', font: '600 11px/1 system-ui, sans-serif', padding: '5px 8px', borderRadius: 6, letterSpacing: 0.2 }}>
      {children}
    </div>
  );
}

// ---- Действие кнопки/картинки ----

type Action = 'telegram' | 'next' | 'close' | 'url' | 'none';
const ACTIONS: Record<Action, string> = {
  telegram: 'В канал (основная цель)',
  next: 'Следующий шаг',
  close: 'Закрыть попап',
  url: 'Открыть ссылку',
  none: 'Ничего',
};

function actionAttrs(action: Action, url: string | undefined, newTab: boolean | undefined, exporting: boolean): Record<string, string | undefined> {
  if (!exporting) return {};
  if (action === 'telegram') return { href: '{{TG_REDIRECT_URL}}', 'data-track': 'Lead' };
  if (action === 'next' || action === 'close') return { href: '#', 'data-pk-action': action };
  if (action === 'url' && isSafeUrl(url)) return { href: url!.trim(), ...(newTab ? { target: '_blank', rel: 'noopener' } : {}) };
  return {};
}

// ---- Блоки ----

export interface SectionProps extends BoxProps {
  content: Slot;
  bgType: 'none' | 'color' | 'gradient' | 'image';
  bgColor: string;
  gradFrom: string;
  gradTo: string;
  gradAngle: number;
  bgImage: string;
  overlayColor: string;
  overlay: number;
  fullHeight: boolean;
  vAlign: 'start' | 'center' | 'end';
  padY: number;
  padYMobile: number;
  padX: number;
  width: number;
  textAlign: Align;
  textColor: string;
  gap: number;
}

function backgroundOf(p: { bgType: string; bgColor: string; gradFrom: string; gradTo: string; gradAngle: number; bgImage: string; overlayColor?: string; overlay?: number }): CSSProperties {
  if (p.bgType === 'color') return { background: p.bgColor || 'transparent' };
  if (p.bgType === 'gradient') return { background: `linear-gradient(${p.gradAngle ?? 180}deg, ${p.gradFrom || '#000'}, ${p.gradTo || '#333'})` };
  if (p.bgType === 'image' && p.bgImage) {
    const shade = withAlpha(p.overlayColor || '#000000', p.overlay ?? 0);
    return { backgroundImage: `linear-gradient(${shade}, ${shade}), url("${p.bgImage.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return {};
}

const bgFields = (upload?: ImageUploader) => ({
  bgType: select('Фон', { none: 'Без фона', color: 'Цвет', gradient: 'Градиент', image: 'Картинка' }),
  bgColor: colorField('Цвет фона'),
  gradFrom: colorField('Градиент: от', false),
  gradTo: colorField('Градиент: до', false),
  gradAngle: num('Угол градиента, °', 0, 360),
  bgImage: imageField('Картинка фона', upload),
  overlayColor: colorField('Затемнение: цвет', false),
  overlay: num('Затемнение картинки, %', 0, 95),
});

function bgVisible(type: string, field: string): boolean {
  if (field === 'bgColor') return type === 'color';
  if (field === 'gradFrom' || field === 'gradTo' || field === 'gradAngle') return type === 'gradient';
  if (field === 'bgImage' || field === 'overlayColor' || field === 'overlay') return type === 'image';
  return true;
}

function filterBgFields<F extends Record<string, unknown>>(fields: F, bgType: string): F {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => bgVisible(bgType, k))) as F;
}

export interface ColumnsProps extends BoxProps {
  count: '2' | '3';
  ratio: '1-1' | '1-2' | '2-1' | '1-3' | '3-1';
  gap: number;
  stack: boolean;
  vAlign: 'start' | 'center' | 'end' | 'stretch';
  col1: Slot;
  col2: Slot;
  col3: Slot;
}

export interface CardProps extends BoxProps {
  content: Slot;
  bg: string;
  bgOpacity: number;
  glass: boolean;
  radius: number;
  pad: number;
  padMobile: number;
  shadow: keyof typeof SHADOWS;
  borderColor: string;
  borderWidth: number;
  maxWidth: number;
  align: Align;
  textAlign: Align;
  textColor: string;
  gap: number;
}

export interface StepProps extends BoxProps {
  content: Slot;
  name: string;
  fullHeight: boolean;
  vAlign: 'start' | 'center' | 'end';
  gap: number;
}

export interface PopupProps {
  content: Slot;
  delay: number;
  dismissible: boolean;
  showClose: boolean;
  position: 'center' | 'bottom';
  overlayColor: string;
  overlay: number;
  blur: number;
  bg: string;
  textColor: string;
  radius: number;
  pad: number;
  maxWidth: number;
  textAlign: Align;
  gap: number;
}

export interface HeadingProps extends BoxProps {
  text: string;
  level: 'h1' | 'h2' | 'h3';
  size: number;
  sizeMobile: number;
  weight: keyof typeof WEIGHTS;
  color: string;
  align: Align;
  font: string;
  lineHeight: number;
  letterSpacing: number;
  uppercase: boolean;
  italic: boolean;
  shadow: boolean;
}

export interface TextProps extends BoxProps {
  text: ReactNode;
  size: number;
  sizeMobile: number;
  weight: keyof typeof WEIGHTS;
  color: string;
  align: Align;
  font: string;
  lineHeight: number;
  maxWidth: number;
}

export interface ButtonProps extends BoxProps {
  text: string;
  icon: string;
  action: Action;
  url: string;
  newTab: boolean;
  variant: 'filled' | 'outline' | 'soft' | 'text';
  bg: string;
  color: string;
  size: number;
  weight: keyof typeof WEIGHTS;
  radius: number;
  height: number;
  padX: number;
  fullWidth: boolean;
  maxWidth: number;
  align: Align;
  pulse: boolean;
  shine: boolean;
  shadow: keyof typeof SHADOWS;
  font: string;
  uppercase: boolean;
}

export interface ImageProps extends BoxProps {
  src: string;
  alt: string;
  width: number;
  maxWidth: number;
  ratio: 'auto' | '1/1' | '4/3' | '3/4' | '16/9' | '9/16';
  fit: 'cover' | 'contain';
  radius: number;
  shadow: keyof typeof SHADOWS;
  align: Align;
  action: Action;
  url: string;
}

export interface ListProps extends BoxProps {
  items: { icon: string; text: string }[];
  size: number;
  color: string;
  iconSize: number;
  gap: number;
  align: 'left' | 'center';
  itemBg: string;
  itemRadius: number;
}

export interface BadgeProps extends BoxProps {
  text: string;
  bg: string;
  color: string;
  size: number;
  radius: number;
  align: Align;
  uppercase: boolean;
  pulse: boolean;
}

export interface TimerProps extends BoxProps {
  minutes: number;
  label: string;
  size: number;
  color: string;
  labelColor: string;
  bg: string;
  radius: number;
  align: Align;
  layout: 'column' | 'row';
}

export interface ChannelProps extends BoxProps {
  layout: 'column' | 'row';
  align: Align;
  showAvatar: boolean;
  avatarSize: number;
  avatarRadius: number;
  ringColor: string;
  ringWidth: number;
  showTitle: boolean;
  title: string;
  titleSize: number;
  titleWeight: keyof typeof WEIGHTS;
  titleColor: string;
  verified: boolean;
  showSubs: boolean;
  subsText: string;
  subsSize: number;
  subsColor: string;
}

export interface VideoProps extends BoxProps {
  url: string;
  ratio: '16/9' | '9/16' | '1/1' | '4/5';
  radius: number;
  autoplay: boolean;
  controls: boolean;
}

export interface SpacerProps {
  height: number;
  heightMobile: number;
}

export interface DividerProps extends BoxProps {
  color: string;
  thickness: number;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
  align: Align;
}

export interface HtmlProps extends BoxProps {
  code: string;
  previewHeight: number;
}

export interface RootProps {
  title: string;
  font: string;
  textColor: string;
  accent: string;
  bgType: 'color' | 'gradient' | 'image';
  bgColor: string;
  gradFrom: string;
  gradTo: string;
  gradAngle: number;
  bgImage: string;
  overlayColor: string;
  overlay: number;
  center: boolean;
}

type Components = {
  Section: SectionProps;
  Columns: ColumnsProps;
  Card: CardProps;
  Step: StepProps;
  Popup: PopupProps;
  Spacer: SpacerProps;
  Divider: DividerProps;
  Heading: HeadingProps;
  Text: TextProps;
  Image: ImageProps;
  List: ListProps;
  Video: VideoProps;
  HtmlCode: HtmlProps;
  Channel: ChannelProps;
  Button: ButtonProps;
  Timer: TimerProps;
  Badge: BadgeProps;
};

export type PuckLandingConfig = Config<Components, RootProps>;

function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/.exec(url);
  return m ? m[1] : null;
}

function formatTimer(minutes: number): string {
  const total = Math.max(0, Math.round((minutes || 0) * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${h > 0 ? `${p(h)}:` : ''}${p(m)}:${p(s)}`;
}

export function buildPuckConfig({ uploadAsset }: { uploadAsset?: AssetUploader } = {}): PuckLandingConfig {
  const upload: ImageUploader | undefined = uploadAsset ? async (file) => (await uploadAsset(file)).url : undefined;
  const Section: ComponentConfig<SectionProps> = {
    label: 'Секция',
    fields: {
      content: { type: 'slot', label: 'Содержимое' },
      ...bgFields(upload),
      fullHeight: yesNo('На весь экран по высоте'),
      vAlign: radio('Содержимое по вертикали', { start: 'Сверху', center: 'По центру', end: 'Снизу' }),
      width: num('Ширина содержимого, px', 240, 1600),
      padY: num('Отступ внутри сверху/снизу, px', 0, 300),
      padYMobile: num('…на телефоне, px (0 — как выше)', 0, 300),
      padX: num('Отступ внутри по бокам, px', 0, 200),
      gap: num('Расстояние между блоками, px', 0, 120),
      textAlign: radio('Выравнивание текста', ALIGN),
      textColor: colorField('Цвет текста'),
      ...boxFields,
    },
    defaultProps: {
      content: [],
      bgType: 'none',
      bgColor: '#FFFFFF',
      gradFrom: '#1E3A8A',
      gradTo: '#7C3AED',
      gradAngle: 160,
      bgImage: '',
      overlayColor: '#000000',
      overlay: 40,
      fullHeight: false,
      vAlign: 'center',
      width: 520,
      padY: 32,
      padYMobile: 0,
      padX: 16,
      gap: 14,
      textAlign: 'center',
      textColor: '',
      ...BOX_DEFAULTS,
    },
    resolveFields: (data, { fields }) => filterBgFields(fields, data.props.bgType),
    render: ({ content: Content, puck, ...p }) => (
      <section
        className={`pk-pad ${boxClass(p, !isExport(puck))}`}
        style={{
          ...backgroundOf(p),
          ...boxStyle(p),
          color: p.textColor || undefined,
          textAlign: p.textAlign,
          minHeight: p.fullHeight ? '100dvh' : undefined,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: p.vAlign === 'start' ? 'flex-start' : p.vAlign === 'end' ? 'flex-end' : 'center',
          ['--pad' as string]: `${p.padY}px ${p.padX}px`,
          ['--pad-m' as string]: p.padYMobile ? `${p.padYMobile}px ${p.padX}px` : undefined,
          padding: `${p.padY}px ${p.padX}px`,
        }}
      >
        <Content
          style={{ width: '100%', maxWidth: p.width, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: p.gap }}
          minEmptyHeight={80}
        />
      </section>
    ),
  };

  const Columns: ComponentConfig<ColumnsProps> = {
    label: 'Колонки',
    fields: {
      count: radio('Колонок', { '2': 'Две', '3': 'Три' }),
      ratio: select('Пропорции (для двух)', { '1-1': '1 : 1', '1-2': '1 : 2', '2-1': '2 : 1', '1-3': '1 : 3', '3-1': '3 : 1' }),
      gap: num('Расстояние, px', 0, 120),
      stack: yesNo('На телефоне — одна под другой'),
      vAlign: select('По вертикали', { start: 'Сверху', center: 'По центру', end: 'Снизу', stretch: 'Растянуть' }),
      col1: { type: 'slot', label: 'Колонка 1' },
      col2: { type: 'slot', label: 'Колонка 2' },
      col3: { type: 'slot', label: 'Колонка 3' },
      ...boxFields,
    },
    defaultProps: { count: '2', ratio: '1-1', gap: 20, stack: true, vAlign: 'center', col1: [], col2: [], col3: [], ...BOX_DEFAULTS },
    resolveFields: (data, { fields }) => {
      const f = { ...fields } as Record<string, unknown>;
      if (data.props.count === '3') delete f.ratio;
      else delete f.col3;
      return f as typeof fields;
    },
    render: ({ col1: C1, col2: C2, col3: C3, puck, ...p }) => {
      const [a, b] = p.ratio.split('-');
      const template = p.count === '3' ? '1fr 1fr 1fr' : `${a}fr ${b}fr`;
      const colStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 };
      return (
        <div
          className={`pk-cols ${p.stack ? 'pk-stack' : ''} ${boxClass(p, !isExport(puck))}`}
          style={{ ...boxStyle(p), gridTemplateColumns: template, gap: p.gap, alignItems: p.vAlign }}
        >
          <C1 style={colStyle} minEmptyHeight={60} />
          <C2 style={colStyle} minEmptyHeight={60} />
          {p.count === '3' && <C3 style={colStyle} minEmptyHeight={60} />}
        </div>
      );
    },
  };

  const Card: ComponentConfig<CardProps> = {
    label: 'Карточка',
    fields: {
      content: { type: 'slot', label: 'Содержимое' },
      bg: colorField('Цвет карточки'),
      bgOpacity: num('Непрозрачность, %', 0, 100),
      glass: yesNo('Размытие фона под карточкой (стекло)'),
      radius: num('Скругление углов, px', 0, 60),
      pad: num('Отступ внутри, px', 0, 80),
      padMobile: num('…на телефоне, px (0 — как выше)', 0, 80),
      shadow: select('Тень', { none: 'Нет', soft: 'Мягкая', strong: 'Сильная', glow: 'Свечение' }),
      borderColor: colorField('Цвет рамки'),
      borderWidth: num('Толщина рамки, px', 0, 10),
      maxWidth: num('Максимальная ширина, px', 200, 1200),
      align: radio('Положение', ALIGN),
      textAlign: radio('Выравнивание текста', ALIGN),
      textColor: colorField('Цвет текста'),
      gap: num('Расстояние между блоками, px', 0, 80),
      ...boxFields,
    },
    defaultProps: {
      content: [],
      bg: '#1E1E1E',
      bgOpacity: 100,
      glass: false,
      radius: 22,
      pad: 24,
      padMobile: 0,
      shadow: 'soft',
      borderColor: '',
      borderWidth: 0,
      maxWidth: 380,
      align: 'center',
      textAlign: 'center',
      textColor: '#FFFFFF',
      gap: 12,
      ...BOX_DEFAULTS,
    },
    render: ({ content: Content, puck, ...p }) => (
      <div
        className={`pk-pad ${boxClass(p, !isExport(puck))}`}
        style={{
          ...boxStyle(p),
          width: '100%',
          maxWidth: p.maxWidth,
          marginLeft: p.align === 'left' ? 0 : 'auto',
          marginRight: p.align === 'right' ? 0 : 'auto',
          background: withAlpha(p.bg, p.bgOpacity),
          backdropFilter: p.glass ? 'blur(18px) saturate(1.4)' : undefined,
          WebkitBackdropFilter: p.glass ? 'blur(18px) saturate(1.4)' : undefined,
          borderRadius: p.radius,
          boxShadow: SHADOWS[p.shadow] ?? 'none',
          border: p.borderWidth && p.borderColor ? `${p.borderWidth}px solid ${p.borderColor}` : undefined,
          color: p.textColor || undefined,
          textAlign: p.textAlign,
          ['--pad' as string]: `${p.pad}px`,
          ['--pad-m' as string]: p.padMobile ? `${p.padMobile}px` : undefined,
          padding: p.pad,
        }}
      >
        <Content style={{ display: 'flex', flexDirection: 'column', gap: p.gap }} minEmptyHeight={60} />
      </div>
    ),
  };

  const Step: ComponentConfig<StepProps> = {
    label: 'Шаг',
    fields: {
      name: text('Название шага (видно только вам)'),
      content: { type: 'slot', label: 'Содержимое' },
      fullHeight: yesNo('На весь экран по высоте'),
      vAlign: radio('По вертикали', { start: 'Сверху', center: 'По центру', end: 'Снизу' }),
      gap: num('Расстояние между блоками, px', 0, 80),
      ...boxFields,
    },
    defaultProps: { name: '', content: [], fullHeight: true, vAlign: 'center', gap: 14, ...BOX_DEFAULTS },
    render: ({ content: Content, puck, ...p }) => {
      const exporting = isExport(puck);
      const body = (
        <Content
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: p.gap,
            minHeight: p.fullHeight ? (exporting ? '100dvh' : 480) : undefined,
            justifyContent: p.vAlign === 'start' ? 'flex-start' : p.vAlign === 'end' ? 'flex-end' : 'center',
            padding: '16px',
          }}
          minEmptyHeight={120}
        />
      );
      if (exporting) {
        return (
          <div data-pk-step="" className={boxClass(p, false)} style={boxStyle(p)}>
            {body}
          </div>
        );
      }
      return (
        <div className={boxClass(p, true)} style={{ ...boxStyle(p), position: 'relative', outline: '2px dashed rgba(37,99,235,.55)', outlineOffset: -2, marginBottom: 18 }}>
          <EditorTag>Шаг{p.name ? ` · ${p.name}` : ''} — посетитель видит шаги по одному</EditorTag>
          {body}
        </div>
      );
    },
  };

  const Popup: ComponentConfig<PopupProps> = {
    label: 'Попап',
    fields: {
      content: { type: 'slot', label: 'Содержимое' },
      delay: num('Показать через, сек (0 — сразу)', 0, 120),
      position: radio('Где', { center: 'По центру', bottom: 'Снизу' }),
      showClose: yesNo('Крестик закрытия'),
      dismissible: yesNo('Закрывать кликом по фону'),
      overlayColor: colorField('Фон за попапом', false),
      overlay: num('Затемнение фона, %', 0, 100),
      blur: num('Размытие страницы за попапом, px', 0, 30),
      bg: colorField('Цвет окна'),
      textColor: colorField('Цвет текста'),
      radius: num('Скругление, px', 0, 60),
      pad: num('Отступ внутри, px', 0, 80),
      maxWidth: num('Ширина окна, px', 200, 900),
      textAlign: radio('Выравнивание текста', ALIGN),
      gap: num('Расстояние между блоками, px', 0, 80),
    },
    defaultProps: {
      content: [],
      delay: 0,
      position: 'center',
      showClose: false,
      dismissible: false,
      overlayColor: '#000000',
      overlay: 55,
      blur: 6,
      bg: '#FFFFFF',
      textColor: '#111111',
      radius: 20,
      pad: 22,
      maxWidth: 340,
      textAlign: 'center',
      gap: 12,
    },
    render: ({ content: Content, puck, ...p }) => {
      const exporting = isExport(puck);
      const card = (
        <div
          className={`pk-popup-card ${exporting ? (p.position === 'bottom' ? 'pk-a-up' : 'pk-a-zoom') : ''}`}
          style={{
            maxWidth: p.maxWidth,
            background: p.bg || '#fff',
            color: p.textColor || undefined,
            borderRadius: p.position === 'bottom' ? `${p.radius}px ${p.radius}px 0 0` : p.radius,
            padding: p.pad,
            paddingTop: p.showClose ? Math.max(p.pad, 34) : p.pad,
            textAlign: p.textAlign,
            boxShadow: SHADOWS.strong,
            margin: p.position === 'bottom' ? 'auto auto 0' : 'auto',
          }}
        >
          {p.showClose &&
            (exporting ? (
              <a href="#" data-pk-action="close" className="pk-popup-x" aria-label="Закрыть">
                ×
              </a>
            ) : (
              <span className="pk-popup-x">×</span>
            ))}
          <Content style={{ display: 'flex', flexDirection: 'column', gap: p.gap }} minEmptyHeight={60} />
        </div>
      );
      const overlayStyle: CSSProperties = {
        background: withAlpha(p.overlayColor || '#000000', p.overlay),
        backdropFilter: p.blur ? `blur(${p.blur}px)` : undefined,
        WebkitBackdropFilter: p.blur ? `blur(${p.blur}px)` : undefined,
        alignItems: p.position === 'bottom' ? 'flex-end' : 'center',
        padding: p.position === 'bottom' ? 0 : 16,
      };
      if (exporting) {
        return (
          <div className="pk-popup" data-pk-popup="" data-pk-delay={p.delay || 0} data-pk-dismiss={p.dismissible ? '1' : '0'} style={overlayStyle}>
            {card}
          </div>
        );
      }
      return (
        <div style={{ ...overlayStyle, position: 'relative', display: 'flex', justifyContent: 'center', padding: '28px 12px', margin: '14px 0', outline: '2px dashed rgba(219,39,119,.6)', outlineOffset: -2 }}>
          <EditorTag color="#db2777">Попап — {p.delay ? `появится через ${p.delay} сек` : 'сразу при открытии'}, поверх страницы</EditorTag>
          {card}
        </div>
      );
    },
  };

  const Spacer: ComponentConfig<SpacerProps> = {
    label: 'Отступ',
    fields: { height: num('Высота, px', 0, 400), heightMobile: num('…на телефоне, px (0 — как выше)', 0, 400) },
    defaultProps: { height: 32, heightMobile: 0 },
    render: ({ height, heightMobile }) => (
      <div
        className="pk-pad"
        aria-hidden="true"
        style={{ ['--pad' as string]: `${height / 2}px 0`, ['--pad-m' as string]: heightMobile ? `${heightMobile / 2}px 0` : undefined, padding: `${height / 2}px 0` }}
      />
    ),
  };

  const Divider: ComponentConfig<DividerProps> = {
    label: 'Линия',
    fields: {
      color: colorField('Цвет', false),
      thickness: num('Толщина, px', 1, 12),
      width: num('Ширина, %', 5, 100),
      style: radio('Вид', { solid: 'Сплошная', dashed: 'Штрихи', dotted: 'Точки' }),
      align: radio('Положение', ALIGN),
      ...boxFields,
    },
    defaultProps: { color: '#D4D4D8', thickness: 1, width: 100, style: 'solid', align: 'center', ...BOX_DEFAULTS, mt: 8, mb: 8 },
    render: ({ puck, ...p }) => (
      <div className={boxClass(p, !isExport(puck))} style={{ ...boxStyle(p), display: 'flex', justifyContent: flexAlign(p.align) }}>
        <div style={{ width: `${p.width}%`, borderTop: `${p.thickness}px ${p.style} ${p.color}` }} />
      </div>
    ),
  };

  const Heading: ComponentConfig<HeadingProps> = {
    label: 'Заголовок',
    fields: {
      text: textarea('Текст'),
      level: radio('Уровень', { h1: 'Главный', h2: 'Второй', h3: 'Третий' }),
      size: num('Размер, px', 10, 120),
      sizeMobile: num('…на телефоне, px (0 — как выше)', 0, 120),
      weight: select('Жирность', WEIGHTS),
      color: colorField('Цвет'),
      align: radio('Выравнивание', ALIGN),
      font: select('Шрифт', FONT_OPTIONS),
      lineHeight: num('Межстрочный интервал', 0.8, 2.5, 0.05),
      letterSpacing: num('Расстояние между буквами, px', -5, 20, 0.5),
      uppercase: yesNo('Заглавными буквами'),
      italic: yesNo('Курсив'),
      shadow: yesNo('Тень под текстом'),
      ...boxFields,
    },
    defaultProps: {
      text: 'Заголовок',
      level: 'h2',
      size: 30,
      sizeMobile: 0,
      weight: '800',
      color: '',
      align: 'center',
      font: 'inherit',
      lineHeight: 1.15,
      letterSpacing: 0,
      uppercase: false,
      italic: false,
      shadow: false,
      ...BOX_DEFAULTS,
    },
    render: ({ puck, ...p }) => {
      const Tag = p.level;
      return (
        <>
          <FontLink font={p.font} />
          <Tag
            className={`pk-fs ${boxClass(p, !isExport(puck))}`}
            style={{
              ...boxStyle(p),
              ...sizeVars(p.size, p.sizeMobile),
              fontWeight: Number(p.weight),
              color: p.color || undefined,
              textAlign: p.align,
              fontFamily: fontCss(p.font),
              lineHeight: p.lineHeight,
              letterSpacing: p.letterSpacing ? `${p.letterSpacing}px` : undefined,
              textTransform: p.uppercase ? 'uppercase' : undefined,
              fontStyle: p.italic ? 'italic' : undefined,
              textShadow: p.shadow ? '0 2px 14px rgba(0,0,0,.45)' : undefined,
              whiteSpace: 'pre-line',
            }}
          >
            {p.text}
          </Tag>
        </>
      );
    },
  };

  const Text: ComponentConfig<TextProps> = {
    label: 'Текст',
    fields: {
      text: { type: 'richtext', label: 'Текст' },
      size: num('Размер, px', 10, 60),
      sizeMobile: num('…на телефоне, px (0 — как выше)', 0, 60),
      weight: select('Жирность', WEIGHTS),
      color: colorField('Цвет'),
      align: radio('Выравнивание', ALIGN),
      font: select('Шрифт', FONT_OPTIONS),
      lineHeight: num('Межстрочный интервал', 0.8, 2.5, 0.05),
      maxWidth: num('Максимальная ширина, px (0 — без ограничения)', 0, 1400),
      ...boxFields,
    },
    defaultProps: {
      text: '<p>Короткий текст о том, что ждёт подписчика.</p>',
      size: 16,
      sizeMobile: 0,
      weight: '400',
      color: '',
      align: 'center',
      font: 'inherit',
      lineHeight: 1.5,
      maxWidth: 0,
      ...BOX_DEFAULTS,
    },
    render: ({ puck, ...p }) => (
      <>
        <FontLink font={p.font} />
        <div
          className={`pk-fs pk-rich ${boxClass(p, !isExport(puck))}`}
          style={{
            ...boxStyle(p),
            ...sizeVars(p.size, p.sizeMobile),
            fontWeight: Number(p.weight),
            color: p.color || undefined,
            textAlign: p.align,
            fontFamily: fontCss(p.font),
            lineHeight: p.lineHeight,
            maxWidth: p.maxWidth || undefined,
            marginLeft: p.maxWidth ? (p.align === 'left' ? 0 : 'auto') : undefined,
            marginRight: p.maxWidth ? (p.align === 'right' ? 0 : 'auto') : undefined,
          }}
        >
          {p.text}
        </div>
      </>
    ),
  };

  const Image: ComponentConfig<ImageProps> = {
    label: 'Картинка',
    fields: {
      src: imageField('Картинка', upload),
      alt: text('Описание (для поисковиков)'),
      width: num('Ширина, %', 5, 100),
      maxWidth: num('Максимальная ширина, px (0 — без ограничения)', 0, 2000),
      ratio: select('Пропорции', { auto: 'Как у картинки', '1/1': 'Квадрат', '4/3': '4 : 3', '3/4': '3 : 4', '16/9': '16 : 9', '9/16': '9 : 16' }),
      fit: radio('Заполнение', { cover: 'Обрезать', contain: 'Вписать' }),
      radius: num('Скругление, px (999 — круг)', 0, 999),
      shadow: select('Тень', { none: 'Нет', soft: 'Мягкая', strong: 'Сильная', glow: 'Свечение' }),
      align: radio('Положение', ALIGN),
      action: select('При нажатии', ACTIONS),
      url: text('Ссылка (для «Открыть ссылку»)', 'https://'),
      ...boxFields,
    },
    defaultProps: { src: '', alt: '', width: 100, maxWidth: 0, ratio: 'auto', fit: 'cover', radius: 16, shadow: 'none', align: 'center', action: 'none', url: '', ...BOX_DEFAULTS },
    resolveFields: (data, { fields }) => {
      const f = { ...fields } as Record<string, unknown>;
      if (data.props.action !== 'url') delete f.url;
      if (data.props.ratio === 'auto') delete f.fit;
      return f as typeof fields;
    },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      const imgStyle: CSSProperties = {
        display: 'block',
        width: '100%',
        borderRadius: p.radius,
        boxShadow: SHADOWS[p.shadow] ?? 'none',
        aspectRatio: p.ratio === 'auto' ? undefined : p.ratio,
        objectFit: p.ratio === 'auto' ? undefined : p.fit,
      };
      const img = p.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.src} alt={p.alt} loading="lazy" style={imgStyle} />
      ) : exporting ? null : (
        <div style={{ ...imgStyle, aspectRatio: p.ratio === 'auto' ? '16/9' : p.ratio, background: 'rgba(127,127,127,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '500 13px system-ui', color: 'rgba(127,127,127,.9)' }}>
          Выберите картинку справа
        </div>
      );
      if (!img) return <></>;
      const attrs = actionAttrs(p.action, p.url, true, exporting);
      const inner = attrs.href ? (
        <a {...attrs} style={{ display: 'block' }}>
          {img}
        </a>
      ) : (
        img
      );
      return (
        <div className={boxClass(p, !exporting)} style={{ ...boxStyle(p), display: 'flex', justifyContent: flexAlign(p.align) }}>
          <div style={{ width: `${p.width}%`, maxWidth: p.maxWidth || undefined }}>{inner}</div>
        </div>
      );
    },
  };

  const List: ComponentConfig<ListProps> = {
    label: 'Список',
    fields: {
      items: {
        type: 'array',
        label: 'Пункты',
        arrayFields: { icon: text('Значок (эмодзи или символ)'), text: textarea('Текст') },
        defaultItemProps: { icon: '✅', text: 'Новый пункт' },
        getItemSummary: (item) => item.text || 'Пункт',
        max: 20,
      },
      size: num('Размер текста, px', 10, 40),
      iconSize: num('Размер значка, px', 10, 60),
      color: colorField('Цвет текста'),
      gap: num('Расстояние между пунктами, px', 0, 40),
      align: radio('Положение', { left: 'Слева', center: 'По центру' }),
      itemBg: colorField('Подложка пункта'),
      itemRadius: num('Скругление подложки, px', 0, 30),
      ...boxFields,
    },
    defaultProps: {
      items: [
        { icon: '✅', text: 'Первое преимущество' },
        { icon: '✅', text: 'Второе преимущество' },
        { icon: '✅', text: 'Третье преимущество' },
      ],
      size: 16,
      iconSize: 18,
      color: '',
      gap: 10,
      align: 'left',
      itemBg: '',
      itemRadius: 12,
      ...BOX_DEFAULTS,
    },
    render: ({ puck, ...p }) => (
      <ul
        className={boxClass(p, !isExport(puck))}
        style={{ ...boxStyle(p), listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: p.gap, alignItems: p.align === 'center' ? 'center' : 'stretch' }}
      >
        {p.items.map((item, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: p.size,
              color: p.color || undefined,
              textAlign: 'left',
              background: p.itemBg || undefined,
              borderRadius: p.itemBg ? p.itemRadius : undefined,
              padding: p.itemBg ? '10px 12px' : undefined,
            }}
          >
            {item.icon && <span style={{ fontSize: p.iconSize, lineHeight: 1.2, flexShrink: 0 }}>{item.icon}</span>}
            <span style={{ whiteSpace: 'pre-line' }}>{item.text}</span>
          </li>
        ))}
      </ul>
    ),
  };

  const Video: ComponentConfig<VideoProps> = {
    label: 'Видео',
    fields: {
      url: videoField('Видео', uploadAsset),
      ratio: select('Пропорции', { '16/9': '16 : 9', '9/16': '9 : 16 (вертикальное)', '1/1': 'Квадрат', '4/5': '4 : 5' }),
      radius: num('Скругление, px', 0, 60),
      autoplay: yesNo('Автозапуск без звука (только .mp4)'),
      controls: yesNo('Кнопки управления'),
      ...boxFields,
    },
    defaultProps: { url: '', ratio: '16/9', radius: 16, autoplay: false, controls: true, ...BOX_DEFAULTS },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      const frame: CSSProperties = { width: '100%', aspectRatio: p.ratio, borderRadius: p.radius, overflow: 'hidden', background: '#000', display: 'block', border: 0 };
      const yt = p.url ? youtubeId(p.url) : null;
      let body: ReactNode = null;
      if (yt) {
        body = exporting ? (
          <iframe src={`https://www.youtube.com/embed/${yt}?playsinline=1`} style={frame} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title="video" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" style={{ ...frame, objectFit: 'cover' }} />
        );
      } else if (isSafeUrl(p.url)) {
        const src = p.url.trim();
        // У загруженных видео обложка лежит рядом под тем же именем (.jpg) — см. LandingsService.uploadPuckAsset.
        const poster = /\/landings\/puck-assets\/[^?]+\.mp4$/.test(src) ? src.replace(/\.mp4$/, '.jpg') : undefined;
        body = <video src={src} poster={poster} style={frame} playsInline controls={p.controls} autoPlay={p.autoplay} muted={p.autoplay} loop={p.autoplay} preload="metadata" />;
      } else if (!exporting) {
        body = <div style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', font: '500 13px system-ui' }}>Загрузите видео или вставьте ссылку справа</div>;
      }
      if (!body) return <></>;
      return (
        <div className={boxClass(p, !exporting)} style={boxStyle(p)}>
          {body}
        </div>
      );
    },
  };

  const HtmlCode: ComponentConfig<HtmlProps> = {
    label: 'HTML-код',
    fields: {
      code: textarea('Код (HTML, CSS, скрипты)'),
      previewHeight: num('Высота предпросмотра в редакторе, px', 40, 1200),
      ...boxFields,
    },
    defaultProps: { code: '<div style="padding:12px;text-align:center">Ваш HTML</div>', previewHeight: 120, ...BOX_DEFAULTS },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      if (exporting) return <div className={boxClass(p, false)} style={boxStyle(p)} dangerouslySetInnerHTML={{ __html: p.code }} />;
      // В редакторе — в изолированном iframe без доступа к странице CRM.
      return (
        <div className={boxClass(p, true)} style={boxStyle(p)}>
          <iframe sandbox="allow-scripts" srcDoc={p.code} title="HTML" style={{ width: '100%', height: p.previewHeight, border: '1px dashed rgba(127,127,127,.5)', borderRadius: 8, background: 'transparent' }} />
        </div>
      );
    },
  };

  const Channel: ComponentConfig<ChannelProps> = {
    label: 'Канал: аватар и название',
    fields: {
      layout: radio('Расположение', { column: 'Аватар сверху', row: 'Аватар слева' }),
      align: radio('Выравнивание', ALIGN),
      showAvatar: yesNo('Аватар'),
      avatarSize: num('Размер аватара, px', 24, 240),
      avatarRadius: num('Скругление аватара, % (50 — круг)', 0, 50),
      ringColor: colorField('Обводка аватара'),
      ringWidth: num('Толщина обводки, px', 0, 12),
      showTitle: yesNo('Название канала'),
      title: text('Своё название (пусто — как у канала)'),
      titleSize: num('Размер названия, px', 10, 72),
      titleWeight: select('Жирность названия', WEIGHTS),
      titleColor: colorField('Цвет названия'),
      verified: yesNo('Синяя галочка'),
      showSubs: yesNo('Число подписчиков'),
      subsText: text('Текст ({count} — число подписчиков)'),
      subsSize: num('Размер текста подписчиков, px', 10, 40),
      subsColor: colorField('Цвет текста подписчиков'),
      ...boxFields,
    },
    defaultProps: {
      layout: 'column',
      align: 'center',
      showAvatar: true,
      avatarSize: 104,
      avatarRadius: 50,
      ringColor: '',
      ringWidth: 0,
      showTitle: true,
      title: '',
      titleSize: 24,
      titleWeight: '800',
      titleColor: '',
      verified: false,
      showSubs: true,
      subsText: '{count} подписчиков',
      subsSize: 14,
      subsColor: '',
      ...BOX_DEFAULTS,
    },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      const ch = metaOf(puck).channel;
      const title = p.title || (exporting ? '{{CHANNEL_TITLE}}' : ch?.title || 'Название канала');
      const subs = p.subsText.replace(/\{count\}/g, exporting ? '{{PUCK_SUBSCRIBERS}}' : ch?.subscribers || '12 480');
      const ring = p.ringWidth && p.ringColor ? `0 0 0 ${p.ringWidth}px ${p.ringColor}` : undefined;
      const avatarStyle: CSSProperties = {
        width: p.avatarSize,
        height: p.avatarSize,
        borderRadius: `${p.avatarRadius}%`,
        fontSize: p.avatarSize * 0.42,
        boxShadow: ring,
      };
      let avatar: ReactNode = null;
      if (p.showAvatar) {
        if (exporting) {
          // Буква под картинкой: если фото не загрузится, картинка удаляет себя и видна буква.
          avatar = (
            <div
              className="pk-avatar"
              style={avatarStyle}
              dangerouslySetInnerHTML={{ __html: `{{CHANNEL_INITIAL}}<img src="{{CHANNEL_AVATAR}}" alt="" onerror="this.remove()">` }}
            />
          );
        } else {
          avatar = (
            <div className="pk-avatar" style={avatarStyle}>
              {(ch?.title || 'К').charAt(0).toUpperCase()}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {ch?.avatarUrl && <img src={ch.avatarUrl} alt="" />}
            </div>
          );
        }
      }
      const row = p.layout === 'row';
      return (
        <div
          className={boxClass(p, !exporting)}
          style={{
            ...boxStyle(p),
            display: 'flex',
            flexDirection: row ? 'row' : 'column',
            alignItems: row ? 'center' : flexAlign(p.align),
            justifyContent: row ? flexAlign(p.align) : undefined,
            gap: row ? 14 : 10,
            textAlign: row ? 'left' : p.align,
          }}
        >
          {avatar}
          {(p.showTitle || p.showSubs) && (
            <div style={{ minWidth: 0 }}>
              {p.showTitle && (
                <div style={{ fontSize: p.titleSize, fontWeight: Number(p.titleWeight), color: p.titleColor || undefined, lineHeight: 1.2 }}>
                  {title}
                  {p.verified && (
                    <svg viewBox="0 0 24 24" width={p.titleSize * 0.8} height={p.titleSize * 0.8} style={{ marginLeft: 6, verticalAlign: '-0.1em', display: 'inline' }} aria-hidden="true">
                      <path fill="#3390EC" d="M12 1l2.6 2.1 3.3-.4 1 3.2 2.9 1.6-.9 3.2 1.6 2.9-2.6 2.1-.2 3.4-3.3.4-1.9 2.8L12 21.1l-3.5 1.2-1.9-2.8-3.3-.4-.2-3.4-2.6-2.1 1.6-2.9-.9-3.2 2.9-1.6 1-3.2 3.3.4z" />
                      <path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4z" />
                    </svg>
                  )}
                </div>
              )}
              {p.showSubs && <div style={{ fontSize: p.subsSize, color: p.subsColor || undefined, opacity: p.subsColor ? 1 : 0.65, marginTop: 4 }}>{subs}</div>}
            </div>
          )}
        </div>
      );
    },
  };

  const Button: ComponentConfig<ButtonProps> = {
    label: 'Кнопка',
    fields: {
      text: text('Текст'),
      icon: text('Значок перед текстом (эмодзи)'),
      action: select('Действие', ACTIONS),
      url: text('Ссылка', 'https://'),
      newTab: yesNo('В новой вкладке'),
      variant: select('Вид', { filled: 'Залитая', outline: 'Контур', soft: 'Мягкая', text: 'Только текст' }),
      bg: colorField('Цвет кнопки (пусто — акцентный)'),
      color: colorField('Цвет текста'),
      size: num('Размер текста, px', 10, 40),
      weight: select('Жирность', WEIGHTS),
      font: select('Шрифт', FONT_OPTIONS),
      uppercase: yesNo('Заглавными буквами'),
      height: num('Высота, px', 28, 100),
      padX: num('Отступ по бокам, px', 0, 80),
      radius: num('Скругление, px (999 — таблетка)', 0, 999),
      fullWidth: yesNo('На всю ширину'),
      maxWidth: num('Максимальная ширина, px (0 — без ограничения)', 0, 1200),
      align: radio('Положение', ALIGN),
      shadow: select('Тень', { none: 'Нет', soft: 'Мягкая', strong: 'Сильная', glow: 'Свечение' }),
      pulse: yesNo('Пульсация'),
      shine: yesNo('Блик'),
      ...boxFields,
    },
    defaultProps: {
      text: 'Вступить в канал',
      icon: '',
      action: 'telegram',
      url: '',
      newTab: false,
      variant: 'filled',
      bg: '',
      color: '',
      size: 17,
      weight: '700',
      font: 'inherit',
      uppercase: false,
      height: 54,
      padX: 28,
      radius: 14,
      fullWidth: true,
      maxWidth: 0,
      align: 'center',
      shadow: 'none',
      pulse: true,
      shine: false,
      ...BOX_DEFAULTS,
    },
    resolveFields: (data, { fields }) => {
      const f = { ...fields } as Record<string, unknown>;
      if (data.props.action !== 'url') {
        delete f.url;
        delete f.newTab;
      }
      return f as typeof fields;
    },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      const base = p.bg || 'var(--pk-accent)';
      const variants: Record<ButtonProps['variant'], CSSProperties> = {
        filled: { background: base, color: p.color || '#FFFFFF' },
        outline: { background: 'transparent', color: p.color || base, boxShadow: `inset 0 0 0 2px ${p.bg || 'var(--pk-accent)'}` },
        soft: { background: `color-mix(in srgb, ${base} 16%, transparent)`, color: p.color || base },
        text: { background: 'transparent', color: p.color || base },
      };
      const style: CSSProperties = {
        ...variants[p.variant],
        fontSize: p.size,
        fontWeight: Number(p.weight),
        fontFamily: fontCss(p.font),
        textTransform: p.uppercase ? 'uppercase' : undefined,
        minHeight: p.height,
        padding: `8px ${p.padX}px`,
        borderRadius: p.radius,
        width: p.fullWidth ? '100%' : undefined,
        maxWidth: p.maxWidth || undefined,
        ['--pk-pulse' as string]: p.bg ? withAlpha(p.bg, 60) : undefined,
      };
      if (p.shadow !== 'none' && p.variant !== 'outline') style.boxShadow = SHADOWS[p.shadow];
      const cls = `pk-btn ${p.pulse ? 'pk-pulse' : ''} ${p.shine ? 'pk-shine' : ''}`;
      const content = (
        <>
          {p.icon && <span aria-hidden="true">{p.icon}</span>}
          <span>{p.text}</span>
        </>
      );
      return (
        <div className={boxClass(p, !exporting)} style={{ ...boxStyle(p), display: 'flex', justifyContent: flexAlign(p.align) }}>
          <FontLink font={p.font} />
          {exporting && p.action !== 'none' ? (
            <a className={cls} style={style} {...actionAttrs(p.action, p.url, p.newTab, true)}>
              {content}
            </a>
          ) : (
            <span className={cls} style={style}>
              {content}
            </span>
          )}
        </div>
      );
    },
  };

  const Timer: ComponentConfig<TimerProps> = {
    label: 'Таймер',
    fields: {
      minutes: num('Минут (отсчёт начинается при открытии)', 1, 1440),
      label: text('Подпись'),
      layout: radio('Подпись', { column: 'Над таймером', row: 'Слева от таймера' }),
      size: num('Размер цифр, px', 12, 96),
      color: colorField('Цвет цифр'),
      labelColor: colorField('Цвет подписи'),
      bg: colorField('Подложка'),
      radius: num('Скругление подложки, px', 0, 40),
      align: radio('Положение', ALIGN),
      ...boxFields,
    },
    defaultProps: { minutes: 15, label: 'Доступ закроется через', layout: 'column', size: 34, color: '', labelColor: '', bg: '', radius: 14, align: 'center', ...BOX_DEFAULTS },
    render: ({ puck, ...p }) => {
      const exporting = isExport(puck);
      return (
        <div className={boxClass(p, !exporting)} style={{ ...boxStyle(p), display: 'flex', justifyContent: flexAlign(p.align) }}>
          <div
            data-pk-timer={exporting ? String(p.minutes) : undefined}
            style={{
              display: 'inline-flex',
              flexDirection: p.layout,
              alignItems: 'center',
              gap: p.layout === 'row' ? 10 : 4,
              background: p.bg || undefined,
              borderRadius: p.bg ? p.radius : undefined,
              padding: p.bg ? '10px 18px' : undefined,
            }}
          >
            {p.label && <span style={{ fontSize: Math.max(11, Math.round(p.size * 0.38)), color: p.labelColor || undefined, opacity: p.labelColor ? 1 : 0.7 }}>{p.label}</span>}
            <span data-pk-timer-value="" style={{ fontSize: p.size, fontWeight: 800, color: p.color || undefined, fontVariantNumeric: 'tabular-nums', letterSpacing: 1 }}>
              {formatTimer(p.minutes)}
            </span>
          </div>
        </div>
      );
    },
  };

  const Badge: ComponentConfig<BadgeProps> = {
    label: 'Плашка',
    fields: {
      text: text('Текст'),
      bg: colorField('Цвет фона (пусто — акцентный)'),
      color: colorField('Цвет текста'),
      size: num('Размер, px', 9, 30),
      radius: num('Скругление, px', 0, 999),
      align: radio('Положение', ALIGN),
      uppercase: yesNo('Заглавными буквами'),
      pulse: yesNo('Пульсация'),
      ...boxFields,
    },
    defaultProps: { text: '🔥 Осталось 14 мест', bg: '', color: '#FFFFFF', size: 13, radius: 999, align: 'center', uppercase: false, pulse: false, ...BOX_DEFAULTS },
    render: ({ puck, ...p }) => (
      <div className={boxClass(p, !isExport(puck))} style={{ ...boxStyle(p), display: 'flex', justifyContent: flexAlign(p.align) }}>
        <span
          className={p.pulse ? 'pk-pulse' : undefined}
          style={{
            display: 'inline-block',
            background: p.bg || 'var(--pk-accent)',
            color: p.color || '#fff',
            fontSize: p.size,
            fontWeight: 700,
            padding: '0.4em 0.9em',
            borderRadius: p.radius,
            textTransform: p.uppercase ? 'uppercase' : undefined,
            letterSpacing: p.uppercase ? 0.6 : undefined,
            ['--pk-pulse' as string]: p.bg ? withAlpha(p.bg, 60) : undefined,
          }}
        >
          {p.text}
        </span>
      </div>
    ),
  };

  return {
    categories: {
      structure: { title: 'Структура', components: ['Section', 'Columns', 'Card', 'Spacer', 'Divider'] },
      flow: { title: 'Шаги и попапы', components: ['Step', 'Popup'] },
      channel: { title: 'Канал и действие', components: ['Channel', 'Button', 'Timer', 'Badge'] },
      content: { title: 'Контент', components: ['Heading', 'Text', 'Image', 'List', 'Video', 'HtmlCode'] },
    },
    root: {
      fields: {
        title: text('Заголовок вкладки браузера'),
        font: select('Шрифт страницы', Object.fromEntries(FONTS.map((f) => [f.value, f.label]))),
        textColor: colorField('Цвет текста', false),
        accent: colorField('Акцентный цвет (кнопки)', false),
        ...bgFields(upload),
        center: yesNo('Содержимое по центру экрана'),
      },
      defaultProps: {
        title: '',
        font: 'system',
        textColor: '#FFFFFF',
        accent: '#2AABEE',
        bgType: 'gradient',
        bgColor: '#0E1621',
        gradFrom: '#17212B',
        gradTo: '#0E1621',
        gradAngle: 180,
        bgImage: '',
        overlayColor: '#000000',
        overlay: 40,
        center: true,
      },
      resolveFields: (data, { fields }) => filterBgFields(fields, (data.props as RootProps).bgType),
      render: ({ children, ...p }) => {
        const href = fontHref(p.font);
        return (
          <div
            className={`pk-page ${p.center ? 'pk-center' : ''}`}
            style={{
              ...backgroundOf({ ...p, bgType: p.bgType || 'color' }),
              ['--pk-font' as string]: fontCss(p.font) || FONTS[0].css,
              ['--pk-text' as string]: p.textColor || '#111111',
              ['--pk-accent' as string]: p.accent || '#2AABEE',
              ['--pk-glow' as string]: withAlpha(p.accent || '#2AABEE', 45),
            }}
          >
            <style dangerouslySetInnerHTML={{ __html: BASE_CSS }} />
            {href && <link rel="stylesheet" href={href} />}
            {children}
          </div>
        );
      },
    },
    components: { Section, Columns, Card, Step, Popup, Spacer, Divider, Heading, Text, Image, List, Video, HtmlCode, Channel, Button, Timer, Badge },
  } as PuckLandingConfig;
}
