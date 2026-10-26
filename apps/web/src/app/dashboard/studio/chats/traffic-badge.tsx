// Площадка лида рядом с именем (2026-10-26: «сразу напиши рядом с его именем мелко, с какой
// платформы он, ФБ/ТТ, цвета разные, ФБ точно синий»): Facebook — фирменный синий, TikTok — его
// фирменный малиновый (чёрный TikTok потерялся бы в тёмной теме).
const STYLE = {
  FB: { label: 'FB', title: 'Пришёл из Facebook', className: 'bg-[#1877F2]/12 text-[#1877F2] dark:bg-[#1877F2]/25 dark:text-[#6EA8FF]' },
  TT: { label: 'TT', title: 'Пришёл из TikTok', className: 'bg-[#FE2C55]/12 text-[#E0144A] dark:bg-[#FE2C55]/20 dark:text-[#FF6B8B]' },
} as const;

export function TrafficBadge({ source }: { source?: 'FB' | 'TT' | null }) {
  if (!source) return null;
  const s = STYLE[source];
  return (
    <span title={s.title} className={`shrink-0 text-[10px] font-bold leading-none px-1.5 py-[3px] rounded ${s.className}`}>
      {s.label}
    </span>
  );
}
