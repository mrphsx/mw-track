'use client';

// Список строк как одна строка через запятую (тот же паттерн, что уже был у старого
// клоакинга — countriesText в landing-behavior-fields.tsx) — переиспользуется большинством
// условий движка правил (COUNTRY/REGION/CITY/IP/LANGUAGE/BROWSER/BROWSER_VERSION/OS/
// OS_VERSION), у которых config хранит string[]. Локальный текстовый стейт, а не пересборка
// строки из value на каждый рендер, — иначе normalize (trim/uppercase/dedupe) на каждое
// нажатие клавиши переписывал бы controlled-value прямо во время ввода и сбивал курсор
// (тот же класс проблемы, что countriesText уже решал, держа сырой текст отдельно).
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

function parseList(text: string, uppercase?: boolean): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (uppercase ? v.toUpperCase() : v)),
    ),
  );
}

export function TagListInput({
  value,
  onChange,
  placeholder,
  uppercase,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  uppercase?: boolean;
}) {
  const [text, setText] = useState(() => value.join(', '));

  // Синхронизация ТОЛЬКО когда значение снаружи реально отличается от того, что дал бы парсинг
  // текущего текста (переключение на другое условие/правило в редакторе) — не на каждый апдейт
  // родителя, иначе он же перезатрёт то, что печатает пользователь.
  useEffect(() => {
    if (JSON.stringify(parseList(text, uppercase)) !== JSON.stringify(value)) {
      setText(value.join(', '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value, uppercase));
      }}
    />
  );
}
