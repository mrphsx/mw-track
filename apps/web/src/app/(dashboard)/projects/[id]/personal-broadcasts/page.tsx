'use client';

import { useParams } from 'next/navigation';
import { PersonalBroadcastsList } from '@/components/personal-broadcasts/broadcast-list';

// Рассылка с личного MTProto-аккаунта (запрос пользователя 2026-08-06) — параллельная бот-пушам
// фича. Содержимое вынесено в PersonalBroadcastsList (запрос пользователя 2026-08-14: та же
// страница нужна и Operator-у на /my-personal-broadcasts) — этот файл лишь читает projectId из
// URL, как и раньше.
export default function PersonalBroadcastsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  return <PersonalBroadcastsList projectId={projectId} newHref={`/projects/${projectId}/personal-broadcasts/new`} />;
}
