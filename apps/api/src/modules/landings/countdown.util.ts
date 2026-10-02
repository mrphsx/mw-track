// Таймер обратного отсчёта как ОПЦИЯ любого лендинга (запрос пользователя 2026-10-02: "мы делали
// шаблон лэндинга с таймером, не будет лучше включить его под каждый лэндинг как доп опцию").
// Раньше таймер жил только внутри шаблона countdown-urgency — копии tg-invite-dark с одним лишним
// блоком, видимой одной компании; на реально используемых шаблонах (minimal — 54 живых лендинга,
// dark — 22, age-gate-invite — 19) таймера не было вовсе.
//
// Отличие от дополнительного попапа (extra-popup.util.ts): тот сам себе оверлей поверх страницы и
// места в чужой вёрстке не занимает, поэтому вставляется просто перед </body>. Таймер же должен
// стоять ВНУТРИ карточки, над кнопкой — произвольный HTML для этого не распарсишь надёжно,
// поэтому точка вставки объявлена в самих шаблонах плейсхолдером {{COUNTDOWN_BLOCK}}, который
// LandingRendererService подставляет (или вычищает, когда таймер выключен). Тот же плейсхолдер
// может поставить у себя и клиент, загружающий свой ZIP.

// У этого шаблона таймер уже встроен в собственный template.html — второй сверху был бы дублем.
export const COUNTDOWN_TEMPLATE_ID = 'countdown-urgency';

export const COUNTDOWN_PLACEHOLDER = '{{COUNTDOWN_BLOCK}}';

export interface CountdownConfig {
  label: string;
  spotsText: string;
  minutes: number;
}

export const MIN_COUNTDOWN_MINUTES = 1;
export const MAX_COUNTDOWN_MINUTES = 9999;

export const COUNTDOWN_DEFAULTS: CountdownConfig = {
  label: '🔒 Доступ закроется через',
  spotsText: '🔥 Осталось 14 мест из 50',
  minutes: 60,
};

// Пустая строка/отсутствующий ключ = дефолт для ЭТОГО ключа (тот же принцип, что у
// extraPopupConfig и текстов подсказки TikTok). Исключение — spotsText: пустая строка здесь
// осмысленна ("не показывать вторую строку"), поэтому отличаем её от отсутствующего ключа.
export function resolveCountdown(raw: unknown): CountdownConfig {
  const config = (raw && typeof raw === 'object' ? raw : {}) as Partial<CountdownConfig>;

  const minutes = Number(config.minutes);
  return {
    label: typeof config.label === 'string' && config.label.trim() ? config.label.trim() : COUNTDOWN_DEFAULTS.label,
    spotsText: typeof config.spotsText === 'string' ? config.spotsText.trim() : COUNTDOWN_DEFAULTS.spotsText,
    minutes:
      Number.isFinite(minutes) && minutes >= MIN_COUNTDOWN_MINUTES && minutes <= MAX_COUNTDOWN_MINUTES
        ? Math.floor(minutes)
        : COUNTDOWN_DEFAULTS.minutes,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// accentColor — акцент самого лендинга ({{PRIMARY_COLOR}} его шаблона), чтобы полоса не вносила
// второй акцентный цвет: ровно это (янтарная полоса поверх синей кнопки) и делало прежний шаблон
// с таймером похожим на сгенерированный, см. запись 2026-10-02 в CLAUDE.md.
//
// Остальные цвета НЕ фиксированные: блок попадает и на тёмные шаблоны, и на светлые, и в чужой
// загруженный ZIP. Фон — полупрозрачный серый, одинаково читаемый и на тёмной карточке, и на
// белой. А вот цвет ТЕКСТА наследовать нельзя: проверено вживую на tg-invite-light, где
// body { color: #fff } (белый текст для области вокруг карточки), а чёрный цвет выставлен
// поэлементно на заголовке/описании — унаследованный блок оказался белым на белой карточке.
// Поэтому скрипт блока сам ищет ближайший непрозрачный фон над собой и ставит тёмный или
// светлый текст по его яркости: это работает и на наших шаблонах, и на произвольной чужой
// вёрстке, где угадать палитру заранее невозможно.
// Шрифт наследуется, цифры — системный моноширинный стек: подключать веб-шрифт ради блока на
// чужой странице нельзя.
// В регулярке скрипта намеренно [0-9.], а не \d: скрипт лежит внутри шаблонной строки, где
// одиночный \d схлопывается в обычную букву d — ровно на этом блок один раз уже перестал
// находить фон и всегда красил текст запасным цветом.
export function renderCountdownHtml(config: CountdownConfig, accentColor: string): string {
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(accentColor) ? accentColor : '#2AABEE';
  const spots = config.spotsText
    ? `\n    <div class="mwx-countdown__spots">${escapeHtml(config.spotsText)}</div>`
    : '';

  return `<div class="mwx-countdown" id="mwx-countdown" data-mwx-minutes="${config.minutes}">
    <div class="mwx-countdown__label">${escapeHtml(config.label)}</div>
    <div class="mwx-countdown__digits" id="mwx-countdown-digits">00:00:00</div>
    <div class="mwx-countdown__bar"><div class="mwx-countdown__bar-fill" id="mwx-countdown-bar"></div></div>${spots}
  </div>
<style>
  .mwx-countdown {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 16px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(127, 127, 127, 0.14);
    text-align: center;
  }
  .mwx-countdown__label { font-size: 14px; line-height: 18px; opacity: 0.62; margin-bottom: 6px; }
  .mwx-countdown__digits {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: 30px;
    line-height: 36px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .mwx-countdown__bar { height: 4px; border-radius: 2px; background: rgba(127, 127, 127, 0.28); overflow: hidden; }
  .mwx-countdown__bar-fill { height: 100%; width: 100%; background: ${accent}; transition: width 1s linear; }
  .mwx-countdown__spots { font-size: 14px; line-height: 18px; opacity: 0.62; margin-top: 10px; }
</style>
<script>
(function(){var r=document.getElementById('mwx-countdown');if(!r)return;var d=document.getElementById('mwx-countdown-digits'),b=document.getElementById('mwx-countdown-bar');var n=r.parentElement,c=null;while(n){var g2=getComputedStyle(n).backgroundColor,m=g2&&g2.match(/[0-9.]+/g);if(m&&(m.length<4||parseFloat(m[3])>0.5)){c=m;break}n=n.parentElement}var lum=c?(0.299*c[0]+0.587*c[1]+0.114*c[2]):255;r.style.color=lum>140?'#111':'#fff';var t=Math.max(1,parseInt(r.getAttribute('data-mwx-minutes'),10)||1)*60,s=t;function p(v){return v<10?'0'+v:''+v}function g(){d.textContent=p(Math.floor(t/3600))+':'+p(Math.floor(t%3600/60))+':'+p(t%60);b.style.width=(t/s*100)+'%'}g();var i=setInterval(function(){if(t<=0){clearInterval(i);return}t--;g()},1000)})();
</script>`;
}
