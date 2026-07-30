'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { History, Plus, SplitSquareHorizontal, UploadCloud, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { hasPermission } from '@/lib/permissions';
import {
  AbTestGroupItem,
  DomainOption,
  LandingItem,
  NO_DOMAIN,
  attachLandingToDomain,
  attachmentUrl,
  computeAbTestGroupLabels,
  findGroupAttachment,
  findLandingAttachment,
  groupAutoLabel,
} from '@/lib/landings';
import {
  AbTestDialogTarget,
  AbTestGroupDialog,
  LandingCard,
  LandingDomainDialog,
  DomainSelect,
} from '@/components/landing-card';
import { GetLinkDialog, GetLinkLanding } from '@/components/get-link-dialog';
import { CreateLandingFromTemplateDialog } from '@/components/create-landing-dialog';
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
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function LandingsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [error, setError] = useState('');

  // null — закрыто, 'new' — создаём новый кастомный лендинг, иначе id существующего (ре-загрузка)
  const [uploadTarget, setUploadTarget] = useState<'new' | string | null>(null);
  const [customName, setCustomName] = useState('');
  const [uploadDomainId, setUploadDomainId] = useState(NO_DOMAIN);
  const [uploadBehavior, setUploadBehavior] =
    useState<LandingBehaviorState>(EMPTY_LANDING_BEHAVIOR);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [domainDialogLanding, setDomainDialogLanding] = useState<LandingItem | null>(null);
  const [getLinkLanding, setGetLinkLanding] = useState<LandingItem | null>(null);
  const [getLinkGroupId, setGetLinkGroupId] = useState<string | null>(null);
  const [abTestTarget, setAbTestTarget] = useState<AbTestDialogTarget | null>(null);

  // Режим выбора лендингов кликом по карточкам для группового A/B/n-теста (запрос
  // пользователя 2026-07-15) — кнопка "Сравнить" в шапке переключает его, липкая панель внизу
  // появляется, когда отмечено ≥ 2 карточки.
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setSelectedIds(new Set());
  };

  const { data: landings, isLoading } = useQuery({
    queryKey: ['landings', projectId],
    queryFn: async () => (await api.get<LandingItem[]>(`/projects/${projectId}/landings`)).data,
  });

  const abTestLabels = useMemo(() => computeAbTestGroupLabels(landings), [landings]);

  // Тот же список, что и на странице /domains — React Query шарит кэш по ключу, обе страницы
  // видят актуальные привязки друг друга без лишних запросов.
  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
  });

  // Отдельный список тестов (запрос пользователя 2026-07-17: "где мне нормально увидеть эту
  // группу, сложно ориентироваться чтобы взять именно под эту группу ссылку") — раньше группа
  // была видна только косвенно, бейджем на карточке лендинга-участника.
  const { data: abTestGroups } = useQuery({
    queryKey: ['ab-test-groups', projectId],
    queryFn: async () =>
      (await api.get<AbTestGroupItem[]>(`/projects/${projectId}/ab-test-groups`)).data,
  });

  const getLinkGroup = abTestGroups?.find((g) => g.id === getLinkGroupId) ?? null;
  const getLinkGroupTarget: GetLinkLanding | null = getLinkGroup
    ? {
        id: getLinkGroup.id,
        name: getLinkGroup.name || groupAutoLabel(getLinkGroup),
        project: { id: projectId },
      }
    : null;

  // Только активные — завершённые (endedAt задан) переехали на отдельную страницу
  // /projects/[id]/landings/history (запрос пользователя 2026-07-17: "завершенные тесты в
  // другую страницу, эта получится слишком большой").
  const activeAbTestGroups = useMemo(
    () => (abTestGroups ?? []).filter((g) => !g.endedAt),
    [abTestGroups],
  );
  const hasEndedAbTestGroups = (abTestGroups ?? []).some((g) => g.endedAt);

  const resetUploadForm = () => {
    setUploadTarget(null);
    setCustomName('');
    setUploadDomainId(NO_DOMAIN);
    setUploadBehavior(EMPTY_LANDING_BEHAVIOR);
    setZipFile(null);
    setDragOver(false);
    setError('');
  };

  const uploadZip = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (!zipFile) throw new Error('Файл не выбран');
      formData.append('file', zipFile);

      if (uploadTarget === 'new') {
        formData.append('name', customName);
        return (await api.post(`/projects/${projectId}/landings/custom`, formData)).data as {
          id: string;
        };
      }
      return (await api.post(`/landings/${uploadTarget}/upload`, formData)).data as { id: string };
    },
    onSuccess: async (landing) => {
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      if (uploadTarget === 'new' && uploadDomainId !== NO_DOMAIN) {
        await attachLandingToDomain(projectId, landing.id, uploadDomainId, domains);
        queryClient.invalidateQueries({ queryKey: ['domains'] });
      }
      // createCustom — multipart, не пропускает через себя autoRedirect/cloaking (см.
      // UploadCustomLandingDto) — если пользователь их включил в форме, донастраиваем
      // сразу тем же PATCH, что и страница редактирования лендинга.
      if (uploadTarget === 'new' && isLandingBehaviorNonDefault(uploadBehavior)) {
        await api.patch(`/landings/${landing.id}`, behaviorStateToPayload(uploadBehavior));
      }
      resetUploadForm();
    },
    onError: (err) =>
      setError(
        (isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить ZIP',
      ),
  });

  const publish = useMutation({
    mutationFn: (landingId: string) => api.post(`/landings/${landingId}/publish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings'] }),
  });

  const unpublish = useMutation({
    mutationFn: (landingId: string) => api.post(`/landings/${landingId}/unpublish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings'] }),
  });

  const remove = useMutation({
    mutationFn: (landingId: string) => api.delete(`/landings/${landingId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings'] }),
  });

  // Быстрые действия в списке тестов (запрос пользователя 2026-07-17: "добавь чтобы можно было
  // закончить тест, привязку") — напрямую, без захода в AbTestGroupDialog.
  const invalidateAbTests = () => {
    queryClient.invalidateQueries({ queryKey: ['ab-test-groups', projectId] });
    queryClient.invalidateQueries({ queryKey: ['landings'] });
    queryClient.invalidateQueries({ queryKey: ['domains'] });
  };

  const stopTest = useMutation({
    mutationFn: (groupId: string) => api.delete(`/ab-test-groups/${groupId}`),
    onSuccess: invalidateAbTests,
  });

  const unbindTestDomain = useMutation({
    mutationFn: ({ domainId, pathId }: { domainId: string; pathId: string }) =>
      api.delete(`/domains/${domainId}/paths/${pathId}`),
    onSuccess: invalidateAbTests,
  });

  const preview = async (landingId: string) => {
    const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Лендинги</h1>
        <div className="flex gap-2">
          {compareMode ? (
            <Button variant="outline" onClick={exitCompareMode}>
              <X className="w-4 h-4 mr-1.5" /> Отмена
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setCompareMode(true)}>
                <SplitSquareHorizontal className="w-4 h-4 mr-1.5" /> Сравнить лендинги
              </Button>
              {hasPermission(user, projectId, 'LANDINGS_CREATE') && (
                <>
                  <Button variant="outline" onClick={() => setUploadTarget('new')}>
                    <UploadCloud className="w-4 h-4 mr-1.5" /> Загрузить ZIP
                  </Button>
                  <Button onClick={() => setShowTemplateModal(true)}>
                    <Plus className="w-4 h-4 mr-1.5" /> Создать из шаблона
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {(!!activeAbTestGroups.length || hasEndedAbTestGroups) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">A/B/n-тесты</h2>
            {hasEndedAbTestGroups && (
              <Link
                href={`/projects/${projectId}/landings/history`}
                className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
              >
                <History className="w-3.5 h-3.5" /> История тестов
              </Link>
            )}
          </div>
          {!activeAbTestGroups.length && (
            <p className="text-sm text-muted-foreground">Активных тестов нет.</p>
          )}
          <div className="space-y-2">
            {activeAbTestGroups.map((g) => {
              const attachment = findGroupAttachment(domains, g.id);
              return (
                <Card
                  key={g.id}
                  onClick={() => router.push(`/projects/${projectId}/landings/groups/${g.id}`)}
                  className="cursor-pointer transition-colors hover:ring-foreground/20"
                >
                  <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium truncate">{g.name || groupAutoLabel(g)}</p>
                      <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                        {g.landings.map((l) => (
                          <span key={l.id} className="border rounded px-1.5 py-0.5">
                            {l.name} — {l.abTestWeight ?? 0}%
                          </span>
                        ))}
                      </div>
                      {attachment ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={attachmentUrl(attachment)}
                            target="_blank"
                            rel="noopener"
                            className="text-xs font-mono text-muted-foreground hover:underline truncate"
                          >
                            {attachment.domain}
                            {attachment.path === '/' ? '' : attachment.path}
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              unbindTestDomain.mutate({
                                domainId: attachment.domainId,
                                pathId: attachment.pathId,
                              })
                            }
                            disabled={unbindTestDomain.isPending}
                            className="text-xs text-muted-foreground hover:underline shrink-0"
                          >
                            Отвязать
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Домен не привязан</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setGetLinkGroupId(g.id)}
                        disabled={!attachment}
                      >
                        Ссылка
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setAbTestTarget({ projectId, groupId: g.id, preselectedIds: [] })
                        }
                      >
                        Управлять
                      </Button>
                      {hasPermission(user, projectId, 'AB_TESTS_EDIT') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => stopTest.mutate(g.id)}
                          disabled={stopTest.isPending}
                        >
                          Завершить тест
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {!isLoading && landings?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Лендингов пока нет.</CardContent>
        </Card>
      )}

      {!!landings?.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {landings.map((l) => (
            <LandingCard
              key={l.id}
              landing={l}
              domains={domains}
              showProject={false}
              onPreview={() => preview(l.id)}
              onManageDomain={() => setDomainDialogLanding(l)}
              onGetLink={() => setGetLinkLanding(l)}
              onReupload={l.type === 'CUSTOM' ? () => setUploadTarget(l.id) : undefined}
              onManageAbTest={() =>
                setAbTestTarget({
                  projectId,
                  groupId: l.abTestGroupId,
                  preselectedIds: l.abTestGroupId ? [] : [l.id],
                })
              }
              onPublish={() => publish.mutate(l.id)}
              onUnpublish={() => unpublish.mutate(l.id)}
              onDelete={() => remove.mutate(l.id)}
              // Скоуп ожидания на конкретную карточку через .variables — баг-репорт пользователя
              // 2026-07-30: раньше клик на одной карточке переводил кнопки ВСЕХ карточек в
              // "ожидание", т.к. isPending читался с общей на всю страницу мутации.
              isPublishPending={(publish.isPending && publish.variables === l.id) || (unpublish.isPending && unpublish.variables === l.id)}
              isDeletePending={remove.isPending && remove.variables === l.id}
              canDelete={hasPermission(user, projectId, 'LANDINGS_DELETE')}
              selectable={compareMode}
              selected={selectedIds.has(l.id)}
              onToggleSelect={() => toggleSelected(l.id)}
              abTestGroupLabel={l.abTestGroupId ? abTestLabels.get(l.abTestGroupId) : null}
            />
          ))}
        </div>
      )}

      <CreateLandingFromTemplateDialog
        open={showTemplateModal}
        onOpenChange={setShowTemplateModal}
        projectId={projectId}
        domains={domains}
      />

      <Dialog open={uploadTarget !== null} onOpenChange={(open) => !open && resetUploadForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {uploadTarget === 'new' ? 'Загрузить кастомный лендинг' : 'Перезалить ZIP'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {uploadTarget === 'new' && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-name">Название (внутреннее)</Label>
                <Input
                  id="custom-name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
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
              className={`border-2 border-dashed rounded-lg p-6 text-center text-sm cursor-pointer transition-colors ${
                dragOver
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'border-border text-muted-foreground hover:border-muted-foreground'
              }`}
            >
              <UploadCloud className="w-6 h-6 mx-auto mb-2" />
              {zipFile ? zipFile.name : 'Перетащите ZIP сюда или нажмите для выбора'}
              <p className="text-xs text-muted-foreground mt-1">
                Архив должен содержать index.html в корне, до 50MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {uploadTarget === 'new' && (
              <div className="space-y-1.5">
                <Label htmlFor="upload-domain">Домен (необязательно)</Label>
                <DomainSelect
                  id="upload-domain"
                  value={uploadDomainId}
                  onChange={setUploadDomainId}
                  domains={domains}
                />
              </div>
            )}

            {uploadTarget === 'new' && (
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
              disabled={!zipFile || (uploadTarget === 'new' && !customName) || uploadZip.isPending}
            >
              {uploadZip.isPending ? 'Загружаем...' : 'Загрузить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LandingDomainDialog
        landing={domainDialogLanding}
        domains={domains}
        onClose={() => setDomainDialogLanding(null)}
      />
      <AbTestGroupDialog
        target={abTestTarget}
        domains={domains}
        onClose={() => setAbTestTarget(null)}
        onSaved={() => {
          exitCompareMode();
          queryClient.invalidateQueries({ queryKey: ['ab-test-groups', projectId] });
        }}
      />
      <GetLinkDialog
        landing={getLinkLanding}
        attachment={getLinkLanding ? findLandingAttachment(domains, getLinkLanding.id) : null}
        onClose={() => setGetLinkLanding(null)}
      />
      <GetLinkDialog
        landing={getLinkGroupTarget}
        attachment={getLinkGroup ? findGroupAttachment(domains, getLinkGroup.id) : null}
        onClose={() => setGetLinkGroupId(null)}
      />

      {compareMode && selectedIds.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-card shadow-lg p-3 flex items-center justify-center gap-3 z-40">
          <span className="text-sm text-muted-foreground">Выбрано: {selectedIds.size}</span>
          <Button
            onClick={() =>
              setAbTestTarget({ projectId, groupId: null, preselectedIds: Array.from(selectedIds) })
            }
          >
            <SplitSquareHorizontal className="w-4 h-4 mr-1.5" /> Настроить тест
          </Button>
          <Button variant="outline" onClick={exitCompareMode}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
}
