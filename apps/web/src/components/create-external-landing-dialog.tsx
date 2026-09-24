'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { LandingReviewCheck } from '@/lib/landings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReviewChecklist } from '@/components/review-checklist';

export interface ExternalLandingInfo {
  id: string;
  name: string;
  status: string;
  lastError: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

// Лендинг клиента на ЕГО собственном сервере/домене (запрос пользователя 2026-09-07) — та же
// новая сущность Landing.type==='EXTERNAL', что и на бэкенде. Две стадии в одном диалоге:
// не создан (форма имя+URL) → создан, ждёт проверки (готовый сниппет + "Проверить подключение").
// A/B-тесты для этого типа намеренно недоступны нигде в интерфейсе (по решению пользователя) —
// поэтому здесь нет ни выбора группы, ни абонирования на неё.
//
// projectId не задан (запрос пользователя 2026-09-08: та же кнопка нужна на /landings, не
// только на странице проекта) — тот же паттерн выбора проекта внутри диалога, что и у
// CreateLandingFromTemplateDialog/UploadZipLandingDialog; открытие диалога контролируется
// отдельным `open`, а не наличием projectId (иначе страница /landings, где projectId всегда
// null, не смогла бы открыть диалог вообще).
export function CreateExternalLandingDialog({
  open,
  projectId: fixedProjectId,
  landing,
  onClose,
  onInvalidate,
}: {
  open: boolean;
  projectId?: string;
  landing: ExternalLandingInfo | null;
  onClose: () => void;
  onInvalidate: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [createdLanding, setCreatedLanding] = useState<ExternalLandingInfo | null>(null);
  const [checks, setChecks] = useState<LandingReviewCheck[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const queryClient = useQueryClient();

  const needsProjectPicker = !fixedProjectId;
  const projectId = fixedProjectId || selectedProjectId;
  const current = createdLanding ?? landing;

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectOption[]>('/projects')).data,
    enabled: needsProjectPicker && open && !current,
  });

  const { data: snippet } = useQuery({
    queryKey: ['landing', current?.id, 'external-snippet'],
    queryFn: async () => (await api.get(`/landings/${current!.id}/external-snippet`)).data as { scriptTag: string; joinButtonHref: string | null },
    enabled: !!current,
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post(`/projects/${projectId}/landings/external`, { name, externalUrl: url })).data as ExternalLandingInfo,
    onSuccess: (created) => {
      setCreatedLanding(created);
      onInvalidate();
    },
  });

  const verify = useMutation({
    mutationFn: async () => (await api.post(`/landings/${current!.id}/verify-connection`)).data as { landing: ExternalLandingInfo; checks: LandingReviewCheck[] },
    onSuccess: (data) => {
      setChecks(data.checks);
      setCreatedLanding(data.landing);
      onInvalidate();
      queryClient.invalidateQueries({ queryKey: ['landing', current?.id, 'external-snippet'] });
    },
  });

  function handleClose() {
    setName('');
    setUrl('');
    setCreatedLanding(null);
    setChecks(null);
    setSelectedProjectId('');
    create.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{current ? `Подключение «${current.name}»` : 'Лендинг на вашем сервере'}</DialogTitle>
        </DialogHeader>

        {!current ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Страница остаётся полностью на вашем сервере/домене — здесь вы только заводите запись о ней, чтобы
              видеть отдельную статистику по этому лендингу.
            </p>
            {needsProjectPicker && (
              <div className="space-y-1.5">
                <Label htmlFor="ext-project">Проект</Label>
                <Select
                  items={projects?.map((p) => ({ value: p.id, label: p.name })) ?? []}
                  value={selectedProjectId || undefined}
                  onValueChange={(v) => v && setSelectedProjectId(v)}
                >
                  <SelectTrigger id="ext-project">
                    <SelectValue placeholder="Выберите проект" />
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-(--anchor-width)">
                    {projects?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ext-name">Название</Label>
              <Input id="ext-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, лендинг на моём домене" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ext-url">Адрес страницы</Label>
              <Input id="ext-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/promo" />
            </div>
            {create.isError && (
              <p className="text-sm text-red-500">
                {(isAxiosError(create.error) && create.error.response?.data?.error?.message) || 'Не удалось создать лендинг'}
              </p>
            )}
            <Button
              onClick={() => create.mutate()}
              disabled={!name.trim() || !url.trim() || (needsProjectPicker && !projectId) || create.isPending}
            >
              Создать
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>1. Вставьте тег ниже в свою страницу, перед закрывающим &lt;/head&gt;.</p>
              {snippet?.joinButtonHref && (
                <p>
                  2. Замените кнопку перехода в Telegram на пример ниже — важно скопировать её целиком, включая{' '}
                  <code className="bg-muted px-1 rounded">data-track=&quot;Lead&quot;</code>: без этого атрибута клики по кнопке не
                  засчитываются в воронке (сервер их отклоняет, а ошибка нигде не показывается на самой странице).
                </p>
              )}
              <p>{snippet?.joinButtonHref ? '3.' : '2.'} Нажмите «Проверить подключение» — система сама зайдёт на страницу и всё сверит.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ext-snippet">Тег для вставки в &lt;head&gt;</Label>
              <div className="flex gap-2 items-start">
                <Textarea id="ext-snippet" readOnly value={snippet?.scriptTag ?? ''} rows={6} className="font-mono text-xs resize-none break-all" />
                <Button size="icon" variant="outline" className="shrink-0" onClick={() => snippet && copyToClipboard(snippet.scriptTag)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {snippet?.joinButtonHref && (
              <div className="space-y-1.5">
                <Label htmlFor="ext-join-href">Пример кнопки перехода</Label>
                <div className="flex gap-2 items-start">
                  <Textarea
                    id="ext-join-href"
                    readOnly
                    value={`<a href="${snippet.joinButtonHref}" data-track="Lead">Вступить в Telegram</a>`}
                    rows={2}
                    className="font-mono text-xs resize-none break-all"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copyToClipboard(`<a href="${snippet.joinButtonHref}" data-track="Lead">Вступить в Telegram</a>`)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {checks ? (
              <ReviewChecklist checks={checks} />
            ) : (
              current.lastError && <p className="text-sm text-amber-600 dark:text-amber-400">{current.lastError}</p>
            )}

            {current.status === 'PUBLISHED' ? (
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Подключено и работает.</p>
            ) : (
              <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
                Проверить подключение
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
