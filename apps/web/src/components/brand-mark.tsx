// Знак MWTRACK. История: 2026-10-25 — линия графика с точками; 2026-10-26 — «M» со стрелкой, затем
// жирная блочная залитая «M» (выбрана пользователем из десяти вариантов); пробовали зигзаг «MW»
// одной линией — пользователю не понравилось («плохо, верни старую»), вернули блочную «M».
// Читается в 16 px вкладки. Тот же рисунок — в app/icon.tsx.
export const BRAND_MARK_PATH = 'M3 20 V4.5 L9 4.5 L12 10 L15 4.5 L21 4.5 V20 L16.5 20 V11 L13.6 16 H10.4 L7.5 11 V20 Z';

// dotFillClassName — от прежнего знака (у нового нет полых точек); оставлен, чтобы не трогать вызовы.
export function BrandMark({ className }: { className?: string; dotFillClassName?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={BRAND_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
