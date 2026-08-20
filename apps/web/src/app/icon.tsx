import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Временная иконка вкладки (запрос пользователя 2026-08-18: "добавь хотя бы букву М, чтобы хоть
// что-то было") — раньше отдавался нетронутый дефолтный favicon.ico Next.js. Цвет — тот же
// брендовый синий, что у логотипа в сайдбаре Studio (#1F4E9C, StudioSidebar.tsx), один
// статичный вариант без dark/light-переключения — favicon не имеет доступа к теме приложения.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1F4E9C',
          borderRadius: 7,
          color: '#fff',
          fontSize: 22,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        M
      </div>
    ),
    { ...size },
  );
}
