'use client';

import { useParams } from 'next/navigation';
import { StudioPushComposer } from '../../../../push-composer';

// Единая страница создания рассылки (запрос пользователя 2026-08-04) — вместо прежнего
// 3-шагового мастера рендерит общий StudioPushComposer с этим проектом уже предвыбранным
// (пункт 3 запроса: "уже выбран проект с которого мы перешли"), но не единственным — форма
// всё равно показывает остальные доступные проекты для мульти-выбора. См. classic-версию
// (apps/web/.../(dashboard)/projects/[id]/pushes/new/page.tsx) для симметрии.
export default function StudioNewPushPage() {
  const { id } = useParams<{ id: string }>();
  return <StudioPushComposer initialProjectIds={[id]} />;
}
