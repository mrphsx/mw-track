'use client';

import { useParams } from 'next/navigation';
import { PushComposer } from '@/components/pushes/push-composer';

// Редактирование существующей рассылки (запрос пользователя 2026-08-05: "добавь возможность
// редактирования существующих рассылок запланированных") — тот же PushComposer, что и создание,
// просто с pushId/editProjectId — он сам переключается в режим редактирования (предзаполнение,
// PATCH вместо POST). PushesService.assertEditable на бэкенде уже ограничивает это DRAFT/
// SCHEDULED — если пуш уже отправляется/отправлен, PATCH вернёт 403 и форма покажет ошибку.
export default function EditPushPage() {
  const { id, pushId } = useParams<{ id: string; pushId: string }>();
  return <PushComposer initialProjectIds={[id]} editProjectId={id} pushId={pushId} />;
}
