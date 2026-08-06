'use client';

import { DocumentationContent } from '@/components/docs/documentation-content';

export default function DocsPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Документация</h1>
        <p className="text-sm text-muted-foreground mt-1">Как использовать каждую возможность MWTRACK.</p>
      </div>
      <DocumentationContent />
    </div>
  );
}
