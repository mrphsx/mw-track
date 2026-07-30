'use client';

import { MESSAGE_PLACEHOLDERS } from '@/lib/message-placeholders';

// Клик — вставляет плейсхолдер в конец текста (не в позицию курсора: Textarea в этом проекте
// не форвардит ref, отдельный ref-хак ради этого не стоит сложности — запрос пользователя
// 2026-07-27, "добавь список параметров... {first_name} и другие").
export function MessagePlaceholdersHint({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Подстановки:</span>
      {MESSAGE_PLACEHOLDERS.map((p) => (
        <button
          key={p.key}
          type="button"
          title={p.description}
          onClick={() => onInsert(`{${p.key}}`)}
          className="rounded border px-1.5 py-0.5 font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {`{${p.key}}`}
        </button>
      ))}
    </div>
  );
}
