// Расширенная палитра "Studio" (запрос пользователя 2026-07-28: "не хватает цветов немного
// других, всё сильно однообразное") — у каждой категории метрик свой приглушённый оттенок,
// некричащем ключе (не чистые праймари-цвета).
//
// 2026-07-30: палитра сменена с тёплой кремовой/янтарной на "Cobalt Field" (запрос
// пользователя, выбрана из 5 вариантов — см. артефакт-сравнение) — холодный уверенный синий
// как флагман вместо янтаря, прохладный светлый/тёмный фон вместо тёплого кремового/чёрного.
// ВАЖНО: ключи объекта (amber/sage/slate/teal) НЕ переименованы вслед за цветом — их держат
// ~30+ мест по всей Studio (StudioProjectPage.metrics[].hue, FUNNEL_HUE, LeaderboardBlock hue,
// LandingCard statusDotClassName и т.д.), переименование потребовало бы правки каждого места
// без функциональной необходимости. Смысл ключа теперь ролевой, а не буквальный:
// - amber — по-прежнему флагманский/самый частый акцент (теперь кобальтовый синий).
// - sage — по-прежнему "активно/позитивно" (StatusPill, индикатор трекинга) — теперь
//   сине-зелёный тил вместо зелёного, читается тем же "живым" по смыслу, просто не зелёный.
// - teal — этот КЛЮЧ хранит НЕ тил, а тёплый песочный/охра — единственный тёплый цвет среди
//   4 холодных, акцентное "пятно" в духе исходного варианта Cobalt Field.
// - slate/plum — совпадают и по ключу, и по смыслу с одноимёнными цветами Cobalt Field.
export interface StudioHue {
  text: string; // dark: text-* эквивалент передаётся отдельно ниже через paired-классы
  bgSoft: string;
  textClass: string;
  bgSoftClass: string;
}

// Используются как готовые пары Tailwind-классов (light + dark) — проще прокидывать строкой в
// className, чем каждый раз собирать light/dark вручную по месту использования.
export const STUDIO_HUES = {
  amber: {
    textClass: 'text-[#1F4E9C] dark:text-[#7BA9EE]',
    bgSoftClass: 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/10',
  },
  sage: {
    textClass: 'text-[#1F7A6C] dark:text-[#6FCBBA]',
    bgSoftClass: 'bg-[#1F7A6C]/10 dark:bg-[#6FCBBA]/10',
  },
  slate: {
    textClass: 'text-[#52606B] dark:text-[#A6B4C0]',
    bgSoftClass: 'bg-[#52606B]/10 dark:bg-[#A6B4C0]/10',
  },
  plum: {
    textClass: 'text-[#6B3E63] dark:text-[#D19BC4]',
    bgSoftClass: 'bg-[#6B3E63]/10 dark:bg-[#D19BC4]/10',
  },
  teal: {
    textClass: 'text-[#A8783C] dark:text-[#E0B378]',
    bgSoftClass: 'bg-[#A8783C]/10 dark:bg-[#E0B378]/10',
  },
} as const;

export type StudioHueName = keyof typeof STUDIO_HUES;

// Literal-цвета той же палитры — для мест, где Tailwind-классы не подходят (recharts stroke,
// inline style для баров) — по теме (next-themes resolvedTheme), не через dark:-классы.
export const STUDIO_HUE_HEX: Record<StudioHueName, { light: string; dark: string }> = {
  amber: { light: '#1F4E9C', dark: '#7BA9EE' },
  sage: { light: '#1F7A6C', dark: '#6FCBBA' },
  slate: { light: '#52606B', dark: '#A6B4C0' },
  plum: { light: '#6B3E63', dark: '#D19BC4' },
  teal: { light: '#A8783C', dark: '#E0B378' },
};
