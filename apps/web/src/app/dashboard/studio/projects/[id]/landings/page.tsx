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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { STUDIO_CARD, StudioLinkButton } from '../../../ui';

// Цветная точка рядом с названием вместо текстового Badge статуса (запрос пользователя
// 2026-07-30: "подметь по цвету карточки активен лэндинг или в драфте и убери надпись"; после
// 2 промежуточных заходов — border-l-4, затем целиковая ring-рамка — пользователь вернул точку,
// только крупнее исходной (w-3 h-3 внутри LandingCard, было w-2 h-2)). sage/зелёный для
// PUBLISHED (тот же "активно = зелёный" принцип, что уже закреплён для StatusPill на странице
// проекта), slate для DRAFT (нейтральный, "ещё не запущено"), plum для ARCHIVED (третий реальный
// статус LandingStatus). Литеральные строки, не собранные через template-интерполяцию — см.
// Tailwind JIT gotcha в предыдущей правке этого файла.
const STATUS_DOT_CLASS: Record<string, string> = {
  PUBLISHED: 'bg-[#1F7A6C] dark:bg-[#6FCBBA]',
  DRAFT: 'bg-[#52606B] dark:bg-[#A6B4C0]',
  ARCHIVED: 'bg-[#6B3E63] dark:bg-[#D19BC4]',
};

