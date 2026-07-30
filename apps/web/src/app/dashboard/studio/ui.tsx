// Общие визуальные примитивы Studio, вынесенные при добавлении 2-й и 3-й страницы (Лендинги/
// Сценарии, запрос пользователя 2026-07-30: "учти всё что мы правили") — раньше карточка/пилюля/
// кнопка-действие дублировались inline в каждом файле (project/page.tsx). С ростом числа страниц
// дублирование стало тем самым "3 похожих файла — пора вынести в общее место", что уже разбирали
// на shared data layer (prototype-project-data.ts) раньше в этой же сессии. Радиус — актуальная
// на 2026-07-30 шкала (2-й раунд, "давай немного округленнее"): rounded-lg пилюли/кнопки/бейджи,
// rounded-xl карточки — см. историю в projects/[id]/page.tsx.
import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { STUDIO_HUES, StudioHueName } from './colors';

export const STUDIO_CARD = 'rounded-xl bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm';

export function StudioPill({ hue, danger, children }: { hue?: StudioHueName; danger?: boolean; children: React.ReactNode }) {
  if (danger) {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
        {children}
      </span>
    );
  }
  const { textClass, bgSoftClass } = STUDIO_HUES[hue ?? 'slate'];
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-lg whitespace-nowrap ${bgSoftClass} ${textClass}`}>{children}</span>;
}

// Кнопка-пилюля как <Link> (переходы) — primary заполнена акцентом, secondary — белая с рамкой,
// тот же визуальный язык, что и у 4 кнопок действий на странице проекта.
export function StudioLinkButton({
  href,
  onClick,
  variant = 'secondary',
  icon: Icon,
  size = 'md',
  disabled,
  children,
}: {
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  icon?: LucideIcon;
  size?: 'md' | 'sm';
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors ${
    size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2'
  } ${
    variant === 'primary'
      ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] hover:opacity-90'
      : 'bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
  } ${disabled ? 'opacity-60 pointer-events-none' : ''}`;
  const content = (
    <>
      {Icon && <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {content}
    </button>
  );
}
