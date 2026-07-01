// Загружает dist/browser.min.js в публичный MinIO-бакет как track.js — реальный
// "CDN-хостинг" из 13_SDK_AND_SNIPPET.md. Отдельный от приватного бакета лендингов
// (apps/api StorageService) бакет, потому что этот файл должен отдаваться без
// авторизации любому браузеру — лендинги наоборот никогда не должны быть публичными.
const fs = require('fs');
const path = require('path');
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
