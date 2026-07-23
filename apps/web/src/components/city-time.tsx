'use client';

// Город + текущее время в часовом поясе проекта (запрос пользователя 2026-07-21, карточка
// проекта) — Project.timezone хранит голую IANA-строку ("America/Bogota"), отдельного поля
// "город" в схеме нет и не нужно: последний сегмент IANA-зоны и есть человекочитаемое
// название города, показываем его напрямую вместо того, чтобы заводить дублирующее поле.
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export function cityFromTimezone(tz: string): string {
  if (!tz || tz === 'UTC') return 'UTC';
  const last = tz.split('/').pop() || tz;
  return last.replace(/_/g, ' ');
}

function formatTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch {
    return '';
  }
}

export function CityTime({ timezone, className }: { timezone: string; className?: string }) {
  const [time, setTime] = useState('');

  // Считаем время только после монтирования — на сервере и на клиенте часовой пояс браузера
  // отличается от timezone проекта, SSR посчитал бы неверное значение и словил hydration
  // mismatch при первой отрисовке.
  useEffect(() => {
    setTime(formatTime(timezone));
    const interval = setInterval(() => setTime(formatTime(timezone)), 30_000);
    return () => clearInterval(interval);
  }, [timezone]);

  if (!time) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className ?? ''}`}>
      <Clock className="w-3 h-3 shrink-0" />
      {cityFromTimezone(timezone)} · {time}
    </span>
  );
}
