'use client';

// Отдельная страница настроек клоакинга (запрос пользователя 2026-09-23: "не в карточку/вкладку
// Опций, а на отдельную страницу, кнопку наверх страницы лендинга") — сама страница лендинга
// уже большая, а вариантов клоакинга (REDIRECT, PRELANDING, ...) со временем станет больше.
// Читает/пишет только 4 поля клоакинга (CloakingFieldsState) — PATCH шлёт cloakingOnlyPayload,
// узкий пейлоад без полей "Опций" (autoRedirect/lead*/tiktok*), так что сохранение здесь не
// может задеть их, и наоборот. См. landing-behavior-fields.tsx.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LandingCloakingFields,
  CloakingFieldsState,
  EMPTY_LANDING_BEHAVIOR,
  cloakingOnlyPayload,
} from '@/components/landing-behavior-fields';

interface LandingFull {
  id: string;
  name: string;
  cloakingEnabled: boolean;
  cloakingCountries: string[];
  cloakingRedirectUrl: string | null;
  cloakingType: 'REDIRECT' | 'PRELANDING';
  cloakingPrelandingBasePath: string | null;
}

export default function LandingCloakingPage() {
  const { id: projectId, landingId } = useParams<{ id: string; landingId: string }>();
  const queryClient = useQueryClient();

  const { data: landing } = useQuery({
    queryKey: ['landing', landingId, 'full'],
    queryFn: async () => (await api.get<LandingFull>(`/landings/${landingId}`)).data,
  });

  const [state, setState] = useState<CloakingFieldsState>(EMPTY_LANDING_BEHAVIOR);
  const [error, setError] = useState('');

  // Инициализируем стейт из сервера ОДИН раз на этот landingId, а не при каждом рефетче
  // ['landing', landingId, 'full'] (баг-репорт пользователя 2026-09-23: "загрузил white page —
  // страницу откатило на 'без фильтрации'"). Причина: CloakingPrelandingUpload после успешной
  // загрузки инвалидирует тот же самый ключ (нужно ему для cloakingPrelandingUploaded), и без
  // этого guard'а эффект слепо перезаписывал ещё не сохранённый локальный выбор режима
  // (cloakingEnabled/cloakingType) значением из БД, которое upload вообще не трогает.
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
        <CardHeader>
          <CardTitle className="text-base">Настройки клоакинга</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LandingCloakingFields
            idPrefix="cloak"
            state={state}
            onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            landingId={landingId}
            cloakingPrelandingUploaded={!!landing.cloakingPrelandingBasePath}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
