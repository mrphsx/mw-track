'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Mic, Plus, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { TelegramMessagePreview } from '@/components/messages/telegram-message-preview';
import { MessagePlaceholdersHint } from '@/components/message-placeholders-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface PushButton {
  text: string;
  url: string;
}

export type PushMediaType = 'photo' | 'video' | 'video_note' | 'voice';

export interface PushMediaItem {
  url: string;
  type: PushMediaType;
  // Ключ хранилища — только для внутреннего использования этим компонентом (переключение
  // видео↔кружок без повторной загрузки/обрезки, см. toggleVideoNote). НЕ часть данных
  // рассылки — composer'ы обязаны вырезать это поле перед отправкой на бэкенд (PushMediaDto
  // не знает про key, глобальный ValidationPipe с forbidNonWhitelisted отклонил бы лишнее поле).
  key?: string;
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
  // Родитель блокирует сабмит на время загрузки — раньше можно было отправить сразу после
  // выбора файла, не дожидаясь конца асинхронной загрузки, и рассылка уходила без media вообще
  // (баг-репорт пользователя 2026-07-18: реальный кейс с потерянным фото).
  onUploadingChange?: (isUploading: boolean) => void;
}

// Определяем тип медиа по самому файлу (запрос пользователя 2026-08-05: "просто контейнер куда
// загрузить данные... система сама поймет что за тип") — раньше пользователь выбирал тип из
// выпадающего списка ДО загрузки; теперь один контейнер, тип угадывается по MIME. Видео всегда
// сначала грузится как обычное 'video' — превращение в кружок ("рядом с ним можно будет
// выбрать") происходит отдельным действием ПОСЛЕ загрузки, см. toggleVideoNote.
function classifyFile(file: File): PushMediaType | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'voice';
  return null;
}

