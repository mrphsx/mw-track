import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import type { Readable } from 'stream';

// Хранит медиа приветственного сообщения бота (фото/видео/кружок/голосовое/документ) —
// тот же физический бакет, что и у лендингов (StorageService в LandingsModule), но отдельный
// сервис: ChannelsModule не может чисто заимпортировать StorageService (она не exported из
// LandingsModule, а LandingsModule сам импортирует ChannelsModule — импорт в обратную сторону
// замкнул бы цикл). Дублирование ~30 строк MinIO-клиента дешевле, чем распутывание модулей
// ради одного сервиса, который тут нужен лишь для put/get/remove одного объекта за раз (в
// отличие от StorageService, которому ещё нужен uploadDirectory для целого ZIP).
@Injectable()
export class ChannelMediaService implements OnModuleInit {
  private readonly logger = new Logger(ChannelMediaService.name);
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
      this.logger.warn(`MinIO bucket check/create failed: ${(error as Error).message}`);
    }
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': contentType });
  }

  async getObjectStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  // Content-Type, сохранённый при uploadBuffer — нужен раздающему роуту, чтобы Telegram (или
  // браузер) корректно понял тип файла по HTTP-заголовку, а не гадал по расширению.
  async getContentType(key: string): Promise<string | undefined> {
    const stat = await this.client.statObject(this.bucket, key);
    return stat.metaData?.['content-type'];
  }

  // Content-Type + Size одним запросом к MinIO — раздающие роуты должны явно проставлять
  // Content-Length (баг, репорт пользователя 2026-07-17: альбом из 2 фото падал в Telegram с
  // "WEBPAGE_CURL_FAILED" — sendMediaGroup, в отличие от одиночных sendPhoto/sendVideo,
  // жёстче к фетчу по ссылке и явно требует знать размер заранее; без Content-Length
  // chunked-ответ curl-фетчер Telegram не принимает для альбомов).
  async getStat(key: string): Promise<{ contentType?: string; size?: number } | undefined> {
    try {
      const stat = await this.client.statObject(this.bucket, key);
      return { contentType: stat.metaData?.['content-type'], size: stat.size };
    } catch {
      return undefined;
    }
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key).catch(() => {});
  }
}
