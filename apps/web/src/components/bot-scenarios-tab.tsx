'use client';

// Вкладка "Сценарии" — команды бота + реакции на события (первый/повторный депозит,
// отписка) + дефолтное сообщение на нераспознанный текст. Запрос пользователя 2026-07-03,
// работает для любого Telegram-режима с реальным ботом (не PERSONAL_DM), шире, чем
// приветственное сообщение (только PRIVATE_CHANNEL_REQUEST) — см. bot-settings-tab.tsx.
// Аккордеон (2026-07-03, отдельный запрос) — иначе 4 синглтон-сценария + N команд, каждый
// с полным редактором текста/медиа/кнопок, разворачивались бы в очень длинную страницу.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import {
  MediaType,
  MessageButton,
  MessageContent,
  EMPTY_MESSAGE_CONTENT,
  ScenarioMessageEditor,
} from '@/components/scenario-message-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type TriggerType = 'COMMAND' | 'FIRST_DEPOSIT' | 'REPEAT_DEPOSIT' | 'UNSUBSCRIBE' | 'DEFAULT';

interface BotScenario {
  id: string;
  triggerType: TriggerType;
  command: string;
  isActive: boolean;
  delaySeconds: number;
  messageText: string | null;
  mediaType: MediaType | null;
  buttons: MessageButton[] | null;
}

const SINGLETON_TRIGGERS: { type: Exclude<TriggerType, 'COMMAND'>; title: string; description: string }[] = [
  { type: 'FIRST_DEPOSIT', title: 'Первый депозит', description: 'Отправляется после первой покупки клиента.' },
  { type: 'REPEAT_DEPOSIT', title: 'Повторный депозит', description: 'Отправляется после второй и последующих покупок.' },
  { type: 'UNSUBSCRIBE', title: 'Отписка', description: 'Отправляется, когда клиент покидает канал или блокирует бота.' },
  {
    type: 'DEFAULT',
    title: 'Дефолтное сообщение',
    description: 'Ответ на любой текст, не подошедший ни под одну команду — без ограничений, срабатывает на каждое такое сообщение.',
  },
];

function toContent(s: BotScenario | null): MessageContent {
  if (!s) return EMPTY_MESSAGE_CONTENT;
  return { text: s.messageText || '', buttons: s.buttons || [], mediaType: s.mediaType || 'NONE' };
}

export function BotScenariosTab({ channelId }: { channelId: string }) {
  const { data: scenarios } = useQuery({
    queryKey: ['channel', channelId, 'scenarios'],
    queryFn: async () => (await api.get<BotScenario[]>(`/channels/${channelId}/scenarios`)).data,
  });

  if (!scenarios) return <p className="text-sm text-gray-500">Загрузка...</p>;

  return (
    <div className="space-y-6">
      <Accordion keepMounted>
        {SINGLETON_TRIGGERS.map((t) => (
          <SingletonScenarioItem
            key={t.type}
            channelId={channelId}
            triggerType={t.type}
            title={t.title}
            description={t.description}
            existing={scenarios.find((s) => s.triggerType === t.type) || null}
          />
        ))}
      </Accordion>

      <CommandsSection channelId={channelId} commands={scenarios.filter((s) => s.triggerType === 'COMMAND')} />
    </div>
  );
}

// Общий "хвост" редактора — используется и в синглтон-сценариях, и в команде (диалог создания
// + элемент аккордеона для существующей) — сам редактор сообщения + поле задержки, без
// заголовка/переключателя (те у каждого места свои).
function ScenarioFormFields({
  idPrefix,
  content,
  onContentChange,
  existingMediaType,
  onUploadMedia,
  onRemoveMedia,
  uploadPending,
  removePending,
  delaySeconds,
  onDelayChange,
  mediaHint,
}: {
  idPrefix: string;
  content: MessageContent;
  onContentChange: (patch: Partial<MessageContent>) => void;
  existingMediaType: MediaType | null;
  onUploadMedia: (file: File, mediaType: MediaType) => void;
  onRemoveMedia: () => void;
  uploadPending: boolean;
  removePending: boolean;
  delaySeconds: string;
  onDelayChange: (v: string) => void;
  mediaHint?: string;
}) {
  return (
    <div className="space-y-4">
      <ScenarioMessageEditor
        idPrefix={idPrefix}
        content={content}
        onChange={onContentChange}
        existingMediaType={existingMediaType}
        onUploadMedia={onUploadMedia}
        onRemoveMedia={onRemoveMedia}
        uploadPending={uploadPending}
        removePending={removePending}
      />

      <div className="space-y-1.5">
        <Label>Задержка перед отправкой (секунд)</Label>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} max={3600} value={delaySeconds} onChange={(e) => onDelayChange(e.target.value)} className="max-w-32" />
          <span className="text-sm text-gray-500">0 — сразу</span>
        </div>
      </div>

      {mediaHint && content.mediaType !== 'NONE' && <p className="text-xs text-gray-400">{mediaHint}</p>}
    </div>
  );
}

