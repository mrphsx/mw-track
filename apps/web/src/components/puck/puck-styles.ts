// Общие стили и шрифты блоков визуального редактора. BASE_CSS рендерится корнем страницы и в
// редакторе, и в готовом лендинге — поэтому страница в редакторе выглядит так же, как на домене.

export const MOBILE_MAX = 640;

export const BASE_CSS = `
.pk-page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;font-family:var(--pk-font);color:var(--pk-text);-webkit-font-smoothing:antialiased;line-height:1.45;word-wrap:break-word}
.pk-page *{box-sizing:border-box}
.pk-page.pk-center{justify-content:center}
.pk-page h1,.pk-page h2,.pk-page h3,.pk-page p{margin:0}
.pk-fs{font-size:var(--fs)}
.pk-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;text-decoration:none;cursor:pointer;border:0;font:inherit;line-height:1.15;text-align:center;transition:transform .15s ease,filter .15s ease;-webkit-tap-highlight-color:transparent;max-width:100%}
.pk-btn:hover{filter:brightness(1.07)}
.pk-btn:active{transform:scale(.97)}
.pk-pulse{animation:pk-pulse 1.8s ease-out infinite}
.pk-shine{position:relative;overflow:hidden}
.pk-shine::after{content:'';position:absolute;top:0;left:-70%;width:45%;height:100%;background:linear-gradient(110deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-20deg);animation:pk-shine 2.8s ease-in-out infinite;pointer-events:none}
.pk-rich p{margin:0 0 .6em}.pk-rich p:last-child{margin-bottom:0}
.pk-rich ul,.pk-rich ol{margin:0 0 .6em;padding-left:1.3em}
.pk-rich a{color:var(--pk-accent)}
.pk-cols{display:grid}
.pk-avatar{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;color:#fff;background:var(--pk-accent)}
.pk-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pk-popup{position:fixed;inset:0;z-index:2147483000;display:flex;justify-content:center;padding:16px;overflow-y:auto}
.pk-popup-card{position:relative;width:100%}
.pk-popup-x{position:absolute;top:8px;right:10px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(127,127,127,.18);color:inherit;font-size:20px;line-height:30px;text-align:center;cursor:pointer;text-decoration:none}
.pk-a-fade{animation:pk-fade .6s ease both}
.pk-a-up{animation:pk-up .6s ease both}
.pk-a-zoom{animation:pk-zoom .5s cubic-bezier(.2,.9,.3,1.2) both}
.pk-a-left{animation:pk-left .6s ease both}
.pk-a-shake{animation:pk-shake 3s ease-in-out infinite}
@keyframes pk-pulse{0%{box-shadow:0 0 0 0 var(--pk-pulse,rgba(42,171,238,.6))}70%{box-shadow:0 0 0 14px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}
@keyframes pk-shine{0%{left:-70%}55%,100%{left:130%}}
@keyframes pk-fade{from{opacity:0}to{opacity:1}}
@keyframes pk-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes pk-zoom{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
@keyframes pk-left{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
@keyframes pk-shake{0%,86%,100%{transform:none}88%,92%,96%{transform:translateX(-4px) rotate(-1deg)}90%,94%,98%{transform:translateX(4px) rotate(1deg)}}
@media (max-width:${MOBILE_MAX}px){
.pk-fs{font-size:var(--fs-m,var(--fs))}
.pk-cols.pk-stack{grid-template-columns:1fr!important}
.pk-hide-m{display:none!important}
.pk-ghost-m{opacity:.35}
.pk-pad{padding:var(--pad-m,var(--pad))!important}
}
@media (min-width:${MOBILE_MAX + 1}px){
.pk-hide-d{display:none!important}
.pk-ghost-d{opacity:.35}
}
@media (prefers-reduced-motion:reduce){.pk-page *{animation:none!important}}
`;

export interface FontOption {
  value: string;
  label: string;
  css: string;
  google?: string; // параметр family для fonts.googleapis.com/css2
}

export const FONTS: FontOption[] = [
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
  { value: 'manrope', label: 'Manrope', css: "'Manrope', sans-serif", google: 'Manrope:wght@400;500;600;700;800' },
  { value: 'montserrat', label: 'Montserrat', css: "'Montserrat', sans-serif", google: 'Montserrat:wght@400;500;600;700;800;900' },
  { value: 'inter', label: 'Inter', css: "'Inter', sans-serif", google: 'Inter:wght@400;500;600;700;800;900' },
  { value: 'roboto', label: 'Roboto', css: "'Roboto', sans-serif", google: 'Roboto:wght@400;500;700;900' },
  { value: 'rubik', label: 'Rubik', css: "'Rubik', sans-serif", google: 'Rubik:wght@400;500;600;700;800;900' },
  { value: 'unbounded', label: 'Unbounded', css: "'Unbounded', sans-serif", google: 'Unbounded:wght@400;500;600;700;800;900' },
  { value: 'oswald', label: 'Oswald', css: "'Oswald', sans-serif", google: 'Oswald:wght@400;500;600;700' },
  { value: 'playfair', label: 'Playfair Display', css: "'Playfair Display', serif", google: 'Playfair+Display:wght@400;500;600;700;800;900' },
  { value: 'comfortaa', label: 'Comfortaa', css: "'Comfortaa', sans-serif", google: 'Comfortaa:wght@400;500;600;700' },
];

export function fontCss(value: string | undefined): string | undefined {
  if (!value || value === 'inherit') return undefined;
  return FONTS.find((f) => f.value === value)?.css;
}

export function fontHref(value: string | undefined): string | null {
  const google = FONTS.find((f) => f.value === value)?.google;
  return google ? `https://fonts.googleapis.com/css2?family=${google}&display=swap` : null;
}

const HEX = /^#([0-9a-f]{6})$/i;

// Цвет с прозрачностью: #RRGGBB + 0..100 → rgba(). Пустой цвет — прозрачный.
export function withAlpha(hex: string | undefined, opacity: number | undefined): string {
  const m = HEX.exec(hex || '');
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  const a = Math.max(0, Math.min(100, opacity ?? 100)) / 100;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const SHADOWS: Record<string, string> = {
  none: 'none',
  soft: '0 10px 30px rgba(0,0,0,.18)',
  strong: '0 24px 60px rgba(0,0,0,.38)',
  glow: '0 0 0 1px rgba(255,255,255,.06), 0 0 40px var(--pk-glow, rgba(42,171,238,.45))',
};

export function isSafeUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url.trim());
}
