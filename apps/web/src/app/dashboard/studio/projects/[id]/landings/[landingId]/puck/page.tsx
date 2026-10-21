'use client';

// Редактирование лендинга из визуального редактора Puck (2026-10-21).
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const LandingPuckEditor = dynamic(() => import('../../../../../landing-puck/editor').then((m) => m.LandingPuckEditor), {
  ssr: false,
  loading: () => <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF]">Загрузка редактора…</p>,
});

export default function StudioLandingPuckEditPage() {
  const { landingId } = useParams<{ landingId: string }>();
  return <LandingPuckEditor landingId={landingId} />;
}
