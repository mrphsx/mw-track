'use client';

// Новый лендинг в конструкторе (2026-10-21). ?projectId= — проект заранее выбран (переход со
// страницы лендингов проекта), без него проект выбирается в верхней панели редактора.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LandingBuilderEditor } from '../../landing-builder/editor';

function NewBuilderLanding() {
  const projectId = useSearchParams().get('projectId') ?? undefined;
  return <LandingBuilderEditor initialProjectId={projectId} />;
}

export default function StudioLandingBuilderNewPage() {
  return (
    <Suspense fallback={null}>
      <NewBuilderLanding />
    </Suspense>
  );
}
