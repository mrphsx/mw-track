'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plus, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { TelegramMessagePreview } from '@/components/messages/telegram-message-preview';
import { MessagePlaceholdersHint } from '@/components/message-placeholders-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export interface PushButton {
  text: string;
  url: string;
}

export type PushMediaType = 'photo' | 'video' | 'video_note';

export interface PushMediaItem {
  url: string;
  type: PushMediaType;
}

const MAX_MEDIA_ITEMS = 10;

export interface PushContent {
  name: string;
  messageText: string;
  media: PushMediaItem[];
  buttons: PushButton[];
}

interface PushContentStepProps {
  projectId: string;
  value: PushContent;
  onChange: (value: PushContent) => void;
  // Родитель блокирует "Далее" на время загрузки — раньше можно было кликнуть "Далее" сразу
  // после выбора файла, не дожидаясь конца асинхронной загрузки, и черновик пуша создавался
  // без media вообще (баг-репорт пользователя 2026-07-18: реальный кейс с потерянным фото).
  onUploadingChange?: (isUploading: boolean) => void;
}

export function PushContentStep({ projectId, value, onChange, onUploadingChange }: PushContentStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<PushContent>) => onChange({ ...value, ...patch });
  const [uploadError, setUploadError] = useState('');

  // Тип следующего добавляемого элемента (не хранится в PushContent — это состояние формы
  // "что добавить дальше", а не часть данных рассылки).
  const [nextType, setNextType] = useState<PushMediaType>('photo');
  const [manualUrl, setManualUrl] = useState('');

  const hasVideoNote = value.media.some((m) => m.type === 'video_note');
  // Кружок нельзя отправить вместе с другими медиа в одной рассылке (Bot API: sendMediaGroup
  // не принимает video_note) — запрос пользователя 2026-07-17 "как загрузить больше медиа в
  // одну рассылку" привёл к альбомам, а это ограничение сразу всплыло как побочное правило.
  const canAddMore = value.media.length < MAX_MEDIA_ITEMS && !hasVideoNote;
  const canPickVideoNote = value.media.length === 0;

  const addMedia = (item: PushMediaItem) => update({ media: [...value.media, item] });
  const removeMedia = (i: number) => update({ media: value.media.filter((_, idx) => idx !== i) });

  // Загрузка медиа с устройства (запрос пользователя 2026-07-17) — тот же паттерн, что уже
  // используется для welcome-media/scenario-media бота: скрытый <input type="file"> +
  // кнопка-триггер, FormData на бэкенд. Каждый файл — отдельный вызов, добавляется в массив.
  const uploadMedia = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', nextType);
      const res = await api.post<{ url: string }>(`/projects/${projectId}/pushes/media`, formData);
      return res.data.url;
    },
    onSuccess: (url) => addMedia({ url, type: nextType }),
    onError: (err) => setUploadError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл'),
  });

  useEffect(() => {
    onUploadingChange?.(uploadMedia.isPending);
  }, [uploadMedia.isPending, onUploadingChange]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    // Размер до обрезки ничего не говорит о размере после (сервер сам обрезает видео для
    // кружка по центру до квадрата — см. VideoProcessingService), поэтому здесь больше нет
    // предварительной проверки на 12MB — итоговый лимит проверяется на бэкенде уже после
    // обрезки, там же и понятная ошибка, если не влезло даже после неё.
    uploadMedia.mutate(file);
  };

  const handleAddManualUrl = () => {
    if (!manualUrl.trim()) return;
    addMedia({ url: manualUrl.trim(), type: nextType });
    setManualUrl('');
  };

  const addButton = () => {
    if (value.buttons.length >= 3) return;
    update({ buttons: [...value.buttons, { text: '', url: '' }] });
  };

  const updateButton = (i: number, patch: Partial<PushButton>) => {
    const buttons = value.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    update({ buttons });
  };

  const removeButton = (i: number) => update({ buttons: value.buttons.filter((_, idx) => idx !== i) });

  const isAlbum = value.media.length > 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Название рассылки (внутреннее)</Label>
          <Input id="name" value={value.name} onChange={(e) => update({ name: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="messageText">Текст сообщения</Label>
          <Textarea
            id="messageText"
            rows={6}
            value={value.messageText}
            onChange={(e) => update({ messageText: e.target.value })}
            placeholder="Поддерживаются HTML-теги Telegram: <b>, <i>, <u>, <code>"
          />
          <MessagePlaceholdersHint onInsert={(token) => update({ messageText: value.messageText + token })} />
          <div className="text-xs text-muted-foreground text-right">{value.messageText.length} / 4096</div>
          {hasVideoNote && (
            <p className="text-xs text-amber-600">
              Кружок не поддерживает подпись — текст уйдёт отдельным сообщением сразу следом.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Медиа (альбом, до {MAX_MEDIA_ITEMS})</Label>

          {value.media.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {value.media.map((item, i) => (
                <div key={i} className="relative rounded-md overflow-hidden border aspect-square bg-muted">
                  {item.type === 'photo' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={item.url} className="w-full h-full object-cover" />
                  )}
                  {item.type === 'video_note' && (
                    <span className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] px-1 rounded">кружок</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(i)}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {canAddMore && (
            <>
              <div className="flex gap-2">
                <Input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://... или загрузите файл"
                />
                <select
                  className="border rounded-md text-sm px-2"
                  value={nextType}
                  onChange={(e) => setNextType(e.target.value as PushMediaType)}
                >
                  <option value="photo">Фото</option>
                  <option value="video">Видео</option>
                  {canPickVideoNote && <option value="video_note">Кружок (видео, обрежется до квадрата и 60 сек)</option>}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={nextType === 'photo' ? 'image/*' : 'video/*'}
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMedia.isPending}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {uploadMedia.isPending ? 'Загружаем...' : 'Загрузить с устройства'}
                </Button>
                {manualUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleAddManualUrl}>
                    Добавить по ссылке
                  </Button>
                )}
              </div>
            </>
          )}
          {hasVideoNote && (
            <p className="text-xs text-muted-foreground">Кружок можно отправить только один, без альбома — уберите его, чтобы добавить другие файлы.</p>
          )}
          {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
        </div>

        <div className="space-y-2">
          <Label>Кнопки (до 3)</Label>
          {isAlbum && value.buttons.length > 0 && (
            <p className="text-xs text-amber-600">В альбоме Telegram кнопки не поддерживаются — уйдут отдельным сообщением следом.</p>
          )}
          {value.buttons.map((button, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Текст кнопки"
                value={button.text}
                onChange={(e) => updateButton(i, { text: e.target.value })}
              />
              <Input placeholder="URL" value={button.url} onChange={(e) => updateButton(i, { url: e.target.value })} />
              <Button size="icon" variant="ghost" onClick={() => removeButton(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {value.buttons.length < 3 && (
            <Button variant="outline" size="sm" onClick={addButton}>
              <Plus className="w-4 h-4 mr-1.5" /> Добавить кнопку
            </Button>
          )}
        </div>
      </div>

      <TelegramMessagePreview text={value.messageText} media={value.media} buttons={value.buttons} />
    </div>
  );
}
