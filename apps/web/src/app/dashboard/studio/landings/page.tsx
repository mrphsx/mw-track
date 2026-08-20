'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, SplitSquareHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import {
  AbTestGroupItem,
  DomainOption,
  LandingItem,
  attachmentUrl,
  computeAbTestGroupLabels,
  findGroupAttachment,
  findLandingAttachment,
  groupAutoLabel,
} from '@/lib/landings';
import { AbTestDialogTarget, AbTestGroupDialog, LandingCard, LandingDomainDialog } from '@/components/landing-card';
import { GetLinkDialog, GetLinkLanding } from '@/components/get-link-dialog';
import { CreateLandingFromTemplateDialog } from '@/components/create-landing-dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission, hasPermission } from '@/lib/permissions';
import { STUDIO_CARD, StudioLinkButton } from '../ui';

// Цветная точка вместо текстового Badge статуса — тот же STATUS_DOT_CLASS/приём, что и на
// per-project Studio-странице лендингов (2026-07-30, после 3 заходов на оформление статуса).
// DRAFT — красный, не серый (запрос пользователя 2026-08-20: "не активный лэндинг подмечай не
// серым кружком а красным") — раньше был нейтральным "ещё не запущено", теперь однозначно
// сигналит "требует внимания", тем более что с того же дня новые лендинги публикуются
// автоматически (см. LandingsService.createFromTemplate/createCustom) — DRAFT теперь либо
// осознанно снятая с публикации, либо ещё не доделанная страница, а не обычное промежуточное
// состояние "только что создали".
const STATUS_DOT_CLASS: Record<string, string> = {
  PUBLISHED: 'bg-[#1F7A6C] dark:bg-[#6FCBBA]',
  DRAFT: 'bg-red-500 dark:bg-red-400',
  ARCHIVED: 'bg-[#6B3E63] dark:bg-[#D19BC4]',
};