// Studio-версия страницы лендингов (запрос пользователя 2026-07-30: "сделай страницу Лендинги...
// учти всё что мы правили для дизайна studio") — beta, доступна пока только через переход с
// Studio-страницы проекта. В отличие от Сценариев, здесь НЕ форкнута карточка лендинга
// (LandingCard) и все диалоги (загрузка ZIP/домен/A/B-группа/ссылка/шаблон) — тот же принцип,
// что уже применялся в этой сессии для ClientDetailDrawer/DailyCharts на странице проекта:
// сложные функциональные виджеты переиспользуются как есть, Studio-оформление получает только
// внешняя оболочка (шапка, кнопки, список A/B-тестов). LandingCard — общий компонент, которым
// пользуется и компанейская /landings-страница; форк ради этой одной beta-страницы означал бы
// дублировать 580 строк логики предпросмотра/публикации/меню без реальной необходимости.
export default function StudioLandingsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [error, setError] = useState('');

  const [uploadTarget, setUploadTarget] = useState<'new' | string | null>(null);
  const [customName, setCustomName] = useState('');
  const [uploadDomainId, setUploadDomainId] = useState(NO_DOMAIN);
  const [uploadBehavior, setUploadBehavior] = useState<LandingBehaviorState>(EMPTY_LANDING_BEHAVIOR);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [domainDialogLanding, setDomainDialogLanding] = useState<LandingItem | null>(null);
  const [getLinkLanding, setGetLinkLanding] = useState<LandingItem | null>(null);
  const [getLinkGroupId, setGetLinkGroupId] = useState<string | null>(null);
  const [abTestTarget, setAbTestTarget] = useState<AbTestDialogTarget | null>(null);

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

  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
  });

  const { data: abTestGroups } = useQuery({
    queryKey: ['ab-test-groups', projectId],
    queryFn: async () => (await api.get<AbTestGroupItem[]>(`/projects/${projectId}/ab-test-groups`)).data,
  });

  const getLinkGroup = abTestGroups?.find((g) => g.id === getLinkGroupId) ?? null;
  const getLinkGroupTarget: GetLinkLanding | null = getLinkGroup
    ? { id: getLinkGroup.id, name: getLinkGroup.name || groupAutoLabel(getLinkGroup), project: { id: projectId } }
    : null;

  const activeAbTestGroups = useMemo(() => (abTestGroups ?? []).filter((g) => !g.endedAt), [abTestGroups]);
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
        return (await api.post(`/projects/${projectId}/landings/custom`, formData)).data as { id: string };
      }
      return (await api.post(`/landings/${uploadTarget}/upload`, formData)).data as { id: string };
    },
    onSuccess: async (landing) => {
      queryClient.invalidateQueries({ queryKey: ['landings'] });
      if (uploadTarget === 'new' && uploadDomainId !== NO_DOMAIN) {
        await attachLandingToDomain(projectId, landing.id, uploadDomainId, domains);
        queryClient.invalidateQueries({ queryKey: ['domains'] });
      }
      if (uploadTarget === 'new' && isLandingBehaviorNonDefault(uploadBehavior)) {
        await api.patch(`/landings/${landing.id}`, behaviorStateToPayload(uploadBehavior));
      }
      resetUploadForm();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить ZIP'),
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
    mutationFn: ({ domainId, pathId }: { domainId: string; pathId: string }) => api.delete(`/domains/${domainId}/paths/${pathId}`),
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Лендинги</h1>
        <div className="flex flex-wrap gap-2">
          {compareMode ? (
            <StudioLinkButton icon={X} onClick={exitCompareMode}>
              Отмена
            </StudioLinkButton>
          ) : (
            <>
              <StudioLinkButton icon={SplitSquareHorizontal} onClick={() => setCompareMode(true)}>
                Сравнить лендинги
              </StudioLinkButton>
              {hasPermission(user, projectId, 'LANDINGS_CREATE') && (
                <>
                  <StudioLinkButton icon={UploadCloud} onClick={() => setUploadTarget('new')}>
                    Загрузить ZIP
                  </StudioLinkButton>
                  <StudioLinkButton variant="primary" icon={Plus} onClick={() => setShowTemplateModal(true)}>
                    Создать из шаблона
                  </StudioLinkButton>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {(!!activeAbTestGroups.length || hasEndedAbTestGroups) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[#131A24] dark:text-[#E9EDF3]">A/B/n-тесты</h2>
            {hasEndedAbTestGroups && (
              <Link
                href={`/dashboard/studio/projects/${projectId}/landings/history`}
                className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3] transition-colors inline-flex items-center gap-1.5"
              >
                <History className="w-3.5 h-3.5" /> История тестов
              </Link>
            )}
          </div>
          {!activeAbTestGroups.length && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Активных тестов нет.</p>}
          <div className="space-y-2">
            {activeAbTestGroups.map((g) => {
              const attachment = findGroupAttachment(domains, g.id);
              return (
                <div
                  key={g.id}
                  onClick={() => router.push(`/dashboard/studio/projects/${projectId}/landings/groups/${g.id}`)}
                  className={`${STUDIO_CARD} p-4 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:opacity-90 transition-opacity`}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{g.name || groupAutoLabel(g)}</p>
                    <div className="flex items-center gap-1.5 flex-wrap text-xs text-[#5F6B7A] dark:text-[#92A0AF]">
                      {g.landings.map((l) => (
                        <span key={l.id} className="border border-[#DCE1E8] dark:border-white/10 rounded-lg px-1.5 py-0.5">
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
                          className="text-xs font-mono text-[#5F6B7A] dark:text-[#92A0AF] hover:underline truncate"
                        >
                          {attachment.domain}
                          {attachment.path === '/' ? '' : attachment.path}
                        </a>
                        <button
                          type="button"
                          onClick={() => unbindTestDomain.mutate({ domainId: attachment.domainId, pathId: attachment.pathId })}
                          disabled={unbindTestDomain.isPending}
                          className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] hover:underline shrink-0"
                        >
                          Отвязать
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Домен не привязан</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <StudioLinkButton size="sm" onClick={() => setGetLinkGroupId(g.id)} disabled={!attachment}>
                      Ссылка
                    </StudioLinkButton>
                    <StudioLinkButton size="sm" onClick={() => setAbTestTarget({ projectId, groupId: g.id, preselectedIds: [] })}>
                      Управлять
                    </StudioLinkButton>
                    {hasPermission(user, projectId, 'AB_TESTS_EDIT') && (
                      <StudioLinkButton size="sm" onClick={() => stopTest.mutate(g.id)} disabled={stopTest.isPending}>
                        Завершить тест
                      </StudioLinkButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && landings?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Лендингов пока нет.</div>
      )}

      {/* Сама сетка карточек — общий LandingCard без форка, см. комментарий в шапке файла. */}
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
              onPublish={() => publish.mutate(l.id)}
              onUnpublish={() => unpublish.mutate(l.id)}
              onDelete={() => remove.mutate(l.id)}
              // Скоуп ожидания на конкретную карточку через .variables (баг-репорт пользователя
              // 2026-07-30: "кнопки всех лэндингов переходят в ожидание") — тот же фикс применён
              // и в двух других потребителях LandingCard (классическая страница проекта и
              // компанейская /landings), баг был identичный во всех трёх местах.
              isPublishPending={(publish.isPending && publish.variables === l.id) || (unpublish.isPending && unpublish.variables === l.id)}
              isDeletePending={remove.isPending && remove.variables === l.id}
              canDelete={hasPermission(user, projectId, 'LANDINGS_DELETE')}
              hideStatusBadge
              hideChannelDetails
              statusDotClassName={STATUS_DOT_CLASS[l.status]}
              selectable={compareMode}
              selected={selectedIds.has(l.id)}
              onToggleSelect={() => toggleSelected(l.id)}
              abTestGroupLabel={l.abTestGroupId ? abTestLabels.get(l.abTestGroupId) : null}
              statsHrefOverride={`/dashboard/studio/projects/${projectId}/landings/${l.id}`}
            />
          ))}
        </div>
      )}

      <CreateLandingFromTemplateDialog open={showTemplateModal} onOpenChange={setShowTemplateModal} projectId={projectId} domains={domains} />

      <Dialog open={uploadTarget !== null} onOpenChange={(open) => !open && resetUploadForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{uploadTarget === 'new' ? 'Загрузить кастомный лендинг' : 'Перезалить ZIP'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {uploadTarget === 'new' && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-name">Название (внутреннее)</Label>
                <Input id="custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
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
                dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-border text-muted-foreground hover:border-muted-foreground'
              }`}
            >
              <UploadCloud className="w-6 h-6 mx-auto mb-2" />
              {zipFile ? zipFile.name : 'Перетащите ZIP сюда или нажмите для выбора'}
              <p className="text-xs text-muted-foreground mt-1">Архив должен содержать index.html в корне, до 50MB</p>
              <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            </div>

            {uploadTarget === 'new' && (
              <div className="space-y-1.5">
                <Label htmlFor="upload-domain">Домен (необязательно)</Label>
                <DomainSelect id="upload-domain" value={uploadDomainId} onChange={setUploadDomainId} domains={domains} />
              </div>
            )}

            {uploadTarget === 'new' && (
              <div className="pt-1 border-t">
                <LandingBehaviorFields idPrefix="new-upload" state={uploadBehavior} onChange={(patch) => setUploadBehavior((s) => ({ ...s, ...patch }))} />
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="button"
              onClick={() => uploadZip.mutate()}
              disabled={!zipFile || (uploadTarget === 'new' && !customName) || uploadZip.isPending}
              className="w-full text-sm px-4 py-2 rounded-lg bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {uploadZip.isPending ? 'Загружаем...' : 'Загрузить'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <LandingDomainDialog landing={domainDialogLanding} domains={domains} onClose={() => setDomainDialogLanding(null)} />
      <AbTestGroupDialog
        target={abTestTarget}
        domains={domains}
        onClose={() => setAbTestTarget(null)}
        onSaved={() => {
          exitCompareMode();
          queryClient.invalidateQueries({ queryKey: ['ab-test-groups', projectId] });
        }}
      />
      <GetLinkDialog landing={getLinkLanding} attachment={getLinkLanding ? findLandingAttachment(domains, getLinkLanding.id) : null} onClose={() => setGetLinkLanding(null)} />
      <GetLinkDialog landing={getLinkGroupTarget} attachment={getLinkGroup ? findGroupAttachment(domains, getLinkGroup.id) : null} onClose={() => setGetLinkGroupId(null)} />

      {compareMode && selectedIds.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg p-3 flex items-center justify-center gap-3 z-40">
          <span className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Выбрано: {selectedIds.size}</span>
          <StudioLinkButton variant="primary" icon={SplitSquareHorizontal} onClick={() => setAbTestTarget({ projectId, groupId: null, preselectedIds: Array.from(selectedIds) })}>
            Настроить тест
          </StudioLinkButton>
          <StudioLinkButton onClick={exitCompareMode}>Отмена</StudioLinkButton>
        </div>
      )}
    </div>
  );
}
