'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PersonalBroadcastComposer } from '../../personal-broadcasts-composer';

// projectId из query-параметра — см. classic (dashboard)/my-personal-broadcasts/new/page.tsx
// для полного комментария.
export default function StudioNewMyPersonalBroadcastPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const router = useRouter();

  if (!projectId) {
    return <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Проект не выбран.</p>;
  }

  return <PersonalBroadcastComposer projectId={projectId} onCreated={() => router.push('/my-personal-broadcasts')} />;
}
