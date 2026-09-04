// Загружает dist/browser.min.js в публичный MinIO-бакет как track.js — реальный
// "CDN-хостинг" из 13_SDK_AND_SNIPPET.md. Отдельный от приватного бакета лендингов
// (apps/api StorageService) бакет, потому что этот файл должен отдаваться без
// авторизации любому браузеру — лендинги наоборот никогда не должны быть публичными.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('minio');

require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const endpoint = new URL(process.env.MINIO_ENDPOINT || 'http://localhost:9000');
const bucket = process.env.MINIO_CDN_BUCKET || 'trafficcrm-cdn';

const minio = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
  useSSL: endpoint.protocol === 'https:',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const PUBLIC_READ_POLICY = (bucketName) => ({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${bucketName}/*`],
    },
  ],
});

async function main() {
  const exists = await minio.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await minio.makeBucket(bucket);
    console.log(`[publish-cdn] created bucket "${bucket}"`);
  }
  await minio.setBucketPolicy(bucket, JSON.stringify(PUBLIC_READ_POLICY(bucket)));

  const file = path.join(__dirname, '../dist/browser.min.js');
  if (!fs.existsSync(file)) {
    console.error(`[publish-cdn] ${file} not found — run "npm run build" first`);
    process.exit(1);
  }

  await minio.fPutObject(bucket, 'track.js', file, { 'Content-Type': 'application/javascript' });
  console.log(`[publish-cdn] uploaded track.js to bucket "${bucket}" (public-read)`);

  // track.js отдаётся с Cache-Control:max-age=14400 (4ч, дефолт Cloudflare для статики) —
  // без версии в URL это раз за разом обкрадывало ручную проверку фиксов SDK ещё до истечения
  // TTL (2026-08-25: TikTok-подсказка на iOS не появлялась именно из-за кэша, а не бага —
  // выяснилось только через прямую эмуляцию реального TikTok-браузера). Хэш содержимого,
  // записанный сюда, читает LandingRendererService и подставляет как ?v=<hash> в src
  // track.js — при следующей пересборке/деплое apps/api ссылка на лендингах меняется
  // сама, и браузер/CDN гарантированно тянут свежий файл, минуя любой TTL-кэш.
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  const versionFile = path.join(__dirname, '../../api/src/modules/landings/sdk-version.json');
  fs.writeFileSync(versionFile, JSON.stringify({ hash }) + '\n');
  console.log(`[publish-cdn] wrote sdk version hash "${hash}" to ${path.relative(process.cwd(), versionFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
