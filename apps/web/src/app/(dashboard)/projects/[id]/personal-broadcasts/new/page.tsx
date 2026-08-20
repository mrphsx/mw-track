'use client';

import { useParams, useRouter } from 'next/navigation';
import { PersonalBroadcastComposer } from '@/components/personal-broadcasts/broadcast-composer';

// Форма вынесена в PersonalBroadcastComposer (запрос пользователя 2026-08-14: та же форма
// нужна и Operator-у на /my-personal-broadcasts/new) — этот файл лишь читает projectId из URL
// и редиректит на project-scoped список после успешного создания, как и раньше.
export default function NewPersonalBroadcastPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  return <PersonalBroadcastComposer projectId={projectId} onCreated={() => router.push(`/projects/${projectId}/personal-broadcasts`)} />;
}
