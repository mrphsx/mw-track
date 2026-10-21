'use client';

// Мелкие элементы управления конструктора: подпись, сегменты, цвет, ползунок, переключатель.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5 min-w-0', className)}>
      <div className="text-xs font-medium text-[#5F6B7A] dark:text-[#92A0AF]">{label}</div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-[#8A95A3] dark:text-[#7D8A99]">{hint}</p>}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-[#DCE1E8] dark:border-white/10 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#131A24] dark:text-[#E9EDF3]">{title}</h4>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-[#DCE1E8] dark:border-white/10 bg-[#F3F5F8] dark:bg-white/5 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-colors whitespace-nowrap',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
            value === o.value
              ? 'bg-white dark:bg-[#243041] text-[#131A24] dark:text-[#E9EDF3] shadow-sm'
              : 'text-[#5F6B7A] dark:text-[#92A0AF] hover:text-[#131A24] dark:hover:text-[#E9EDF3]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

// optional — пустое значение означает «как по умолчанию» (кнопка «Авто»).
export function ColorInput({ value, onChange, optional, fallback = '#FFFFFF' }: { value: string; onChange: (v: string) => void; optional?: boolean; fallback?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-8 w-9 shrink-0 cursor-pointer rounded border border-[#DCE1E8] dark:border-white/10 bg-transparent p-0.5"
      />
      <Input
        value={text}
        placeholder={optional ? 'Авто' : '#RRGGBB'}
        maxLength={7}
        className="h-8 w-24 font-mono text-xs"
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (HEX.test(v)) onChange(v.toUpperCase());
          if (optional && v === '') onChange('');
        }}
      />
      {optional && value && (
        <button type="button" onClick={() => onChange('')} className="text-[11px] text-[#1F4E9C] dark:text-[#7BA9EE] hover:underline">
          авто
        </button>
      )}
    </div>
  );
}

export function Range({ value, onChange, min, max, step = 1, suffix = '' }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[#1F4E9C] dark:accent-[#7BA9EE]"
      />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-[#5F6B7A] dark:text-[#92A0AF]">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm text-[#131A24] dark:text-[#E9EDF3]">{label}</span>
        {hint && <span className="block text-[11px] text-[#8A95A3] dark:text-[#7D8A99]">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
