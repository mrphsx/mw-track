'use client';

// Полная инструкция по структуре ZIP-архива для кастомного лендинга (запрос пользователя
// 2026-09-08: "покажи в инструкциях и структуру файлов еще для полного понимания... по пунктам
// еще все что нужно описать чтобы клиент все сделал правильно") — заменяет прежний компактный
// 4-строчный блок текста, который не показывал ни примера структуры папок, ни того, что
// проверяется после загрузки. Общий компонент, а не дублированный текст в двух деревьях —
// содержимое одинаковое для classic и Studio.
//
// variant='prelanding' (запрос пользователя 2026-09-23) — та же структура архива подходит для
// белой страницы клоакинга, но у неё нет кнопки перехода в Telegram (это decoy-страница) и не
// добавляется скрипт трекинга вообще (а не "добавляется автоматически", как у обычного
// лендинга) — пункты 3/4 отличаются, остальное идентично.
export function ZipLandingInstructions({ variant = 'landing' }: { variant?: 'landing' | 'prelanding' }) {
  return (
    <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-3">
      <div className="space-y-1.5">
        <p className="font-medium text-foreground">1. Структура архива</p>
        <p>
          <code className="bg-muted px-1 rounded">index.html</code> — строго в корне архива, не во
          вложенной папке. Остальные файлы (картинки, css, js) можно раскладывать по подпапкам как
          удобно — например:
        </p>
        <pre className="font-mono text-[11px] leading-relaxed bg-muted/70 rounded-md p-2 overflow-x-auto whitespace-pre">
{`your-landing.zip
├── index.html          ← обязательно в корне, точно так называется
├── style.css
├── script.js
└── images/
    ├── logo.png
    └── photo.jpg`}
        </pre>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-foreground">2. Ссылки на файлы в index.html</p>
        <p>Указывайте относительный путь, совпадающий с реальным расположением файла в архиве:</p>
        <pre className="font-mono text-[11px] leading-relaxed bg-muted/70 rounded-md p-2 overflow-x-auto whitespace-pre">
{`<link rel="stylesheet" href="style.css">
<img src="images/photo.jpg">
<script src="script.js"></script>`}
        </pre>
      </div>

      {variant === 'landing' && (
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">3. Кнопка перехода (обязательно)</p>
          <p>
            Вместо реальной ссылки на канал вставьте специальную метку — система сама подставит
            настоящую ссылку с трекингом при показе страницы:
          </p>
          <pre className="font-mono text-[11px] leading-relaxed bg-muted/70 rounded-md p-2 overflow-x-auto whitespace-pre">
{`<a href="{{TG_REDIRECT_URL}}">Вступить в канал</a>`}
          </pre>
        </div>
      )}

      <div className="space-y-1">
        <p className="font-medium text-foreground">4. Скрипт трекинга</p>
        <p>
          {variant === 'landing'
            ? 'Добавлять в HTML не нужно — система вставляет его сама при каждой отдаче страницы.'
            : 'Скрипт трекинга НЕ добавляется — white page не отслеживается, посетитель, попавший на неё, не учитывается в статистике.'}
        </p>
      </div>

      <div className="space-y-1">
        <p className="font-medium text-foreground">5. Проверка после загрузки</p>
        <p>
          После загрузки система автоматически проверит: что <code className="bg-muted px-1 rounded">index.html</code> —
          рабочий HTML{variant === 'landing' ? ', что кнопка перехода настроена' : ''} и что все
          ссылки на файлы (картинки/css/js) действительно есть в архиве.{' '}
          {variant === 'landing'
            ? 'Если что-то не так — лендинг сохранится черновиком с точным списком, что исправить, и его можно будет перезалить.'
            : 'Если что-то не так — архив будет полностью отклонён (не станет активной white page) с точным списком, что исправить, и его можно будет загрузить заново.'}
        </p>
      </div>

      <div className="space-y-1">
        <p className="font-medium text-foreground">6. Ограничение</p>
        <p>Максимальный размер архива — 50 МБ.</p>
      </div>
    </div>
  );
}
