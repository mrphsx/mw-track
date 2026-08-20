'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PersonalBroadcastComposer } from '@/components/personal-broadcasts/broadcast-composer';

// projectId приходит из query-параметра (не из URL-сегмента, этот роут company-wide, не
// project-scoped) — ссылка на эту страницу всегда несёт ?projectId= (см. my-personal-broadcasts
// page.tsx и broadcast-list.tsx's "Новая рассылка"). См. .../my-personal-broadcasts/page.tsx для
// полного комментария о причине этой страницы.
export default function NewMyPersonalBroadcastPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const router = useRouter();

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">Проект не выбран.</p>;
  }

  return <PersonalBroadcastComposer projectId={projectId} onCreated={() => router.push('/my-personal-broadcasts')} />;
}
