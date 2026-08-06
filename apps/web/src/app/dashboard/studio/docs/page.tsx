'use client';

import { DocumentationContent } from '@/components/docs/documentation-content';

// Studio-версия страницы документации — тот же shared DocumentationContent, что и в
// классике, файл-обёртка отличается только заголовком в фирменной палитре Studio (см. тот
// же приём в audience/domains).
export default function StudioDocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#131A24] dark:text-[#E9EDF3] tracking-tight">Документация</h1>
        <p className="text-sm text-[#5F6B7A] dark:text-[#92A0AF] mt-1">Как использовать каждую возможность MWTRACK.</p>
      </div>
      <DocumentationContent />
    </div>
  );
}
