import { ImageResponse } from 'next/og';
import { BRAND_MARK_PATH } from '@/components/brand-mark';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Иконка вкладки — тот же знак, что в сайдбаре (components/brand-mark.tsx, 2026-10-26): жирная
// блочная «M» на брендовом синем. Один вариант: favicon не знает темы.
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1F4E9C', borderRadius: 8 }}>
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d={BRAND_MARK_PATH} fill="#fff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
