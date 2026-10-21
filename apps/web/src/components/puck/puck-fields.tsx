'use client';

// Поля боковой панели визуального редактора: цвет, картинка с загрузкой, числа, выбор, да/нет.
// Puck рендерит их в основном документе (не в iframe страницы), поэтому здесь работают обычные
// классы Tailwind.

import { useEffect, useRef, useState } from 'react';
import type { CustomField, Field } from '@puckeditor/core';

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorEditor({ value, onChange, allowEmpty }: { value: string; onChange: (v: string) => void; allowEmpty: boolean }) {
  const [text, setText] = useState(value || '');
  useEffect(() => setText(value || ''), [value]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={HEX.test(value) ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5"
      />
      <input
        value={text}
        placeholder={allowEmpty ? 'нет' : '#RRGGBB'}
        maxLength={7}
        className="h-8 w-24 rounded border border-neutral-300 bg-white px-2 font-mono text-xs text-neutral-900"
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (HEX.test(v)) onChange(v.toUpperCase());
          if (allowEmpty && v === '') onChange('');
        }}
      />
      {allowEmpty && value && (
        <button type="button" onClick={() => onChange('')} className="text-xs text-blue-600 hover:underline">
          сбросить
        </button>
      )}
    </div>
  );
}

export function colorField(label: string, allowEmpty = true): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange }) => (
      <div>
        <div className="mb-1.5 text-xs font-medium text-neutral-600">{label}</div>
        <ColorEditor value={value || ''} onChange={onChange} allowEmpty={allowEmpty} />
      </div>
    ),
  };
}

export type ImageUploader = (file: File) => Promise<string>;

function ImageEditor({ value, onChange, upload }: { value: string; onChange: (v: string) => void; upload?: ImageUploader }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="space-y-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="max-h-32 w-full rounded border border-neutral-200 object-contain bg-neutral-50" />
      ) : (
        <div className="flex h-20 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-500">Картинка не выбрана</div>
      )}
      <div className="flex flex-wrap gap-2">
        {upload && (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy ? 'Загружаем…' : 'Загрузить файл'}
          </button>
        )}
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-xs text-red-600 hover:underline">
            Убрать
          </button>
        )}
      </div>
      <input
        value={value || ''}
        placeholder="или вставьте ссылку https://…"
        onChange={(e) => onChange(e.target.value.trim())}
        className="h-8 w-full rounded border border-neutral-300 bg-white px-2 text-xs text-neutral-900"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !upload) return;
          setBusy(true);
          setError('');
          try {
            onChange(await upload(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Не удалось загрузить');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function imageField(label: string, upload?: ImageUploader): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange }) => (
      <div>
        <div className="mb-1.5 text-xs font-medium text-neutral-600">{label}</div>
        <ImageEditor value={value || ''} onChange={onChange} upload={upload} />
      </div>
    ),
  };
}

export const num = (label: string, min: number, max: number, step = 1): Field => ({ type: 'number', label, min, max, step });

export const select = <T extends string>(label: string, options: Record<T, string>): Field => ({
  type: 'select',
  label,
  options: (Object.keys(options) as T[]).map((value) => ({ value, label: options[value] })),
});

export const radio = <T extends string>(label: string, options: Record<T, string>): Field => ({
  type: 'radio',
  label,
  options: (Object.keys(options) as T[]).map((value) => ({ value, label: options[value] })),
});

export const yesNo = (label: string): Field => ({
  type: 'radio',
  label,
  options: [
    { value: true, label: 'Да' },
    { value: false, label: 'Нет' },
  ],
});

export const text = (label: string, placeholder?: string): Field => ({ type: 'text', label, placeholder });
export const textarea = (label: string, placeholder?: string): Field => ({ type: 'textarea', label, placeholder });
