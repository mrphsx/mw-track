import * as fs from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import type { Readable } from 'stream';

// Бакет приватный (без публичной bucket policy) — кастомные лендинги отдаются не напрямую
// из MinIO, а проксируются через InternalController/LandingRendererService (тот же trust
// boundary, что и у TEMPLATE-лендингов), поэтому права на чтение не выдаём наружу.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: Minio.Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    const endpoint = new URL(this.config.get<string>('MINIO_ENDPOINT') || 'http://localhost:9000');
    this.client = new Minio.Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY') || '',
      secretKey: this.config.get<string>('MINIO_SECRET_KEY') || '',
    });
    this.bucket = this.config.get<string>('MINIO_BUCKET') || 'trafficcrm-landings';
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) await this.client.makeBucket(this.bucket);
    } catch (error) {
      // MinIO может быть недоступен в части дев-сценариев — не блокируем старт всего API
      // из-за этого, ошибка проявится позже, при первой реальной загрузке/отдаче лендинга.
      this.logger.warn(`MinIO bucket check/create failed: ${(error as Error).message}`);
    }
  }

  async uploadDirectory(localDir: string, prefix: string): Promise<void> {
    const files = await this.walk(localDir);
    for (const file of files) {
      const relative = path.relative(localDir, file).split(path.sep).join('/');
      await this.client.fPutObject(this.bucket, `${prefix}/${relative}`, file);
    }
  }

  // Загрузка одного файла из буфера (не директории) — для аватарки лендинга
  // (landing-avatars/, см. LandingsService.uploadAvatar), в отличие от uploadDirectory,
  // которая распаковывает целый ZIP кастомного лендинга.
  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': contentType });
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key).catch(() => {});
  }

  async getObjectStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  // Подчищает все объекты под префиксом — нужно перед ре-загрузкой ZIP, иначе старые файлы,
  // отсутствующие в новом архиве, остались бы висеть в бакете и могли отдаваться по старым путям.
  async removePrefix(prefix: string): Promise<void> {
    const objectNames: string[] = [];
    const stream = this.client.listObjectsV2(this.bucket, `${prefix}/`, true);
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj) => obj.name && objectNames.push(obj.name));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (objectNames.length > 0) await this.client.removeObjects(this.bucket, objectNames);
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await this.walk(full)));
      else files.push(full);
    }
    return files;
  }
}