// Studio-версия компанейской страницы "Все лендинги" — логика 1:1 с классической
// (apps/web/.../(dashboard)/landings/page.tsx). Переключатель "лендинги / группы" (запрос
// пользователя 2026-08-20) — см. полный комментарий в classic-версии.
export default function StudioAllLandingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [domainDialogLanding, setDomainDialogLanding] = useState<LandingItem | null>(null);
  const [getLinkLanding, setGetLinkLanding] = useState<LandingItem | null>(null);
  const [getLinkGroupId, setGetLinkGroupId] = useState<string | null>(null);
  const [abTestTarget, setAbTestTarget] = useState<AbTestDialogTarget | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'landings' | 'groups'>('landings');

  const { data: landings, isLoading } = useQuery({
    queryKey: ['landings', 'all'],
    queryFn: async () => (await api.get<LandingItem[]>('/landings')).data,
  });

  const abTestLabels = useMemo(() => computeAbTestGroupLabels(landings), [landings]);

  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
  });

  const { data: abTestGroups } = useQuery({
    queryKey: ['ab-test-groups', 'all'],
    queryFn: async () => (await api.get<AbTestGroupItem[]>('/ab-test-groups')).data,
  });
  const activeAbTestGroups = useMemo(() => (abTestGroups ?? []).filter((g) => !g.endedAt), [abTestGroups]);

  const getLinkGroup = abTestGroups?.find((g) => g.id === getLinkGroupId) ?? null;
  const getLinkGroupTarget: GetLinkLanding | null = getLinkGroup
    ? { id: getLinkGroup.id, name: getLinkGroup.name || groupAutoLabel(getLinkGroup), project: { id: getLinkGroup.project?.id ?? '' } }
    : null;

  const invalidateAbTests = () => {
    queryClient.invalidateQueries({ queryKey: ['ab-test-groups', 'all'] });
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

  const preview = async (landingId: string) => {
    const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Все лендинги</h1>
          {/* Переключатель сгруппирован с заголовком на фиксированной левой стороне, чтобы не
              "прыгать" при смене состава кнопок справа (запрос пользователя 2026-08-20: "кнопка
              переключения... прыгает когда меняешь"). */}
          <div className="inline-flex rounded-lg bg-white dark:bg-[#171F2B] dark:border dark:border-white/10 shadow-sm p-1 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode('landings')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                viewMode === 'landings'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Лендинги
            </button>
            <button
              type="button"
              onClick={() => setViewMode('groups')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                viewMode === 'groups'
                  ? 'bg-[#1F4E9C] text-white dark:bg-[#7BA9EE] dark:text-[#0F1620]'
                  : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]'
              }`}
            >
              Группы (A/B/n)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {viewMode === 'landings' && hasAnyPermission(user, 'LANDINGS_CREATE') && (
            <StudioLinkButton variant="primary" icon={Plus} onClick={() => setShowCreateDialog(true)}>
              Создать из шаблона
            </StudioLinkButton>
          )}
          {viewMode === 'groups' && hasAnyPermission(user, 'AB_TESTS_CREATE') && (
            <StudioLinkButton
              variant="primary"
              icon={SplitSquareHorizontal}
              onClick={() => setAbTestTarget({ projectId: null, groupId: null, preselectedIds: [] })}
            >
              Создать тест
            </StudioLinkButton>
          )}
        </div>
      </div>

      {viewMode === 'groups' && !!activeAbTestGroups.length && (
        <div className="space-y-2">
          {activeAbTestGroups.map((g) => {
            const attachment = findGroupAttachment(domains, g.id);
            return (
              <div
                key={g.id}
                onClick={() => router.push(`/projects/${g.project?.id}/landings/groups/${g.id}`)}
                className={`${STUDIO_CARD} p-4 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:opacity-90 transition-opacity`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate text-[#131A24] dark:text-[#E9EDF3]">{g.name || groupAutoLabel(g)}</p>
                    {g.project && (
                      <Link
                        href={`/projects/${g.project.id}/landings`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline shrink-0"
                      >
                        {g.project.name}
                      </Link>
                    )}
                  </div>
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
                  <StudioLinkButton
                    size="sm"
                    onClick={() => setAbTestTarget({ projectId: g.project?.id ?? null, groupId: g.id, preselectedIds: [] })}
                  >
                    Управлять
                  </StudioLinkButton>
                  {g.project && hasPermission(user, g.project.id, 'AB_TESTS_EDIT') && (
                    <StudioLinkButton size="sm" onClick={() => stopTest.mutate(g.id)} disabled={stopTest.isPending}>
                      Завершить тест
                    </StudioLinkButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'groups' && !activeAbTestGroups.length && (
        <div className={`${STUDIO_CARD} p-8 text-center space-y-3`}>
          <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Тестов пока нет.</p>
          {hasAnyPermission(user, 'AB_TESTS_CREATE') && (
            <StudioLinkButton
              variant="primary"
              icon={Plus}
              onClick={() => setAbTestTarget({ projectId: null, groupId: null, preselectedIds: [] })}
            >
              Создать тест
            </StudioLinkButton>
          )}
        </div>
      )}

      {viewMode === 'landings' && isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {viewMode === 'landings' && !isLoading && landings?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Лендингов пока нет.</div>
      )}

      {viewMode === 'landings' && !!landings?.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {landings.map((l) => (
            <LandingCard
              key={l.id}
              landing={l}
              domains={domains}
              showProject
              onPreview={() => preview(l.id)}
              onManageDomain={() => setDomainDialogLanding(l)}
              onGetLink={() => setGetLinkLanding(l)}
              onManageAbTest={() =>
                setAbTestTarget({ projectId: l.project.id, groupId: l.abTestGroupId, preselectedIds: l.abTestGroupId ? [] : [l.id] })
              }
              onPublish={() => publish.mutate(l.id)}
              onUnpublish={() => unpublish.mutate(l.id)}
              onDelete={() => remove.mutate(l.id)}
              isPublishPending={(publish.isPending && publish.variables === l.id) || (unpublish.isPending && unpublish.variables === l.id)}
              isDeletePending={remove.isPending && remove.variables === l.id}
              canDelete={hasPermission(user, l.project.id, 'LANDINGS_DELETE')}
              hideStatusBadge
              hideChannelDetails
              statusDotClassName={STATUS_DOT_CLASS[l.status]}
              abTestGroupLabel={l.abTestGroupId ? abTestLabels.get(l.abTestGroupId) : null}
              containerClassName={STUDIO_CARD}
            />
          ))}
        </div>
      )}

      <LandingDomainDialog landing={domainDialogLanding} domains={domains} onClose={() => setDomainDialogLanding(null)} />
      <AbTestGroupDialog target={abTestTarget} domains={domains} onClose={() => setAbTestTarget(null)} onSaved={invalidateAbTests} />
      <GetLinkDialog
        landing={getLinkLanding ?? getLinkGroupTarget}
        attachment={
          getLinkLanding
            ? findLandingAttachment(domains, getLinkLanding.id)
            : getLinkGroup
              ? findGroupAttachment(domains, getLinkGroup.id)
              : null
        }
        onClose={() => {
          setGetLinkLanding(null);
          setGetLinkGroupId(null);
        }}
      />
      <CreateLandingFromTemplateDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} domains={domains} />
    </div>
  );
}
