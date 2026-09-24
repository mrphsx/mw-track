'use client';

// Диалог загрузки/перезаливки кастомного (ZIP) лендинга — вынесен в отдельный компонент из
// project-scoped страницы /projects/[id]/landings (запрос пользователя 2026-09-08: "Добавь еще
// кнопки загрузки zip... на странице /landings а не только на странице лэндингов проекта"), тот
// же паттерн, что и у CreateLandingFromTemplateDialog/CreateExternalLandingDialog: если
// projectId не передан явно — внутри диалога появляется обязательный выбор проекта (страница
// всех лендингов компании), иначе поле скрыто. Выбор проекта нужен ТОЛЬКО для создания нового
// лендинга — перезаливка уже существующего идёт по /landings/:id/upload, который проект не
// принимает вообще.
//
// Провалившаяся проверка ZIP (LandingsService.processAndReviewZip) переводит диалог из режима
// "создать новый" в режим "перезалить" самостоятельно (setSelfTarget ниже) — тот же приём, что
// createdLanding в CreateExternalLandingDialog: собственное состояние компонента перекрывает
// входной проп, чтобы повторный клик "Загрузить" на исправленном архиве шёл по правильному
// эндпоинту без обратной связи с родителем.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { DomainOption, LandingReviewCheck, NO_DOMAIN, attachLandingToDomain } from '@/lib/landings';
import { DomainSelect } from '@/components/landing-card';
import { ZipLandingInstructions } from '@/components/zip-landing-instructions';
import { ZipDropZone } from '@/components/zip-drop-zone';
import { ReviewChecklist } from '@/components/review-checklist';
import {
  LandingBehaviorFields,
  LandingBehaviorState,
  EMPTY_LANDING_BEHAVIOR,
  behaviorStateToPayload,
  isLandingBehaviorNonDefault,
} from '@/components/landing-behavior-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type UploadZipLandingTarget = 'new' | { id: string; name: string };

interface ProjectOption {
  id: string;
  name: string;
}

export function UploadZipLandingDialog({
  target,
  projectId: fixedProjectId,
  domains,
  onClose,
}: {
  // null — закрыто, 'new' — создаём новый, иначе { id, name } уже существующего (перезаливка).
  target: UploadZipLandingTarget | null;
  // Не задан — показываем обязательный выбор проекта внутри диалога (страница всех лендингов).
  projectId?: string;
  domains: DomainOption[] | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const needsProjectPicker = !fixedProjectId;

  const [selfTarget, setSelfTarget] = useState<UploadZipLandingTarget | null>(null);
  const current = selfTarget ?? target;
  const open = current !== null;
  const isNew = current === 'new';
  const existingId = !isNew && current ? current.id : null;

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const projectId = fixedProjectId || selectedProjectId;

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get<ProjectOption[]>('/projects')).data,
    enabled: needsProjectPicker && open,
  });

  const [customName, setCustomName] = useState('');
  const [uploadDomainId, setUploadDomainId] = useState(NO_DOMAIN);
  const [uploadBehavior, setUploadBehavior] = useState<LandingBehaviorState>(EMPTY_LANDING_BEHAVIOR);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [reviewChecks, setReviewChecks] = useState<LandingReviewCheck[] | null>(null);

  const reset = () => {
    setSelfTarget(null);
    setSelectedProjectId('');
    setCustomName('');
    setUploadDomainId(NO_DOMAIN);
    setUploadBehavior(EMPTY_LANDING_BEHAVIOR);
    setZipFile(null);
    setError('');
    setReviewChecks(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Только ZIP-файлы');
      return;
    }
    setError('');
    setZipFile(file);
  };

  const uploadZip = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (!zipFile) throw new Error('Файл не выбран');
      formData.append('file', zipFile);

      if (isNew) {
        formData.append('name', customName);
        return (await api.post(`/projects/${projectId}/landings/custom`, formData)).data as {
          landing: { id: string; name: string; status: string };
          checks: LandingReviewCheck[];
        };
      }
      return (await api.post(`/landings/${existingId}/upload`, formData)).data as {
        landing: { id: string; name: string; status: string };
        checks: LandingReviewCheck[];
      };
    },
    onSuccess: async ({ landing, checks }) => {
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      if (isNew && uploadDomainId !== NO_DOMAIN) {
        await attachLandingToDomain(projectId, landing.id, uploadDomainId, domains);
        queryClient.invalidateQueries({ queryKey: ['domains'] });
      }
      // createCustom — multipart, не пропускает через себя autoRedirect/cloaking (см.
      // UploadCustomLandingDto) — если пользователь их включил в форме, донастраиваем сразу
      // тем же PATCH, что и страница редактирования лендинга.
      if (isNew && isLandingBehaviorNonDefault(uploadBehavior)) {
        await api.patch(`/landings/${landing.id}`, behaviorStateToPayload(uploadBehavior));
      }
      // Проверка не пройдена — лендинг сохранён как Draft, диалог остаётся открытым с
      // чеклистом и позволяет перезалить исправленный архив (переключаемся в режим
      // "перезаливка существующего", см. комментарий в шапке файла).
      if (checks.every((c) => c.passed)) {
        reset();
        onClose();
      } else {
        setReviewChecks(checks);
        setSelfTarget({ id: landing.id, name: landing.name });
        setZipFile(null);
      }
    },
    onError: (err) =>
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить ZIP'),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Загрузить кастомный лендинг' : `Перезалить ZIP — ${current && !isNew ? current.name : ''}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isNew && needsProjectPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="zip-upload-project">Проект</Label>
              <Select
                items={projects?.map((p) => ({ value: p.id, label: p.name })) ?? []}
                value={selectedProjectId || undefined}
                onValueChange={(v) => v && setSelectedProjectId(v)}
              >
                <SelectTrigger id="zip-upload-project">
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

          {isNew && !reviewChecks && <ZipLandingInstructions />}

          {isNew && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-name">Название (внутреннее)</Label>
              <Input id="custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            </div>
          )}

          {reviewChecks && (
            <div className="space-y-2 border rounded-md p-3">
              <p className="text-sm font-medium">
                {reviewChecks.every((c) => c.passed) ? 'Проверка пройдена' : 'Лендинг сохранён как черновик — исправьте и загрузите заново'}
              </p>
              <ReviewChecklist checks={reviewChecks} />
            </div>
          )}

          <ZipDropZone file={zipFile} onFileSelected={pickFile} />

          {isNew && (
            <div className="space-y-1.5">
              <Label htmlFor="upload-domain">Домен (необязательно)</Label>
              <DomainSelect id="upload-domain" value={uploadDomainId} onChange={setUploadDomainId} domains={domains} />
            </div>
          )}

          {isNew && (
            <div className="pt-1 border-t">
              <LandingBehaviorFields
                idPrefix="new-upload"
                state={uploadBehavior}
                onChange={(patch) => setUploadBehavior((s) => ({ ...s, ...patch }))}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            onClick={() => uploadZip.mutate()}
            disabled={!zipFile || (isNew && (!customName || (needsProjectPicker && !projectId))) || uploadZip.isPending}
          >
            {uploadZip.isPending ? 'Загружаем...' : 'Загрузить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