function SingletonScenarioItem({
  channelId,
  triggerType,
  title,
  description,
  existing,
}: {
  channelId: string;
  triggerType: Exclude<TriggerType, 'COMMAND'>;
  title: string;
  description: string;
  existing: BotScenario | null;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] });

  const [content, setContent] = useState<MessageContent>(toContent(existing));
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [delaySeconds, setDelaySeconds] = useState(String(existing?.delaySeconds ?? 0));
  const [error, setError] = useState('');

  useEffect(() => {
    setContent(toContent(existing));
    setIsActive(existing?.isActive ?? true);
    setDelaySeconds(String(existing?.delaySeconds ?? 0));
  }, [existing]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        isActive,
        delaySeconds: Number(delaySeconds) || 0,
        messageText: content.text || '',
        buttons: content.buttons.filter((b) => b.text && b.url),
      };
      return existing
        ? api.patch(`/channels/${channelId}/scenarios/${existing.id}`, payload)
        : api.post(`/channels/${channelId}/scenarios`, { triggerType, ...payload });
    },
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить сценарий'),
  });

  const uploadMedia = useMutation({
    mutationFn: async ({ file, mediaType }: { file: File; mediaType: MediaType }) => {
      if (!existing) throw new Error('Сначала сохраните сценарий');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', mediaType);
      await api.post(`/channels/${channelId}/scenarios/${existing.id}/media`, formData);
    },
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл'),
  });

  const removeMedia = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/scenarios/${existing!.id}/media`),
    onSuccess: () => {
      invalidate();
      setContent((c) => ({ ...c, mediaType: 'NONE' }));
    },
  });

  return (
    <AccordionItem value={triggerType}>
      <AccordionTrigger>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span>{title}</span>
            <Badge variant={isActive ? 'outline' : 'secondary'} className="font-normal">
              {isActive ? 'Активен' : 'Выключен'}
            </Badge>
          </div>
          <p className="text-xs font-normal text-gray-500 mt-0.5">{description}</p>
        </div>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Сценарий включён</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <ScenarioFormFields
            idPrefix={triggerType.toLowerCase()}
            content={content}
            onContentChange={(patch) => setContent((c) => ({ ...c, ...patch }))}
            existingMediaType={existing?.mediaType || null}
            onUploadMedia={(file, mediaType) => uploadMedia.mutate({ file, mediaType })}
            onRemoveMedia={() => removeMedia.mutate()}
            uploadPending={uploadMedia.isPending}
            removePending={removeMedia.isPending}
            delaySeconds={delaySeconds}
            onDelayChange={setDelaySeconds}
            mediaHint={!existing ? 'Медиа можно будет загрузить после первого сохранения сценария.' : undefined}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

function CommandsSection({ channelId, commands }: { channelId: string; commands: BotScenario[] }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/channels/${channelId}/scenarios/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Команды</h2>
          <p className="text-sm text-gray-500">Произвольные команды бота (без ограничения по количеству) — например /price, /help.</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Добавить команду
        </Button>
      </div>

      {commands.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-gray-500">Команд пока нет.</CardContent>
        </Card>
      ) : (
        <Accordion keepMounted>
          {commands.map((cmd) => (
            <CommandAccordionItem key={cmd.id} channelId={channelId} command={cmd} onRemove={() => remove.mutate(cmd.id)} />
          ))}
        </Accordion>
      )}

      <NewCommandDialog channelId={channelId} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function CommandAccordionItem({ channelId, command, onRemove }: { channelId: string; command: BotScenario; onRemove: () => void }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] });

  const [content, setContent] = useState<MessageContent>(toContent(command));
  const [isActive, setIsActive] = useState(command.isActive);
  const [delaySeconds, setDelaySeconds] = useState(String(command.delaySeconds));
  const [error, setError] = useState('');

  useEffect(() => {
    setContent(toContent(command));
    setIsActive(command.isActive);
    setDelaySeconds(String(command.delaySeconds));
  }, [command]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/channels/${channelId}/scenarios/${command.id}`, {
        isActive,
        delaySeconds: Number(delaySeconds) || 0,
        messageText: content.text || '',
        buttons: content.buttons.filter((b) => b.text && b.url),
      }),
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить команду'),
  });

  const uploadMedia = useMutation({
    mutationFn: async ({ file, mediaType }: { file: File; mediaType: MediaType }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', mediaType);
      await api.post(`/channels/${channelId}/scenarios/${command.id}/media`, formData);
    },
    onSuccess: () => {
      invalidate();
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить файл'),
  });

  const removeMedia = useMutation({
    mutationFn: () => api.delete(`/channels/${channelId}/scenarios/${command.id}/media`),
    onSuccess: () => {
      invalidate();
      setContent((c) => ({ ...c, mediaType: 'NONE' }));
    },
  });

  return (
    <AccordionItem value={command.id}>
      <AccordionTrigger>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="font-mono">/{command.command}</span>
          <Badge variant={isActive ? 'outline' : 'secondary'} className="font-normal">
            {isActive ? 'Активна' : 'Выключена'}
          </Badge>
          {command.delaySeconds > 0 && <span className="text-xs font-normal text-gray-400">задержка {command.delaySeconds}с</span>}
        </div>
        {/* stopPropagation — иначе клик по кнопке удаления заодно раскрывал/скрывал панель */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </span>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Команда включена</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <ScenarioFormFields
            idPrefix={`cmd-${command.id}`}
            content={content}
            onContentChange={(patch) => setContent((c) => ({ ...c, ...patch }))}
            existingMediaType={command.mediaType}
            onUploadMedia={(file, mediaType) => uploadMedia.mutate({ file, mediaType })}
            onRemoveMedia={() => removeMedia.mutate()}
            uploadPending={uploadMedia.isPending}
            removePending={removeMedia.isPending}
            delaySeconds={delaySeconds}
            onDelayChange={setDelaySeconds}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

// Диалог только для создания новой команды — имени ещё нет, вписывать её в аккордеон
// (у элементов которого value=id) до реального сохранения смысла не имеет. Редактирование
// уже существующих команд — через CommandAccordionItem выше.
function NewCommandDialog({ channelId, open, onClose }: { channelId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [command, setCommand] = useState('');
  const [content, setContent] = useState<MessageContent>(EMPTY_MESSAGE_CONTENT);
  const [delaySeconds, setDelaySeconds] = useState('0');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCommand('');
    setContent(EMPTY_MESSAGE_CONTENT);
    setDelaySeconds('0');
    setError('');
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/channels/${channelId}/scenarios`, {
        triggerType: 'COMMAND',
        command,
        isActive: true,
        delaySeconds: Number(delaySeconds) || 0,
        messageText: content.text || '',
        buttons: content.buttons.filter((b) => b.text && b.url),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId, 'scenarios'] });
      onClose();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать команду'),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая команда</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cmd-name">Команда (без слэша)</Label>
            <Input id="cmd-name" placeholder="price" value={command} onChange={(e) => setCommand(e.target.value)} />
          </div>

          <ScenarioFormFields
            idPrefix="cmd-new"
            content={content}
            onContentChange={(patch) => setContent((c) => ({ ...c, ...patch }))}
            existingMediaType={null}
            onUploadMedia={() => {}}
            onRemoveMedia={() => {}}
            uploadPending={false}
            removePending={false}
            delaySeconds={delaySeconds}
            onDelayChange={setDelaySeconds}
            mediaHint="Медиа можно будет загрузить после первого сохранения команды."
          />

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => save.mutate()} disabled={!command || save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
