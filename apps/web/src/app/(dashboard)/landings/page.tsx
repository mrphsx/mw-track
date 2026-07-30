'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import {
  DomainOption,
  LandingItem,
  computeAbTestGroupLabels,
  findLandingAttachment,
} from '@/lib/landings';
import {
  AbTestDialogTarget,
  AbTestGroupDialog,
  LandingCard,
  LandingDomainDialog,
} from '@/components/landing-card';
import { GetLinkDialog } from '@/components/get-link-dialog';
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
export default function AllLandingsPage() {
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Все лендинги</h1>
        {hasAnyPermission(user, 'LANDINGS_CREATE') && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Создать из шаблона
          </Button>
        )}
      </div>

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
      />
      <GetLinkDialog
        landing={getLinkLanding}
        attachment={getLinkLanding ? findLandingAttachment(domains, getLinkLanding.id) : null}
        onClose={() => setGetLinkLanding(null)}
      />
      <CreateLandingFromTemplateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        domains={domains}
      />
    </div>
  );
}
