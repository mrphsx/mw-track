'use client';

// Страница настроек клоакинга — движок правил (запрос пользователя 2026-09-24, "довести до
// уровня Keitaro"): общий выключатель, общая white-страница (используется любым правилом с
// действием PRELANDING) и список правил (CloakingRulesSection, components/cloaking/). Заменяет
// прежний плоский REDIRECT/PRELANDING по allow-листу стран — старые лендинги перенесены в
// эквивалентные правила бэкенд-миграцией, см. CLAUDE.md за подробностями.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { CloakingPrelandingUpload } from '@/components/cloaking-prelanding-upload';
import { CloakingRulesSection } from '@/components/cloaking/cloaking-rules-section';

interface LandingFull {
  id: string;
  name: string;
  cloakingEnabled: boolean;
  cloakingPrelandingBasePath: string | null;
}

export default function LandingCloakingPage() {
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

  if (!landing) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/landings/${landingId}`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {landing.name}
        </Link>
        <h1 className="text-2xl font-bold">Клоакинг</h1>
      </div>

      <Card>
        <CardContent className="pt-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Клоакинг включён</p>
            <p className="text-xs text-muted-foreground mt-0.5">Общий выключатель — при выключении правила ниже не проверяются вообще.</p>
          </div>
          <Switch checked={landing.cloakingEnabled} onCheckedChange={(v) => toggleEnabled.mutate(v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Общая white-страница</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Используется любым правилом ниже с действием «White-страница».</p>
          <CloakingPrelandingUpload landingId={landingId} hasUploaded={!!landing.cloakingPrelandingBasePath} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <CloakingRulesSection landingId={landingId} hasPrelandingUploaded={!!landing.cloakingPrelandingBasePath} />
        </CardContent>
      </Card>
    </div>
  );
}
