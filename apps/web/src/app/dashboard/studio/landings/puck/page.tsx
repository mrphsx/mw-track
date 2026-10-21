'use client';

// Новый лендинг в визуальном редакторе Puck (2026-10-21). ?projectId= — проект заранее выбран.
// Редактор грузится только в браузере: Puck работает с DOM и iframe.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

const LandingPuckEditor = dynamic(() => import('../../landing-puck/editor').then((m) => m.LandingPuckEditor), {
  ssr: false,
  loading: () => <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка редактора…</p>,
});

function NewPuckLanding() {
  const projectId = useSearchParams().get('projectId') ?? undefined;
  return <LandingPuckEditor initialProjectId={projectId} />;
}

export default function StudioLandingPuckNewPage() {
  return (
    <Suspense fallback={null}>
      <NewPuckLanding />
    </Suspense>
  );
}
