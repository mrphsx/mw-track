'use client';

// Общий предпросмотр сообщения бота "как реально покажет Telegram" — вынесено из
// PushContentStep (apps/web/src/components/pushes/push-content-step.tsx) при добавлении того
// же превью сценариям и приветственному сообщению (запрос пользователя 2026-07-23: "так же как
// для пушей html разметку и превью текста, сделай и для приветственного сообщения и
// сценариев") — используется и пушами, и шагом SEND_MESSAGE сценария (у обоих одинаковый
// формат медиа: {type, url}[], до 10 файлов, кружок только в одиночку).
import { renderTelegramHtml } from '@/lib/telegram-html';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export type TelegramMessageMediaType = 'photo' | 'video' | 'video_note' | 'voice';

export interface TelegramMessageMediaItem {
  type: TelegramMessageMediaType;
  url: string;
}

const MEDIA_TYPE_LABELS: Record<TelegramMessageMediaType, string> = { photo: 'Фото', video: 'Видео', video_note: 'Кружок', voice: 'Голосовое' };

interface TelegramMessagePreviewProps {
  text: string;
  media?: TelegramMessageMediaItem[];
  buttons?: { text: string; url: string }[];
  label?: string;
}

export function TelegramMessagePreview({ text, media = [], buttons = [], label = 'Предпросмотр' }: TelegramMessagePreviewProps) {
  const isAlbum = media.length > 1;

  return (
    <div>
      {label && <Label className="mb-2 block">{label}</Label>}
      {/* Имитация реального чата Telegram — цвета намеренно НЕ завязаны на тему CRM (light/
          dark toggle приложения), а на тему самого Telegram, т.к. предпросмотр показывает, как
          сообщение увидит получатель В TELEGRAM, а не в нашем интерфейсе. До 2026-08-05 тут был
          только светлый вариант (bg-[#e7f3ff]/bg-white без dark:) — в тёмной теме CRM это давало
          яркий бело-голубой прямоугольник посреди тёмной страницы (баг-репорт пользователя:
          "не по общему дизайну"); добавлены dark:-варианты на основе реальной тёмной темы
          Telegram Desktop (фон чата ~#0e1621, входящий пузырь ~#182533), а не просто нейтральные
          Studio-цвета — превью остаётся честным "как это выглядит в Telegram", включая и его
          тёмный вариант. */}
      <Card className="bg-[#e7f3ff] dark:bg-[#0e1621] border-0">
        <CardContent className="p-4">
          <div className="bg-white dark:bg-[#182533] rounded-lg shadow-sm overflow-hidden max-w-sm">
            {media.length === 1 && media[0].type === 'photo' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media[0].url} alt="" className="w-full max-h-48 object-cover" />
            )}
            {media.length === 1 && (media[0].type === 'video' || media[0].type === 'video_note') && (
              <div className="relative">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={media[0].url} controls className="w-full max-h-48 object-cover" />
                {media[0].type === 'video_note' && (
                  <span className="absolute top-2 left-2 bg-black/60 text-white text-[11px] px-1.5 py-0.5 rounded">будет кружком</span>
                )}
              </div>
            )}
            {media.length === 1 && media[0].type === 'voice' && (
              <div className="p-3">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio src={media[0].url} controls className="w-full" />
              </div>
            )}
            {isAlbum && (
              <div className="grid grid-cols-2 gap-0.5">
                {media.slice(0, 4).map((item, i) => (
                  <div key={i} className="relative aspect-square bg-gray-100 dark:bg-gray-800">
                    {item.type === 'photo' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={item.url} className="w-full h-full object-cover" />
                    )}
                    {i === 3 && media.length > 4 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-semibold">
                        +{media.length - 4}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="p-3 space-y-2">
              {text ? (
                <p
                  className="text-sm whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100"
                  dangerouslySetInnerHTML={{ __html: renderTelegramHtml(text) }}
                />
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Текст сообщения...</p>
              )}
              {!isAlbum &&
                buttons
                  .filter((b) => b.text)
                  .map((b, i) => (
                    <div
                      key={i}
                      className="border border-blue-200 dark:border-blue-400/30 text-blue-600 dark:text-blue-400 text-sm text-center rounded-md py-1.5"
                    >
                      {b.text}
                    </div>
                  ))}
              <div className="text-right text-[11px] text-gray-400 dark:text-gray-500">12:34</div>
            </div>
          </div>
          {isAlbum && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Альбом: {media.length} файл(ов) — {media.map((m) => MEDIA_TYPE_LABELS[m.type]).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
