// PM2's `env_file` option does not reliably propagate to the child process on this
// PM2 version — parse .env.prod ourselves at config-load time and pass it as `env`.
const dotenv = require('dotenv');
const fs = require('fs');
const envConfig = dotenv.parse(fs.readFileSync('/var/www/mw-track/.env.prod'));

module.exports = {
  apps: [
    {
      name: 'trafficcrm-api',
      script: 'apps/api/dist/main.js',
      cwd: '/var/www/mw-track',
      node_args: '--enable-source-maps',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      kill_timeout: 10000,
      env: envConfig,
      error_file: '/var/www/mw-track/logs/api-error.log',
      out_file: '/var/www/mw-track/logs/api-out.log',
      time: true,
    },
    {
      name: 'trafficcrm-web',
      script: '/var/www/mw-track/node_modules/.bin/next',
      args: 'start --port 3000',
      cwd: '/var/www/mw-track/apps/web',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      kill_timeout: 10000,
      env: envConfig,
      error_file: '/var/www/mw-track/logs/web-error.log',
      out_file: '/var/www/mw-track/logs/web-out.log',
      time: true,
    },
    {
      // Платформенная админка (Фаза 4.3A, запрос пользователя 2026-07-19) — отдельное
      // Next.js-приложение. Слушает ТОЛЬКО 127.0.0.1 (см. apps/admin/package.json's
      // `start` script, `-H 127.0.0.1`) — тот же принцип, что уже применён к
      // Postgres/Redis/MinIO в этом проекте ("не должны быть доступны из интернета"): пока
      // нет nginx+TLS перед ней (Фаза 4.3E, поддомен, ещё не сделана), гонять сюда
      // Bearer-токены супер-админа по голому HTTP с публичного IP было бы реальной дырой.
      // Доступ до Фазы E — только с самого сервера или через SSH-туннель.
      name: 'trafficcrm-admin',
      script: '/var/www/mw-track/node_modules/.bin/next',
      args: 'start -H 127.0.0.1 --port 3002',
      cwd: '/var/www/mw-track/apps/admin',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      kill_timeout: 10000,
      env: envConfig,
      error_file: '/var/www/mw-track/logs/admin-error.log',
      out_file: '/var/www/mw-track/logs/admin-out.log',
      time: true,
    },
  ],
};
