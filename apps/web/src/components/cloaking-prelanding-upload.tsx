'use client';

// Загрузка white page для клоакинга типа PRELANDING (запрос пользователя 2026-09-23) — тот же
// UX, что и у UploadZipLandingDialog (инструкция → drag&drop → ReviewChecklist), но строже:
// провал проверки НЕ сохраняет ничего (см. LandingsService.uploadCloakingPrelanding) — форма
// просто остаётся открытой для повторной попытки, никакого "черновика".
//
// Автозагрузка сразу после выбора файла (запрос пользователя 2026-09-23: "без того чтобы
// нажимать дополнительно на какую-то кнопку") — mutationFn принимает File параметром вместо
// чтения его из отдельного стейта, upload.mutate(file) вызывается прямо в pickFile.
//
// Второй способ — вставить готовый HTML прямо в поле, без ZIP (запрос пользователя 2026-09-23:
// "просто сразу код кидать в поле") — POST .../cloaking/prelanding/html с {html} в JSON body
// вместо multipart. Тут кнопка "Загрузить" осталась осознанно (в отличие от ZIP) — вставка кода
// в textarea не даёт такого же однозначного "я закончил", как drag&drop/выбор файла.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { LandingReviewCheck } from '@/lib/landings';
import { ZipDropZone } from '@/components/zip-drop-zone';
import { ZipLandingInstructions } from '@/components/zip-landing-instructions';
import { ReviewChecklist } from '@/components/review-checklist';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type UploadMode = 'zip' | 'html';
type UploadResult = { accepted: boolean; checks: LandingReviewCheck[] };

export function CloakingPrelandingUpload({ landingId, hasUploaded }: { landingId: string; hasUploaded: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<UploadMode>('zip');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [htmlCode, setHtmlCode] = useState('');
  const [error, setError] = useState('');
  const [reviewChecks, setReviewChecks] = useState<LandingReviewCheck[] | null>(null);

  const invalidateLanding = () => queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'full'] });

  const switchMode = (next: UploadMode) => {
    setMode(next);
    setReviewChecks(null);
    setError('');
  };

  const uploadZip = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return (await api.post(`/landings/${landingId}/cloaking/prelanding`, formData)).data as UploadResult;
    },
    onSuccess: ({ accepted, checks }) => {
      setReviewChecks(checks);
      if (accepted) {
        setZipFile(null);
        invalidateLanding();
      }
    },
    onError: (err) =>
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить ZIP'),
  });

  const uploadHtml = useMutation({
    mutationFn: async (html: string) => (await api.post(`/landings/${landingId}/cloaking/prelanding/html`, { html })).data as UploadResult,
    onSuccess: ({ accepted, checks }) => {
      setReviewChecks(checks);
      if (accepted) invalidateLanding();
    },
    onError: (err) =>
      setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить код'),
  });

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Только ZIP-файлы');
      return;
    }
    setError('');
    setReviewChecks(null);
    setZipFile(file);
    uploadZip.mutate(file);
  };

  const submitHtml = () => {
    if (!htmlCode.trim()) return;
    setError('');
    setReviewChecks(null);
    uploadHtml.mutate(htmlCode);
  };

  const remove = useMutation({
    mutationFn: async () => api.delete(`/landings/${landingId}/cloaking/prelanding`),
    onSuccess: () => {
      setReviewChecks(null);
      invalidateLanding();
    },
  });

  if (hasUploaded) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">White page загружена ✓</p>
        <Button type="button" variant="outline" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          {remove.isPending ? 'Удаляем...' : 'Удалить'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex gap-2">
        <Button type="button" variant={mode === 'zip' ? 'default' : 'outline'} size="sm" onClick={() => switchMode('zip')}>
          ZIP-архив
        </Button>
        <Button type="button" variant={mode === 'html' ? 'default' : 'outline'} size="sm" onClick={() => switchMode('html')}>
          HTML-код
        </Button>
      </div>

      {mode === 'zip' && (
        <>
          {!reviewChecks && <ZipLandingInstructions variant="prelanding" />}
          <ZipDropZone
            file={zipFile}
            onFileSelected={pickFile}
            disabled={uploadZip.isPending}
            hint={uploadZip.isPending ? 'Загружаем и проверяем...' : 'Архив со страницей для посетителей не из разрешённых стран, до 50MB'}
          />
        </>
      )}

      {mode === 'html' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Вставьте готовую HTML-страницу целиком (с <code className="bg-muted px-1 rounded">{'<!DOCTYPE html>'}</code>).
            Локальные картинки/css/js так подключить нельзя — только внешние ссылки (https://...) или
            data:-URI. Если нужны свои файлы — используйте загрузку ZIP.
          </p>
          <Textarea
            rows={12}
            value={htmlCode}
            onChange={(e) => setHtmlCode(e.target.value)}
            placeholder="<!DOCTYPE html>..."
            className="font-mono text-xs"
            disabled={uploadHtml.isPending}
          />
          <Button type="button" size="sm" onClick={submitHtml} disabled={!htmlCode.trim() || uploadHtml.isPending}>
            {uploadHtml.isPending ? 'Проверяем...' : 'Загрузить'}
          </Button>
        </div>
      )}

      {reviewChecks && (
        <div className="space-y-2 border rounded-md p-3">
          <p className="text-sm font-medium">
            {reviewChecks.every((c) => c.passed) ? 'Проверка пройдена, white page загружена' : 'Отклонено — исправьте и загрузите заново'}
          </p>
          <ReviewChecklist checks={reviewChecks} />
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
