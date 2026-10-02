// Дополнительный попап лендинга (запрос клиентов через пользователя 2026-10-02: "нужно добавить
// ещё одну настройку, дополнительный попап, он будет работать точно как попап с вопросом есть ли
// тебе 18 на лендинге «Проверка возраста + приглашение»"). Доступен для ЛЮБОГО лендинга, который
// рендерим мы сами (TEMPLATE любого шаблона + CUSTOM ZIP), КРОМЕ самого age-gate-invite — у того
// такой попап уже встроен в собственный template.html, второй поверх него был бы дублем.
//
// Разметка вставляется сервером в готовый HTML (LandingRendererService.injectTrackingScripts), а
// не рисуется SDK: тег track.js грузится с async, то есть попап, нарисованный скриптом, появился
// бы уже ПОСЛЕ отрисовки самого лендинга — посетитель успел бы увидеть то, что попап и должен
// закрывать. Визуальный язык (белая карточка со скруглением, серый вопрос, кнопки в ряд) повторяет
// попап 1 из age-gate-invite, чтобы поведение совпадало не только логикой, но и видом.

// Единственный шаблон, у которого такой попап уже есть в собственном template.html.
export const AGE_GATE_TEMPLATE_ID = 'age-gate-invite';

export type ExtraPopupAction = 'NEXT_STEP' | 'FINAL' | 'NONE';

export const EXTRA_POPUP_ACTIONS: ExtraPopupAction[] = ['NEXT_STEP', 'FINAL', 'NONE'];

export interface ExtraPopupButton {
  text: string;
  action: ExtraPopupAction;
}

export interface ExtraPopupConfig {
  title: string;
  text: string;
  buttons: ExtraPopupButton[];
}

export const MAX_EXTRA_POPUP_BUTTONS = 4;

// Дефолт ровно тот, что задал пользователь: вопрос про 18 лет, кнопки «Да»/«Нет», «Да» ведёт на
// следующий шаг (сам лендинг), «Нет» — сразу на конечный ресурс. Включил переключатель и ничего
// не настраивал — получает именно это.
export const EXTRA_POPUP_DEFAULTS: ExtraPopupConfig = {
  title: 'Тебе есть 18 лет?',
  text: 'Подтвердите возраст, чтобы продолжить',
  buttons: [
    { text: 'Да', action: 'NEXT_STEP' },
    { text: 'Нет', action: 'FINAL' },
  ],
};

// Пустая строка/отсутствующий ключ = взять дефолт для ЭТОГО ключа (тот же принцип, что у текстов
// подсказки TikTok), поэтому арендатору не нужен отдельный способ "сбросить одно поле".
export function resolveExtraPopup(raw: unknown): ExtraPopupConfig {
  const config = (raw && typeof raw === 'object' ? raw : {}) as Partial<ExtraPopupConfig>;

  const buttons = (Array.isArray(config.buttons) ? config.buttons : [])
    .filter((b): b is ExtraPopupButton => !!b && typeof b.text === 'string' && b.text.trim().length > 0)
    .slice(0, MAX_EXTRA_POPUP_BUTTONS)
    .map((b) => ({ text: b.text.trim(), action: EXTRA_POPUP_ACTIONS.includes(b.action) ? b.action : 'NONE' }));

  return {
    title: (typeof config.title === 'string' && config.title.trim()) || EXTRA_POPUP_DEFAULTS.title,
    text: typeof config.text === 'string' && config.text.trim() ? config.text.trim() : EXTRA_POPUP_DEFAULTS.text,
    // Ни одной валидной кнопки не осталось — попап без кнопок стал бы ловушкой, из которой
    // посетитель не может выйти, поэтому возвращаем кнопки по умолчанию.
    buttons: buttons.length > 0 ? buttons : EXTRA_POPUP_DEFAULTS.buttons,
  };
}