export function PushContentStep({ projectId, value, onChange, onUploadingChange }: PushContentStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<PushContent>) => onChange({ ...value, ...patch });
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const hasVideoNote = value.media.some((m) => m.type === 'video_note');
  // video_note и voice — оба "одиночные" типы у Bot API (sendMediaGroup не принимает ни то, ни
  // другое) — тот же принцип, что и на бэкенде (PushesService.assertValidMedia).
  const hasSoloMedia = value.media.some((m) => m.type === 'video_note' || m.type === 'voice');
  const canAddMore = value.media.length < MAX_MEDIA_ITEMS && !hasSoloMedia;

  const replaceMedia = (index: number, item: PushMediaItem) =>
    update({ media: value.media.map((m, i) => (i === index ? item : m)) });
  const removeMedia = (i: number) => update({ media: value.media.filter((_, idx) => idx !== i) });

  // Загрузка медиа с устройства — тот же паттерн, что уже используется для welcome-media/
  // scenario-media бота: FormData на бэкенд, каждый файл — отдельный запрос.
  const [isUploading, setIsUploading] = useState(false);
  const uploadMedia = useMutation({
    mutationFn: async ({ file, type }: { file: File; type: PushMediaType }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', type);
      const res = await api.post<{ url: string; key: string }>(`/projects/${projectId}/pushes/media`, formData);
      return res.data;
    },
  });

  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  // Мульти-выбор + автоопределение типа (запрос пользователя 2026-08-04 про мульти-выбор,
  // 2026-08-05 про автоопределение) — лишние сверх лимита альбома или неподдерживаемые файлы
  // отбрасываются с понятным сообщением, остальные грузятся ПОСЛЕДОВАТЕЛЬНО (не параллельно):
  // update() замыкает `value.media` из пропсов, конкурентные вызовы читали бы устаревший массив
  // и теряли бы уже добавленные элементы (тот же класс бага, что уже чинили в других местах).
  const handleFiles = async (files: File[]) => {
    setUploadError('');
    if (!files.length) return;

    if (hasSoloMedia) {
      setUploadError('Уберите кружок/голосовое, чтобы добавить другие файлы — Telegram не поддерживает их в альбоме.');
      return;
    }

    const classified: { file: File; type: PushMediaType }[] = [];
    let unsupported = 0;
    for (const file of files) {
      const type = classifyFile(file);
      if (!type) unsupported++;
      else classified.push({ file, type });
    }

    const hasVoice = classified.some((c) => c.type === 'voice');
    if (hasVoice && (classified.length > 1 || value.media.length > 0)) {
      setUploadError('Голосовое можно отправить только отдельно, без остальных медиа.');
      return;
    }

    const remaining = MAX_MEDIA_ITEMS - value.media.length;
    const toUpload = classified.slice(0, remaining);
    const dropped = classified.length - toUpload.length + unsupported;
    if (dropped > 0) setUploadError(`Лимит альбома — ${MAX_MEDIA_ITEMS}, часть файлов не загружена (неподдерживаемый формат или превышен лимит).`);

    setIsUploading(true);
    let current = value.media;
    for (const { file, type } of toUpload) {
      try {
        const { url, key } = await uploadMedia.mutateAsync({ file, type });
        current = [...current, { url, type, key }];
        update({ media: current });
      } catch (err) {
        setUploadError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл');
        break;
      }
    }
    setIsUploading(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    handleFiles(selected);
  };

  // Переключатель "видео / кружок" ПОСЛЕ загрузки (запрос пользователя 2026-08-05: "рядом с ним
  // можно будет выбрать оставить как просто видео или как кружок") — обрезка в квадрат больше
  // не привязана к моменту выбора типа перед загрузкой. Оба URL кешируются локально
  // (videoNoteCache), чтобы переключение туда-обратно не гоняло обрезку на сервере повторно —
  // только первое включение "кружка" реально бьёт по сети.
  const [videoNoteCache, setVideoNoteCache] = useState<{ video: PushMediaItem; note: PushMediaItem } | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const toggleVideoNote = async (index: number) => {
    const item = value.media[index];
    if (!item.key) return;

    if (item.type === 'video') {
      if (videoNoteCache && videoNoteCache.video.key === item.key) {
        replaceMedia(index, videoNoteCache.note);
        return;
      }
      setIsConverting(true);
      try {
        const res = await api.post<{ url: string; key: string }>(`/projects/${projectId}/pushes/media/${item.key}/to-video-note`);
        const note: PushMediaItem = { url: res.data.url, type: 'video_note', key: res.data.key };
        setVideoNoteCache({ video: item, note });
        replaceMedia(index, note);
      } catch (err) {
        setUploadError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось обрезать видео под кружок');
      } finally {
        setIsConverting(false);
      }
    } else if (item.type === 'video_note' && videoNoteCache) {
      replaceMedia(index, videoNoteCache.video);
    }
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
                <div key={i} className="space-y-1">
                  <div className="relative rounded-md overflow-hidden border aspect-square bg-muted">
                    {item.type === 'photo' && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="w-full h-full object-cover" />
                    )}
                    {(item.type === 'video' || item.type === 'video_note') && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={item.url} className="w-full h-full object-cover" />
                    )}
                    {item.type === 'voice' && (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                        <Mic className="w-6 h-6" />
                        <span className="text-[9px]">Голосовое</span>
                      </div>
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
                  {/* Переключатель видео↔кружок — только у единственного элемента-видео
                      (Bot API не пускает video_note в альбом, тот же принцип, что и hasSoloMedia
                      выше). */}
                  {value.media.length === 1 && (item.type === 'video' || item.type === 'video_note') && (
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={item.type === 'video_note'}
                        onCheckedChange={() => toggleVideoNote(i)}
                        disabled={isConverting}
                      />
                      {isConverting ? 'Обрезаем...' : 'Кружок'}
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          {canAddMore && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(Array.from(e.dataTransfer.files ?? []));
              }}
              className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-border text-muted-foreground hover:border-muted-foreground'
              }`}
            >
              <Upload className="w-5 h-5 mx-auto mb-1.5" />
              {isUploading ? 'Загружаем...' : 'Перетащите фото, видео или голосовое сюда — или нажмите, чтобы выбрать'}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}
          {hasSoloMedia && (
            <p className="text-xs text-muted-foreground">Кружок и голосовое можно отправить только по одному, без альбома — уберите, чтобы добавить другие файлы.</p>
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
