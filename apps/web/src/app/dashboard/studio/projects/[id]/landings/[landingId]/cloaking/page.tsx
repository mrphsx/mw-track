'use client';

// Studio-версия страницы клоакинга — 1:1 с classic (см. подробный комментарий там же), только
// STUDIO_CARD/StudioLinkButton вместо Card/Button (та же оболочка, что и остальные Studio-
// страницы; LandingCloakingFields — нейтральный shadcn, без реskin'а, см. .studio.dark CSS fix).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import {
  LandingCloakingFields,
  CloakingFieldsState,
  EMPTY_LANDING_BEHAVIOR,
  cloakingOnlyPayload,
} from '@/components/landing-behavior-fields';
import { STUDIO_CARD, StudioLinkButton } from '../../../../../ui';

interface LandingFull {
  id: string;
  name: string;
  cloakingEnabled: boolean;
  cloakingCountries: string[];
  cloakingRedirectUrl: string | null;
  cloakingType: 'REDIRECT' | 'PRELANDING';
  cloakingPrelandingBasePath: string | null;
}

export default function StudioLandingCloakingPage() {
  const { id: projectId, landingId } = useParams<{ id: string; landingId: string }>();
  const queryClient = useQueryClient();

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'full'],
    queryFn: async () => (await api.get<LandingFull>(`/landings/${landingId}`)).data,
  });

  const [state, setState] = useState<CloakingFieldsState>(EMPTY_LANDING_BEHAVIOR);
  const [error, setError] = useState('');

  // Инициализируем стейт из сервера ОДИН раз на этот landingId, а не при каждом рефетче
  // ['landing', landingId, 'full'] — см. подробный комментарий в classic-версии этой страницы
  // (баг-репорт 2026-09-23: CloakingPrelandingUpload инвалидирует тот же ключ после загрузки
  // white page, и без guard'а это откатывало ещё не сохранённый выбор режима).
  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!landing || initializedForRef.current === landingId) return;
    initializedForRef.current = landingId;
    setState({
      cloakingEnabled: landing.cloakingEnabled,
      cloakingType: landing.cloakingType ?? 'REDIRECT',
      countriesText: landing.cloakingCountries.join(', '),
      redirectUrl: landing.cloakingRedirectUrl || '',
    });
  }, [landing, landingId]);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/landings/${landingId}`, cloakingOnlyPayload(state));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing', landingId, 'full'] });
      setError('');
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось сохранить настройки'),
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
        <h2 className="text-sm font-semibold text-[#131A24] dark:text-[#E9EDF3]">Настройки клоакинга</h2>
        <LandingCloakingFields
          idPrefix="cloak"
          state={state}
          onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
          landingId={landingId}
          cloakingPrelandingUploaded={!!landing.cloakingPrelandingBasePath}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <StudioLinkButton variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем...' : 'Сохранить'}
        </StudioLinkButton>
      </div>
    </div>
  );
}
