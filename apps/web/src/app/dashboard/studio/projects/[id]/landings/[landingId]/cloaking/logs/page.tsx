'use client';

// Журнал заблокированных клоакингом заходов (запрос пользователя 2026-09-25) — Studio-only
// (см. feedback_studio_only_ui_changes) страница, отдельная от /cloaking по тому же принципу,
// что и сама страница правил стала отдельным роутом от "Опции лендинга" (2026-09-23) — растущий
// функционал заслуживает свою страницу, а не ещё одну секцию. Логируются ТОЛЬКО реально
// заблокированные визиты (пропущенные посетители сюда не попадают вообще).
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { CloakingLogsTable } from '@/components/cloaking/cloaking-logs-table';
import { STUDIO_CARD } from '../../../../../../ui';

interface LandingBasic {
  id: string;
  name: string;
}

export default function StudioCloakingLogsPage() {
  const { id: projectId, landingId } = useParams<{ id: string; landingId: string }>();

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'basic'],
    queryFn: async () => (await api.get<LandingBasic>(`/landings/${landingId}`)).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings/${landingId}/cloaking`}
          className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {landing?.name ? `Клоакинг — ${landing.name}` : 'Клоакинг'}
        </Link>
        <h1 className="text-2xl font-bold text-[#131A24] dark:text-[#E9EDF3]">Логи фильтрации</h1>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">
          Только реально заблокированные заходы — кто, по какому условию и когда был отфильтрован.
        </p>
      </div>

      <div className={`${STUDIO_CARD} p-5`}>
        <CloakingLogsTable landingId={landingId} />
      </div>
    </div>
  );
}
