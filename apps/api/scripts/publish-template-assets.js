// Загружает статические ассеты лендинг-шаблонов (bg.svg, preview.jpg и т.п. — всё, кроме
// самого template.html) в публичный MinIO CDN-бакет, под ключом templates/<templateId>/<file>
// — тот же бакет и та же публичная bucket policy, что уже использует apps/sdk/scripts/
// publish-cdn.js для track.js. Нужно, потому что StorageService (apps/api) держит ПРИВАТНЫЙ
// бакет (trafficcrm-landings) — оттуда нельзя отдать файл напрямую в CSS background-image:
// url(...) без авторизации, а публичные ассеты шаблонов (например tg-invite-dark/bg.svg,
// см. LandingRendererService) именно так и подключаются в HTML лендинга.
const fs = require('fs');
const path = require('path');
const { Client } = require('minio');

require('dotenv').config({ path: path.join(__dirname, '../../../.env.prod') });

const endpoint = new URL(process.env.MINIO_ENDPOINT || 'http://localhost:9000');
const bucket = process.env.MINIO_CDN_BUCKET || 'trafficcrm-cdn';

const minio = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
  useSSL: endpoint.protocol === 'https:',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const CONTENT_TYPES = {
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function main() {
  const templatesDir = path.join(__dirname, '../src/modules/landings/templates');
  const templateIds = fs.readdirSync(templatesDir).filter((f) => fs.statSync(path.join(templatesDir, f)).isDirectory());

  let uploaded = 0;
  for (const templateId of templateIds) {
    const dir = path.join(templatesDir, templateId);
    const files = fs.readdirSync(dir).filter((f) => f !== 'template.html');
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      await minio.fPutObject(bucket, `templates/${templateId}/${file}`, path.join(dir, file), { 'Content-Type': contentType });
      console.log(`[publish-template-assets] uploaded templates/${templateId}/${file}`);
      uploaded++;
    }
  }

  if (uploaded === 0) console.log('[publish-template-assets] nothing to upload (no non-template.html files found)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
