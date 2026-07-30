'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { DomainOption, LandingItem, computeAbTestGroupLabels, findLandingAttachment } from '@/lib/landings';
import { AbTestDialogTarget, AbTestGroupDialog, LandingCard, LandingDomainDialog } from '@/components/landing-card';
import { GetLinkDialog } from '@/components/get-link-dialog';
import { CreateLandingFromTemplateDialog } from '@/components/create-landing-dialog';
import { useAuthStore } from '@/store/auth.store';
import { hasAnyPermission, hasPermission } from '@/lib/permissions';
import { STUDIO_CARD, StudioLinkButton } from '../ui';

// Цветная точка вместо текстового Badge статуса — тот же STATUS_DOT_CLASS/приём, что и на
// per-project Studio-странице лендингов (2026-07-30, после 3 заходов на оформление статуса).
const STATUS_DOT_CLASS: Record<string, string> = {
  PUBLISHED: 'bg-[#1F7A6C] dark:bg-[#6FCBBA]',
  DRAFT: 'bg-[#52606B] dark:bg-[#A6B4C0]',
  ARCHIVED: 'bg-[#6B3E63] dark:bg-[#D19BC4]',
};

// Studio-версия компанейской страницы "Все лендинги" (запрос пользователя 2026-07-30: "давай
// дальше") — логика 1:1 с классической (apps/web/.../(dashboard)/landings/page.tsx). Проще
// per-project Studio-версии лендингов: здесь нет A/B-группового списка, режима сравнения и
// загрузки ZIP — компанейская страница их никогда не имела и в классике. LandingCard/диалоги
// переиспользованы без форка, тот же принцип, что и везде в Studio.
export default function StudioAllLandingsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [domainDialogLanding, setDomainDialogLanding] = useState<LandingItem | null>(null);
  const [getLinkLanding, setGetLinkLanding] = useState<LandingItem | null>(null);
  const [abTestTarget, setAbTestTarget] = useState<AbTestDialogTarget | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: landings, isLoading } = useQuery({
    queryKey: ['landings', 'all'],
    queryFn: async () => (await api.get<LandingItem[]>('/landings')).data,
  });

  const abTestLabels = useMemo(() => computeAbTestGroupLabels(landings), [landings]);

  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => (await api.get<DomainOption[]>('/domains')).data,
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
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Все лендинги</h1>
        {hasAnyPermission(user, 'LANDINGS_CREATE') && (
          <StudioLinkButton variant="primary" icon={Plus} onClick={() => setShowCreateDialog(true)}>
            Создать из шаблона
          </StudioLinkButton>
        )}
      </div>

      {isLoading && <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>}

      {!isLoading && landings?.length === 0 && (
        <div className={`${STUDIO_CARD} p-8 text-center text-sm text-[#5F6B7A] dark:text-[#92A0AF]`}>Лендингов пока нет.</div>
      )}

      {!!landings?.length && (
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
            />
          ))}
        </div>
      )}

      <LandingDomainDialog landing={domainDialogLanding} domains={domains} onClose={() => setDomainDialogLanding(null)} />
      <AbTestGroupDialog target={abTestTarget} domains={domains} onClose={() => setAbTestTarget(null)} />
      <GetLinkDialog
        landing={getLinkLanding}
        attachment={getLinkLanding ? findLandingAttachment(domains, getLinkLanding.id) : null}
        onClose={() => setGetLinkLanding(null)}
      />
      <CreateLandingFromTemplateDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} domains={domains} />
    </div>
  );
}
