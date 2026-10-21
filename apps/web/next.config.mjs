/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Сборка в отдельную папку (scripts/deploy-web.sh, 2026-10-21): пока шла `next build` прямо в
  // .next, живой сервер отдавал страницы со ссылками на уже удалённые CSS/JS — у открытых вкладок
  // пропадали стили (400/404). Сервер (`next start`) всегда работает из .next.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
};

export default nextConfig;
