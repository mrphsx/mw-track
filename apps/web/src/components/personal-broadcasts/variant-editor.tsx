'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { TelegramMessagePreview, TelegramMessageMediaItem } from '@/components/messages/telegram-message-preview';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export interface PersonalBroadcastVariant {
  messageText: string;
  mediaUrl?: string;
  buttons: { text: string; url: string }[];
}

interface Props {
  projectId: string;
  index: number;
  value: PersonalBroadcastVariant;
  onChange: (value: PersonalBroadcastVariant) => void;
  onRemove?: () => void;
  onUploadingChange?: (isUploading: boolean) => void;
}

// Один вариант контента рассылки (запрос пользователя 2026-08-06: "можно загрузить например
// 2 варианта, и половине аудитории отправится один вариант а второй половине второй") — лёгкая
// версия PushContentStep: одно медиа (не альбом — варианты сами по себе разнообразие контента,
// не нужен ещё и альбом внутри каждого), без video_note/voice — личный аккаунт шлёт обычные
// сообщения/фото/видео, не кружки. Переиспользует существующий эндпоинт загрузки медиа пушей
// (generic file storage, не push-специфичная бизнес-логика) — не плодим третий upload-пайплайн.
// Тип медиа по MIME-типу файла (тот же приём, что classifyFile в PushContentStep) — звук
// намеренно не поддержан (см. комментарий выше про video_note/voice).
function classifyFile(file: File): 'photo' | 'video' | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

export function PersonalBroadcastVariantEditor({ projectId, index, value, onChange, onRemove, onUploadingChange }: Props) {
  const update = (patch: Partial<PersonalBroadcastVariant>) => onChange({ ...value, ...patch });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  const uploadMedia = useMutation({
    mutationFn: async ({ file, type }: { file: File; type: 'photo' | 'video' }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', type);
      const res = await api.post<{ url: string }>(`/projects/${projectId}/pushes/media`, formData);
      return res.data.url;
    },
  });

  // Драг-н-дроп контейнер вместо кнопки-с-диалогом (запрос пользователя 2026-08-05: "сделай как
  // в обычной рассылке, она приятнее и удобнее") — тот же UX/визуал, что у PushContentStep,
  // только на один файл (варианты намеренно не альбом, см. комментарий класса выше).
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    const type = classifyFile(file);
    if (!type) {
      setUploadError('Поддерживаются только фото и видео');
      return;
    }
    setIsUploading(true);
    try {
      const url = await uploadMedia.mutateAsync({ file, type });
      update({ mediaUrl: url });
    } catch {
      setUploadError('Не удалось загрузить файл');
    }
    setIsUploading(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    handleFile(file);
  };

  const addButton = () => {
    if (value.buttons.length >= 3) return;
    update({ buttons: [...value.buttons, { text: '', url: '' }] });
  };
  const updateButton = (i: number, patch: Partial<{ text: string; url: string }>) =>
    update({ buttons: value.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });
  const removeButton = (i: number) => update({ buttons: value.buttons.filter((_, idx) => idx !== i) });

  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(value.mediaUrl ?? '');
  const media: TelegramMessageMediaItem[] = value.mediaUrl ? [{ url: value.mediaUrl, type: isVideo ? 'video' : 'photo' }] : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Вариант {index + 1}</Label>
          {onRemove && (
            <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <Textarea
          rows={5}
          value={value.messageText}
          onChange={(e) => update({ messageText: e.target.value })}
          placeholder="Текст сообщения... Поддерживаются HTML-теги Telegram: <b>, <i>, <u>, <code>"
        />

        <div className="space-y-1.5">
          <Label>Медиа (опционально)</Label>
          {value.mediaUrl ? (
            <div className="relative w-24 h-24 rounded-md overflow-hidden border bg-muted">
              {isVideo ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={value.mediaUrl} className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.mediaUrl} alt="" className="w-full h-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => update({ mediaUrl: undefined })}
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
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
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-border text-muted-foreground hover:border-muted-foreground'
              }`}
            >
              <Upload className="w-5 h-5 mx-auto mb-1.5" />
              {isUploading ? 'Загружаем...' : 'Перетащите фото или видео сюда — или нажмите, чтобы выбрать'}
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileSelect} />
            </div>
          )}
          {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
        </div>

        <div className="space-y-2">
          <Label>Кнопки (до 3)</Label>
          {value.buttons.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Текст кнопки" value={b.text} onChange={(e) => updateButton(i, { text: e.target.value })} />
              <Input placeholder="URL" value={b.url} onChange={(e) => updateButton(i, { url: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" onClick={() => removeButton(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {value.buttons.length < 3 && (
            <Button type="button" variant="outline" size="sm" onClick={addButton}>
              <Plus className="w-4 h-4 mr-1.5" /> Добавить кнопку
            </Button>
          )}
        </div>
      </div>

      <TelegramMessagePreview text={value.messageText} media={media} buttons={value.buttons} />
    </div>
  );
}
