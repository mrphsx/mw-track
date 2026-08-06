'use client';

import { useParams } from 'next/navigation';
import { PushComposer } from '@/components/pushes/push-composer';

// Единая страница создания рассылки (запрос пользователя 2026-08-04) — вместо прежнего
// 3-шагового мастера рендерит общий PushComposer с этим проектом уже предвыбранным (пункт 3
// запроса: "уже выбран проект с которого мы перешли"), но не единственным — форма всё равно
// показывает остальные доступные проекты для мульти-выбора.
export default function NewPushPage() {
  const { id } = useParams<{ id: string }>();
  return <PushComposer initialProjectIds={[id]} />;
}
