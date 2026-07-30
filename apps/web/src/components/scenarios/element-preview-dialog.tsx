'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { ScenarioButton, ScenarioMediaItem } from '@/lib/scenarios';
import { TelegramMessagePreview } from '@/components/messages/telegram-message-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Превью по кнопке, не всегда развёрнутое (запрос пользователя 2026-07-25: "превью лучше убери
// изначально чтобы было удобнее, просто сделай кнопку выделенную которая будет открывать превью
// любого сообщения") — раньше TelegramMessagePreview всегда занимал вторую колонку рядом с
// формой редактирования элемента. Управляемый Dialog (open state снаружи) — тот же паттерн,
// что уже используется в scenarios/page.tsx (диалог создания команды), а не DialogTrigger.
export function ElementPreviewDialog({ text, media, buttons }: { text: string; media: ScenarioMediaItem[]; buttons: ScenarioButton[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Eye className="w-3.5 h-3.5 mr-1.5" /> Превью
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Как увидит клиент</DialogTitle>
          </DialogHeader>
          <TelegramMessagePreview text={text} media={media} buttons={buttons} label="" />
        </DialogContent>
      </Dialog>
    </>
  );
}
