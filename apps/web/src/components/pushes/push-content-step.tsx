'use client';

import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface PushButton {
  text: string;
  url: string;
}

export interface PushContent {
  name: string;
  messageText: string;
  mediaUrl: string;
  mediaType: 'photo' | 'video';
  buttons: PushButton[];
}

interface PushContentStepProps {
  value: PushContent;
  onChange: (value: PushContent) => void;
}

export function PushContentStep({ value, onChange }: PushContentStepProps) {
  const update = (patch: Partial<PushContent>) => onChange({ ...value, ...patch });

  const addButton = () => {
    if (value.buttons.length >= 3) return;
    update({ buttons: [...value.buttons, { text: '', url: '' }] });
  };

  const updateButton = (i: number, patch: Partial<PushButton>) => {
    const buttons = value.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    update({ buttons });
  };

  const removeButton = (i: number) => update({ buttons: value.buttons.filter((_, idx) => idx !== i) });

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
          <div className="text-xs text-gray-400 text-right">{value.messageText.length} / 4096</div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mediaUrl">Медиа (URL изображения/видео, опционально)</Label>
          <div className="flex gap-2">
            <Input id="mediaUrl" value={value.mediaUrl} onChange={(e) => update({ mediaUrl: e.target.value })} placeholder="https://..." />
            <select
              className="border rounded-md text-sm px-2"
              value={value.mediaType}
              onChange={(e) => update({ mediaType: e.target.value as 'photo' | 'video' })}
            >
              <option value="photo">Фото</option>
              <option value="video">Видео</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Кнопки (до 3)</Label>
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

      <div>
        <Label className="mb-2 block">Предпросмотр</Label>
        <Card className="bg-[#e7f3ff] border-0">
          <CardContent className="p-4">
            <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-sm">
              {value.mediaUrl && value.mediaType === 'photo' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.mediaUrl} alt="" className="w-full max-h-48 object-cover" />
              )}
              <div className="p-3 space-y-2">
                <p className="text-sm whitespace-pre-wrap break-words">{value.messageText || 'Текст сообщения...'}</p>
                {value.buttons
                  .filter((b) => b.text)
                  .map((b, i) => (
                    <div key={i} className="border border-blue-200 text-blue-600 text-sm text-center rounded-md py-1.5">
                      {b.text}
                    </div>
                  ))}
                <div className="text-right text-[11px] text-gray-400">12:34</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
