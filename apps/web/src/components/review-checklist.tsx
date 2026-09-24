'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { LandingReviewCheck } from '@/lib/landings';

// Общий чеклист результатов проверки — используется и для CUSTOM-лендинга (проверка ZIP при
// загрузке), и для EXTERNAL (проверка подключения через "Проверить подключение", запрос
// пользователя 2026-09-07) — один визуальный компонент для обоих сценариев, семантические
// Tailwind-токены (не хардкод-цвета) — тот же приём, что и у остальных общих диалогов в этой
// сессии, чтобы корректно отображаться в тёмной теме Studio без отдельной правки.
export function ReviewChecklist({ checks }: { checks: LandingReviewCheck[] }) {
  return (
    <div className="space-y-2">
      {checks.map((check) => (
        <div key={check.id} className="flex items-start gap-2 text-sm">
          {check.passed ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <div className="min-w-0">
            <p className={check.passed ? 'text-foreground' : 'text-foreground font-medium'}>{check.label}</p>
            {check.detail && <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
