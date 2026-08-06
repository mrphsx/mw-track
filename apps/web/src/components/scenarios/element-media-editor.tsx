'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { CONTENT_TYPE_META, ElementContentType, ScenarioMediaItem, ScenarioMediaType } from '@/lib/scenarios';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MAX_ALBUM_ITEMS = 10;

const SINGLE_TYPE_ACCEPT: Record<'PHOTO' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE', string> = {
  PHOTO: 'image/*',
  VIDEO: 'video/*',
  VIDEO_NOTE: 'video/*',
  VOICE: 'audio/*',
};

const SINGLE_TYPE_MEDIA_TYPE: Record<'PHOTO' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE', ScenarioMediaType> = {
  PHOTO: 'photo',
  VIDEO: 'video',
  VIDEO_NOTE: 'video_note',
  VOICE: 'voice',
};

interface ElementMediaEditorProps {
  channelId: string;
  contentType: Exclude<ElementContentType, 'TEXT'>;
  value: ScenarioMediaItem[];
  onChange: (media: ScenarioMediaItem[]) => void;
}

// Медиа для элемента сценария — параметризовано выбранным типом контента элемента (запрос
// пользователя 2026-07-25: один тип на элемент, никакого смешивания фото+кружок+голосовое в
// одном сообщении). PHOTO/VIDEO/VIDEO_NOTE/VOICE — ровно один файл, ALBUM — от 2 до 10
// фото/видео (то же ограничение Bot API sendMediaGroup, что и раньше: без кружка/голосового
// в альбоме). Заменяет step-media-gallery.tsx (был один универсальный список на все типы сразу).
export function ElementMediaEditor({ channelId, contentType, value, onChange }: ElementMediaEditorProps) {
  if (contentType === 'ALBUM') {
    return <AlbumEditor channelId={channelId} value={value} onChange={onChange} />;
  }
  return <SingleFileEditor channelId={channelId} contentType={contentType} value={value} onChange={onChange} />;
}

function useUploadMutation(channelId: string, mediaType: string, onUploaded: (item: ScenarioMediaItem) => void) {
  const [uploadError, setUploadError] = useState('');
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', mediaType);
      const res = await api.post<{ url: string }>(`/channels/${channelId}/scenario-step-media`, formData);
      return res.data.url;
    },
    onSuccess: (url) => {
      onUploaded({ url, type: mediaType as ScenarioMediaType });
      setUploadError('');
    },
    onError: (err) => setUploadError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл'),
  });
  return { ...mutation, uploadError };
}

function SingleFileEditor({
  channelId,
  contentType,
  value,
  onChange,
}: {
  channelId: string;
  contentType: 'PHOTO' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';
  value: ScenarioMediaItem[];
  onChange: (media: ScenarioMediaItem[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaType = SINGLE_TYPE_MEDIA_TYPE[contentType];
  const upload = useUploadMutation(channelId, mediaType, (item) => onChange([item]));
  const current = value[0];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  };

  if (current) {
    return (
      <div className="flex items-center justify-between gap-2 border rounded-md p-2 text-sm">
        <span className="text-muted-foreground truncate">{CONTENT_TYPE_META[contentType].label} загружено</span>
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors border-border text-muted-foreground hover:border-muted-foreground"
      >
        <Upload className="w-5 h-5 mx-auto mb-1.5" />
        {upload.isPending ? 'Загружаем...' : 'Загрузить файл'}
        <input ref={fileInputRef} type="file" accept={SINGLE_TYPE_ACCEPT[contentType]} className="hidden" onChange={handleFileSelect} />
      </div>
      {upload.uploadError && <p className="text-xs text-red-500">{upload.uploadError}</p>}
      {contentType === 'VIDEO_NOTE' && (
        <p className="text-xs text-muted-foreground">Видео любого формата и разрешения — само обрежется в квадрат под кружок на сервере.</p>
      )}
    </div>
  );
}

function AlbumEditor({ channelId, value, onChange }: { channelId: string; value: ScenarioMediaItem[]; onChange: (media: ScenarioMediaItem[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nextType, setNextType] = useState<'photo' | 'video'>('photo');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const uploadOne = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', nextType);
      const res = await api.post<{ url: string }>(`/channels/${channelId}/scenario-step-media`, formData);
      return { url: res.data.url, type: nextType } satisfies ScenarioMediaItem;
    },
  });

  const canAddMore = value.length < MAX_ALBUM_ITEMS;
  const removeMedia = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  // Мульти-выбор (запрос пользователя 2026-08-04: "можно было выделить несколько фотографий и
  // загрузить") — выбранные файлы лишние сверх лимита альбома просто отбрасываются с понятным
  // сообщением, остальные загружаются ПОСЛЕДОВАТЕЛЬНО (не параллельно): backend принимает один
  // файл за запрос, а at onChange нужен актуальный массив — конкурентные мутации читали бы
  // устаревший `value` через замыкание и теряли бы уже добавленные элементы (последний успешный
  // ответ перезаписал бы предыдущие). Останавливаемся на первой ошибке — то, что успело
  // загрузиться, остаётся в альбоме.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    const remaining = MAX_ALBUM_ITEMS - value.length;
    const toUpload = files.slice(0, remaining);
    const dropped = files.length - toUpload.length;
    setUploadError(dropped > 0 ? `Лимит альбома — ${MAX_ALBUM_ITEMS}, лишние ${dropped} файл(ов) не загружены.` : '');

    setIsUploading(true);
    let current = value;
    for (const file of toUpload) {
      try {
        const item = await uploadOne.mutateAsync(file);
        current = [...current, item];
        onChange(current);
      } catch (err) {
        setUploadError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл');
        break;
      }
    }
    setIsUploading(false);
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {value.map((item, i) => (
            <div key={i} className="relative rounded-md overflow-hidden border aspect-square bg-muted">
              {item.type === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt="" className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={item.url} className="w-full h-full object-cover" />
              )}
              <button type="button" onClick={() => removeMedia(i)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <div className="flex items-center gap-2">
          <Select value={nextType} onValueChange={(v) => v && setNextType(v as 'photo' | 'video')}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="photo">Фото</SelectItem>
              <SelectItem value="video">Видео</SelectItem>
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={nextType === 'photo' ? 'image/*' : 'video/*'}
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {isUploading ? 'Загружаем...' : `Добавить (${value.length}/${MAX_ALBUM_ITEMS})`}
          </Button>
        </div>
      )}
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}
