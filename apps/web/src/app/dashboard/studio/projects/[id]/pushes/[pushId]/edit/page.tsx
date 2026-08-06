'use client';

import { useParams } from 'next/navigation';
import { StudioPushComposer } from '../../../../../push-composer';

// Studio-версия редактирования рассылки — см. полный комментарий в classic-версии
// (apps/web/src/app/(dashboard)/projects/[id]/pushes/[pushId]/edit/page.tsx).
export default function StudioEditPushPage() {
  const { id, pushId } = useParams<{ id: string; pushId: string }>();
  return <StudioPushComposer initialProjectIds={[id]} editProjectId={id} pushId={pushId} />;
}
