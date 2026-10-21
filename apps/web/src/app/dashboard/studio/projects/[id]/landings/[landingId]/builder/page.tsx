'use client';

// Редактирование лендинга из конструктора (2026-10-21).
import { useParams } from 'next/navigation';
import { LandingBuilderEditor } from '../../../../../landing-builder/editor';

export default function StudioLandingBuilderEditPage() {
  const { landingId } = useParams<{ landingId: string }>();
  return <LandingBuilderEditor landingId={landingId} />;
}
