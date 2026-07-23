/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Временно отдаётся по пути /adminmw на основном домене вместо отдельного поддомена (запрос
  // пользователя 2026-07-20, до Фазы E) — nginx проксирует ПОЛНЫЙ путь на 127.0.0.1:3002 без
  // обрезания префикса, basePath заставляет сам Next добавлять /adminmw ко всем внутренним
  // роутам/статике/router.push автоматически, без ручных правок по всему коду.
  basePath: '/adminmw',
};

export default nextConfig;
