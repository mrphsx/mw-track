'use client';

// Общий редактор "текст + медиа + кнопки" для сообщений бота — приветствие (Channel.
// tgWelcomeMessage) и сценарии (BotScenario.messageText), та же форма контента везде.
// Вынесено из bot-settings-tab.tsx при добавлении сценариев (2026-07-03) — без этого
// пришлось бы дублировать редактор в 5+ местах (4 синглтон-сценария + N команд).

import { useRef, useState } from 'react';
import { Plus, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const MEDIA_TYPES = ['NONE', 'PHOTO', 'VIDEO', 'VIDEO_NOTE', 'VOICE', 'DOCUMENT'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_TYPE_LABEL: Record<MediaType, string> = {
  NONE: 'Без медиа',
  PHOTO: 'Фото',
  VIDEO: 'Видео',
  VIDEO_NOTE: 'Кружок (видео-заметка)',
  VOICE: 'Голосовое',
  DOCUMENT: 'Документ',
};

// Свободный accept — Telegram сам отклонит файл, если он не подходит под конкретный тип
// (например, видео не квадратное для кружка); дублировать эту валидацию на фронте не нужно.
const MEDIA_TYPE_ACCEPT: Record<MediaType, string> = {
  NONE: '',
  PHOTO: 'image/*',
  VIDEO: 'video/*',
  VIDEO_NOTE: 'video/*',
  VOICE: 'audio/*',
  DOCUMENT: '*/*',
};

export interface MessageButton {
  text: string;
  url: string;
}

export interface MessageContent {
  text: string;
  buttons: MessageButton[];
  mediaType: MediaType;
}

export const EMPTY_MESSAGE_CONTENT: MessageContent = { text: '', buttons: [], mediaType: 'NONE' };

// existingMediaType — что реально сохранено на сервере (для бейджа "файл загружен"), отдельно
// от content.mediaType — выбранного в форме типа, который меняется до реальной загрузки файла.
// Сама загрузка/удаление — колбэки наружу: у приветствия и у сценариев разные эндпоинты
// (PATCH .../welcome-media vs .../scenarios/:id/media), компонент про это не знает.
export function ScenarioMessageEditor({
  idPrefix,
  content,
  onChange,
  existingMediaType,
  onUploadMedia,
  onRemoveMedia,
  uploadPending,
  removePending,
}: {
  idPrefix: string;
  content: MessageContent;
  onChange: (patch: Partial<MessageContent>) => void;
  existingMediaType: MediaType | null;
  onUploadMedia: (file: File, mediaType: MediaType) => void;
  onRemoveMedia: () => void;
  uploadPending: boolean;
  removePending: boolean;
}) {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setMediaFile(file);
  };

  const addButton = () => onChange({ buttons: [...content.buttons, { text: '', url: '' }] });
  const updateButton = (i: number, patch: Partial<MessageButton>) =>
    onChange({ buttons: content.buttons.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)) });
  const removeButton = (i: number) => onChange({ buttons: content.buttons.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-text`}>Текст</Label>
        <Textarea
          id={`${idPrefix}-text`}
          rows={4}
          placeholder="Например: Спасибо за депозит! 🎉"
          value={content.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {content.mediaType === 'VIDEO_NOTE' && (
          <p className="text-xs text-gray-400">
            У «кружков» Telegram не поддерживает подпись — текст уйдёт отдельным сообщением сразу следом.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Медиа</Label>
        <Select value={content.mediaType} onValueChange={(v) => v && onChange({ mediaType: v as MediaType })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEDIA_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {MEDIA_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {content.mediaType !== 'NONE' && (
          <div className="space-y-2">
            {existingMediaType && !mediaFile && (
              <div className="flex items-center justify-between gap-2 border rounded-md p-2 text-sm">
                <span className="text-gray-500">Файл загружен ({MEDIA_TYPE_LABEL[existingMediaType]})</span>
                <Button size="sm" variant="ghost" onClick={onRemoveMedia} disabled={removePending}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 text-gray-500 hover:border-gray-400'
              }`}
            >
              <UploadCloud className="w-5 h-5 mx-auto mb-1.5" />
              {mediaFile ? mediaFile.name : 'Перетащите файл сюда или нажмите для выбора'}
              <input
                ref={fileInputRef}
                type="file"
                accept={MEDIA_TYPE_ACCEPT[content.mediaType]}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {mediaFile && (
              <Button
                size="sm"
                onClick={() => {
                  onUploadMedia(mediaFile, content.mediaType);
                  setMediaFile(null);
                }}
                disabled={uploadPending}
              >
                {uploadPending ? 'Загружаем...' : 'Загрузить файл'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Кнопки (до 3)</Label>
        {content.buttons.map((button, i) => (
          <div key={i} className="flex gap-2">
            <Input placeholder="Текст кнопки" value={button.text} onChange={(e) => updateButton(i, { text: e.target.value })} />
            <Input placeholder="https://..." value={button.url} onChange={(e) => updateButton(i, { url: e.target.value })} />
            <Button size="icon" variant="ghost" onClick={() => removeButton(i)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
        {content.buttons.length < 3 && (
          <Button variant="outline" size="sm" onClick={addButton}>
            <Plus className="w-4 h-4 mr-1.5" /> Добавить кнопку
          </Button>
        )}
      </div>
    </div>
  );
}
