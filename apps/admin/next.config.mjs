/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Переехало на отдельный поддомен admin.mw-track.com (запрос пользователя 2026-07-30, Фаза
  // 4.3E) — basePath /adminmw снят, приложение снова отдаётся с корня. nginx для этого домена
  // проксирует на 127.0.0.1:3002 без префикса пути.
};

export default nextConfig;