// Тексты вводит арендатор, а попадают они в HTML страницы — экранируем, как и любой чужой текст
// в разметке (тот же принцип, по которому попап-подсказка TikTok в SDK собирается через
// textContent, а не конкатенацией строк).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Скрипт попапа отдаётся страницей посетителя, поэтому в сам <script> ниже не идут ни
// комментарии, ни лишние пробелы — объяснения живут здесь:
//  * кнопки с data-mwx-next (действия NEXT_STEP, а также FINAL без доступной ссылки) убирают
//    оверлей и вызывают window.tcrm.triggerAutoRedirect() — тот же вызов, что делает
//    template.html у age-gate-invite в момент открытия попапа 2: пока попап висел, авторедирект и
//    подсказка TikTok были отложены (data-auto-redirect-defer / data-tiktok-hint-defer) и
//    запускаются ровно здесь;
//  * кнопки с действием NONE слушателя не получают вовсе — нажатие не делает ничего;
//  * кнопки FINAL с доступной ссылкой — обычные <a>, их обрабатывает браузер, а Lead отправляет
//    SDK по data-track="Lead".
//
// finalUrl — конечный ресурс (ссылка в Telegram/на сайт), уже готовая, та же, что подставляется в
// {{TG_REDIRECT_URL}}. Если её нет (канал без ссылки), кнопка с действием "конечный ресурс" не
// может никуда вести — она ведёт себя как "следующий шаг", то есть просто закрывает попап, а не
// остаётся мёртвой ссылкой в никуда.
export function renderExtraPopupHtml(config: ExtraPopupConfig, finalUrl: string): string {
  const buttons = config.buttons
    .map((button, index) => {
      const label = escapeHtml(button.text);
      if (button.action === 'FINAL' && finalUrl) {
        // data-track="Lead" — тот же атрибут, что и у кнопок перехода в шаблонах: событие Lead
        // отправляет сам SDK и ровно по тем правилам, что уже настроены у лендинга
        // (Landing.leadOnClick), отдельной логики отправки здесь нет.
        return `<a class="mwx-popup__btn mwx-popup__btn--primary" href="${escapeHtml(finalUrl)}" rel="noopener" data-track="Lead">${label}</a>`;
      }
      const isNext = button.action === 'NEXT_STEP' || (button.action === 'FINAL' && !finalUrl);
      return `<button class="mwx-popup__btn ${index === 0 ? 'mwx-popup__btn--primary' : 'mwx-popup__btn--secondary'}" type="button"${isNext ? ' data-mwx-next="true"' : ''}>${label}</button>`;
    })
    .join('\n      ');

  // Собственные классы с префиксом mwx- и очень высокий z-index: разметка попадает в чужую
  // вёрстку (в т.ч. в загруженный клиентом ZIP), поэтому не должна ни зависеть от её стилей, ни
  // оказаться под её элементами.
  return `
<div class="mwx-popup-overlay" id="mwx-extra-popup" role="dialog" aria-modal="true">
  <div class="mwx-popup">
    <h2 class="mwx-popup__title">${escapeHtml(config.title)}</h2>
    <p class="mwx-popup__text">${escapeHtml(config.text)}</p>
    <div class="mwx-popup__btns">
      ${buttons}
    </div>
  </div>
</div>
<style>
  .mwx-popup-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.55);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .mwx-popup {
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    padding: 24px 32px;
    max-width: 360px;
    width: 100%;
    text-align: center;
    box-sizing: border-box;
  }
  .mwx-popup__title {
    margin: 0 0 8px;
    font-size: 26px;
    font-weight: 600;
    color: #2c3038;
  }
  .mwx-popup__text {
    margin: 0 0 24px;
    font-size: 16px;
    color: #727782;
  }
  .mwx-popup__btns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }
  .mwx-popup__btn {
    appearance: none;
    border: 0;
    border-radius: 18px;
    padding: 16px 20px;
    font-size: 18px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s ease;
  }
  .mwx-popup__btn--primary {
    background-color: #3b76f6;
    color: #fff;
  }
  .mwx-popup__btn--secondary {
    background-color: #f0f2f5;
    color: #2c3038;
  }
  @media (hover: hover) {
    .mwx-popup__btn--primary:hover { background-color: #2563eb; }
    .mwx-popup__btn--secondary:hover { background-color: #e4e6eb; }
  }
  @media (max-width: 380px) {
    .mwx-popup { padding: 24px 18px; }
    .mwx-popup__title { font-size: 24px; }
  }
</style>
<script>
(function(){var o=document.getElementById('mwx-extra-popup');if(!o)return;var b=o.querySelectorAll('[data-mwx-next="true"]');for(var i=0;i<b.length;i++){b[i].addEventListener('click',function(){if(o.parentNode)o.parentNode.removeChild(o);if(window.tcrm&&typeof window.tcrm.triggerAutoRedirect==='function')window.tcrm.triggerAutoRedirect();});}})();
</script>`;
}
