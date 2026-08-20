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
import {
  AbTestDialogTarget,
  AbTestGroupDialog,
  LandingCard,
  LandingDomainDialog,
} from '@/components/landing-card';
import { GetLinkDialog, GetLinkLanding } from '@/components/get-link-dialog';
import { CreateLandingFromTemplateDialog } from '@/components/create-landing-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission, hasPermission } from '@/lib/permissions';

// Все лендинги компании сразу, а не только внутри одного проекта — со ссылкой на проект и
// канал, на который лендинг ведёт, прямо в карточке. Создание лендинга (запрос пользователя
// 2026-07-21: "сделай возможность создать лэндинга со страницы всех лэндингов напрямую") —
// тот же диалог, что и на странице проекта (CreateLandingFromTemplateDialog), просто без
// фиксированного projectId — сам диалог тогда показывает обязательный выбор проекта.
//
// Переключатель "лендинги / группы" (запрос пользователя 2026-08-20: "добавь этот список груп
// и на странице всех лендингов... переключатель между обычными лэндингами и группами") — та же
// логика, что и на project-scoped странице лендингов, плюс имя проекта на карточке группы
// (тут группы сразу из нескольких проектов) и AbTestGroupDialog с projectId===null (диалог сам
// просит выбрать проект — тот же приём, что уже применён к CreateLandingFromTemplateDialog).
export default function AllLandingsPage() {
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
          <h1 className="text-2xl font-bold">Все лендинги</h1>
          {/* Переключатель сгруппирован с заголовком на фиксированной левой стороне, чтобы не
              "прыгать" при смене состава кнопок справа (запрос пользователя 2026-08-20: "кнопка
              переключения... прыгает когда меняешь"). */}
          <div className="inline-flex rounded-lg border p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode('landings')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'landings' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Лендинги
            </button>
            <button
              type="button"
              onClick={() => setViewMode('groups')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'groups' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Группы (A/B/n)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {viewMode === 'landings' && hasAnyPermission(user, 'LANDINGS_CREATE') && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Создать из шаблона
            </Button>
          )}
          {viewMode === 'groups' && hasAnyPermission(user, 'AB_TESTS_CREATE') && (
            <Button onClick={() => setAbTestTarget({ projectId: null, groupId: null, preselectedIds: [] })}>
              <SplitSquareHorizontal className="w-4 h-4 mr-1.5" /> Создать тест
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'groups' && !!activeAbTestGroups.length && (
        <div className="space-y-2">
          {activeAbTestGroups.map((g) => {
            const attachment = findGroupAttachment(domains, g.id);
            return (
              <Card
                key={g.id}
                onClick={() => router.push(`/projects/${g.project?.id}/landings/groups/${g.id}`)}
                className="cursor-pointer transition-colors hover:ring-foreground/20"
              >
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{g.name || groupAutoLabel(g)}</p>
                      {g.project && (
                        <Link
                          href={`/projects/${g.project.id}/landings`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-600 hover:underline shrink-0"
                        >
                          {g.project.name}
                        </Link>
                      )}
                    </div>
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
                          onClick={() => unbindTestDomain.mutate({ domainId: attachment.domainId, pathId: attachment.pathId })}
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
                    <Button size="sm" variant="outline" onClick={() => setGetLinkGroupId(g.id)} disabled={!attachment}>
                      Ссылка
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAbTestTarget({ projectId: g.project?.id ?? null, groupId: g.id, preselectedIds: [] })}
                    >
                      Управлять
                    </Button>
                    {g.project && hasPermission(user, g.project.id, 'AB_TESTS_EDIT') && (
                      <Button size="sm" variant="outline" onClick={() => stopTest.mutate(g.id)} disabled={stopTest.isPending}>
                        Завершить тест
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {viewMode === 'groups' && !activeAbTestGroups.length && (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-muted-foreground">Тестов пока нет.</p>
            {hasAnyPermission(user, 'AB_TESTS_CREATE') && (
              <Button onClick={() => setAbTestTarget({ projectId: null, groupId: null, preselectedIds: [] })}>
                <Plus className="w-4 h-4 mr-1.5" /> Создать тест
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {viewMode === 'landings' && isLoading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

      {viewMode === 'landings' && !isLoading && landings?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">Лендингов пока нет.</CardContent>
        </Card>
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
                setAbTestTarget({
                  projectId: l.project.id,
                  groupId: l.abTestGroupId,
                  preselectedIds: l.abTestGroupId ? [] : [l.id],
                })
              }
              onPublish={() => publish.mutate(l.id)}
              onUnpublish={() => unpublish.mutate(l.id)}
              onDelete={() => remove.mutate(l.id)}
              // Раньше isPending читался с общей мутации целиком — клик по одной карточке
              // переводил кнопки ВСЕХ карточек в состояние ожидания (баг-репорт пользователя
              // 2026-07-30). Сверка с .variables — id, с которым мутация реально сейчас
              // выполняется — скоупит "ожидание" ровно на ту карточку, где кликнули.
              isPublishPending={(publish.isPending && publish.variables === l.id) || (unpublish.isPending && unpublish.variables === l.id)}
              isDeletePending={remove.isPending && remove.variables === l.id}
              canDelete={hasPermission(user, l.project.id, 'LANDINGS_DELETE')}
              abTestGroupLabel={l.abTestGroupId ? abTestLabels.get(l.abTestGroupId) : null}
            />
          ))}
        </div>
      )}

      <LandingDomainDialog
        landing={domainDialogLanding}
        domains={domains}
        onClose={() => setDomainDialogLanding(null)}
      />
      <AbTestGroupDialog
        target={abTestTarget}
        domains={domains}
        onClose={() => setAbTestTarget(null)}
        onSaved={invalidateAbTests}
      />
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
      <CreateLandingFromTemplateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        domains={domains}
      />
    </div>
  );
}
