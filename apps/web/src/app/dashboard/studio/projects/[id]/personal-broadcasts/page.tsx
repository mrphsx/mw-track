'use client';

import { useParams } from 'next/navigation';
import { PersonalBroadcastsList } from '../../../personal-broadcasts-list';

// Содержимое вынесено в PersonalBroadcastsList (запрос пользователя 2026-08-14: та же страница
// нужна и Operator-у на /dashboard/studio/my-personal-broadcasts) — этот файл лишь читает
// projectId из URL, как и раньше.
export default function StudioPersonalBroadcastsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  return <PersonalBroadcastsList projectId={projectId} newHref={`/projects/${projectId}/personal-broadcasts/new`} />;
}
