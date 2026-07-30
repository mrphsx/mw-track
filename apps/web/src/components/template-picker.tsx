'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TemplateInfo } from '@/lib/landings';
import { cn } from '@/lib/utils';

// Ширина/высота "виртуального экрана", который рендерится в iframe и затем ужимается
// transform:scale — так превью показывает реальную вёрстку шаблона (не нарисованный вручную
// муляж), просто в миниатюре. Пропорция примерно как у мобильного экрана, под который все
// текущие шаблоны и свёрстаны.
const PREVIEW_WIDTH = 380;
const PREVIEW_HEIGHT = 540;
const PREVIEW_SCALE = 0.26;

// Живая галерея шаблонов лендинга при создании (запрос пользователя 2026-07-15: "маленькое
// превью этих шаблонов, всех разом... чтобы человек видел как они будут выглядеть, не
// открывая ничего"). Список шаблонов и мини-превью каждого грузятся с бэкенда (GET /landings/
// templates + GET /landings/templates/:id/preview, реальный рендер template.html с демо-
// данными) — не статичные картинки, поэтому автоматически не расходятся с реальным видом
// шаблона (в отличие от previewUrl/preview.jpg, который годами 404-ит, см. память проекта).
export function TemplatePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data: templates } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: async () => (await api.get<TemplateInfo[]>('/landings/templates')).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data: previews } = useQuery({
    queryKey: ['landing-templates', 'previews'],
    queryFn: async () => {
      if (!templates) return {};
      const entries = await Promise.all(
        templates.map(async (t) => {
          const html = (await api.get(`/landings/templates/${t.id}/preview`, { responseType: 'text' })).data as string;
          return [t.id, html] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, string>;
    },
    enabled: !!templates?.length,
    staleTime: 5 * 60 * 1000,
  });

  if (!templates) return <p className="text-sm text-muted-foreground">Загрузка шаблонов...</p>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
      {templates.map((t) => {
        const isAvailable = t.available !== false;
        const isSelected = value === t.id;
        const html = previews?.[t.id];

        return (
          <button
            key={t.id}
            type="button"
            disabled={!isAvailable}
            onClick={() => isAvailable && onChange(t.id)}
            className={cn(
              'text-left rounded-lg border overflow-hidden transition-colors',
              isSelected ? 'ring-2 ring-primary border-primary' : 'border-input hover:border-foreground/30',
              !isAvailable && 'opacity-50 cursor-not-allowed',
            )}
          >
            <div
              className="w-full overflow-hidden bg-muted flex items-center justify-center"
              style={{ height: PREVIEW_HEIGHT * PREVIEW_SCALE }}
            >
              {html ? (
                <iframe
                  srcDoc={html}
                  title={t.name}
                  tabIndex={-1}
                  style={{
                    width: PREVIEW_WIDTH,
                    height: PREVIEW_HEIGHT,
                    transform: `scale(${PREVIEW_SCALE})`,
                    transformOrigin: 'center center',
                    flexShrink: 0,
                    border: 0,
                    pointerEvents: 'none',
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">...</div>
              )}
            </div>
            <div className="px-2 py-1.5 border-t bg-card min-h-[2.75rem] flex flex-col justify-center">
              <p className="text-xs font-medium leading-snug">{t.name}</p>
              {!isAvailable && <p className="text-[10px] text-muted-foreground">Скоро</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
