'use client';

// Studio-версия страницы клоакинга — движок правил (запрос пользователя 2026-09-24, "довести до
// уровня Keitaro"), 1:1 с classic (см. подробный комментарий там же), только STUDIO_CARD/
// StudioLinkButton вместо Card/Button. Switch/CloakingRulesSection/CloakingPrelandingUpload —
// нейтральные компоненты, без реskin'а под Studio (см. .studio.dark CSS fix).
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { CloakingPrelandingUpload } from '@/components/cloaking-prelanding-upload';
import { CloakingRulesSection } from '@/components/cloaking/cloaking-rules-section';
import { STUDIO_CARD } from '../../../../../ui';

interface LandingFull {
  id: string;
  name: string;
  cloakingEnabled: boolean;
  cloakingPrelandingBasePath: string | null;
}

export default function StudioLandingCloakingPage() {
  const { id: projectId, landingId } = useParams<{ id: string; landingId: string }>();
  const queryClient = useQueryClient();

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'full'],
    queryFn: async () => (await api.get<LandingFull>(`/landings/${landingId}`)).data,
  });

  const toggleEnabled = useMutation({
    mutationFn: async (cloakingEnabled: boolean) => api.patch(`/landings/${landingId}`, { cloakingEnabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'full'] }),
  });

  if (!landing) return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка...</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings/${landingId}`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {landing.name}
        </Link>
        <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3]">Клоакинг</h1>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-4`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Клоакинг включён</h2>
            <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF] mt-0.5">Общий выключатель — при выключении правила ниже не проверяются вообще.</p>
          </div>
          <Switch checked={landing.cloakingEnabled} onCheckedChange={(v) => toggleEnabled.mutate(v)} />
        </div>
      </div>

      <div className={`${STUDIO_CARD} p-5 space-y-3`}>
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Общая white-страница</h2>
        <p className="text-xs text-[#5F6B7A] dark:text-[#92A0AF]">Используется любым правилом ниже с действием «White-страница».</p>
        <CloakingPrelandingUpload landingId={landingId} hasUploaded={!!landing.cloakingPrelandingBasePath} />
      </div>

      <div className={`${STUDIO_CARD} p-5`}>
        <CloakingRulesSection landingId={landingId} hasPrelandingUploaded={!!landing.cloakingPrelandingBasePath} />
      </div>
    </div>
  );
}
