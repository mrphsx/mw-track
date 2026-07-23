import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BotScenario, Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from './channels.service';
import { ChannelMediaService } from './channel-media.service';
import { VideoProcessingService } from './video-processing.service';
import { CreateBotScenarioDto, UpdateBotScenarioDto, assertValidCommand } from './dto/bot-scenario.dto';

const MAX_SCENARIO_MEDIA_SIZE = 20 * 1024 * 1024;

// Тот же набор типов/content-type, что и у приветственного сообщения (Channel.tgWelcomeMedia*,
// см. ChannelsService) — сценарии используют идентичную форму медиа-контента.
const SCENARIO_MEDIA_CONTENT_TYPE: Record<string, string> = {
  PHOTO: 'image/jpeg',
  VIDEO: 'video/mp4',
  VIDEO_NOTE: 'video/mp4',
  VOICE: 'audio/ogg',
  DOCUMENT: 'application/octet-stream',
};

@Injectable()
export class BotScenariosService {
  private readonly logger = new Logger(BotScenariosService.name);

  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
    private channelMedia: ChannelMediaService,
    private videoProcessing: VideoProcessingService,
  ) {}

  async findAll(channelId: string, companyId: string): Promise<BotScenario[]> {
    await this.channelsService.findOne(channelId, companyId);
    return this.prisma.botScenario.findMany({
      where: { channelId, companyId, deletedAt: null },
      orderBy: [{ triggerType: 'asc' }, { command: 'asc' }],
    });
  }

  async create(channelId: string, companyId: string, dto: CreateBotScenarioDto): Promise<BotScenario> {
    await this.channelsService.findOne(channelId, companyId);
    const command = assertValidCommand(dto.triggerType, dto.command);

    try {
      return await this.prisma.botScenario.create({
        data: {
          channelId,
          companyId,
          triggerType: dto.triggerType,
          command,
          isActive: dto.isActive ?? true,
          delaySeconds: dto.delaySeconds ?? 0,
          messageText: dto.messageText,
          buttons: dto.buttons ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (error) {
      // Уникальный индекс (channelId, triggerType, command) — либо повтор той же команды,
      // либо повторная попытка создать второй синглтон-сценарий одного типа (для тех
      // сценарий должен быть один update, а не create — см. UI, но защита нужна и на бэкенде).
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BadRequestException(
          dto.triggerType === 'COMMAND' ? 'Такая команда уже настроена' : 'Такой сценарий для этого канала уже существует — отредактируйте его',
        );
      }
      throw error;
    }
  }

  async update(id: string, companyId: string, dto: UpdateBotScenarioDto): Promise<BotScenario> {
    await this.findOne(id, companyId);
    return this.prisma.botScenario.update({
      where: { id },
      data: {
        isActive: dto.isActive,
        delaySeconds: dto.delaySeconds,
        messageText: dto.messageText,
        buttons: dto.buttons !== undefined ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  async remove(id: string, companyId: string): Promise<void> {
    const scenario = await this.findOne(id, companyId);
    if (scenario.mediaKey) await this.channelMedia.removeObject(scenario.mediaKey);
    await this.prisma.botScenario.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async findOne(id: string, companyId: string): Promise<BotScenario> {
    const scenario = await this.prisma.botScenario.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!scenario) throw new NotFoundException('Сценарий не найден');
    return scenario;
  }

  async uploadMedia(id: string, companyId: string, mediaType: string, file: Express.Multer.File): Promise<BotScenario> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_SCENARIO_MEDIA_SIZE) throw new BadRequestException('Максимальный размер файла — 20MB');

    const scenario = await this.findOne(id, companyId);
    // Кружок рендерится кругом только если видео уже квадратное (1:1) — тот же баг и фикс,
    // что для медиа пушей (см. PushesService.uploadMedia, репорт пользователя 2026-07-17).
    const buffer = mediaType === 'VIDEO_NOTE' ? await this.videoProcessing.ensureSquareVideoNote(file.buffer) : file.buffer;
    const key = `scenario-media/${scenario.channelId}/${scenario.id}/${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
    await this.channelMedia.uploadBuffer(key, buffer, file.mimetype || SCENARIO_MEDIA_CONTENT_TYPE[mediaType]);

    if (scenario.mediaKey) await this.channelMedia.removeObject(scenario.mediaKey);

    return this.prisma.botScenario.update({ where: { id }, data: { mediaKey: key, mediaType } });
  }

  async removeMedia(id: string, companyId: string): Promise<BotScenario> {
    const scenario = await this.findOne(id, companyId);
    if (scenario.mediaKey) await this.channelMedia.removeObject(scenario.mediaKey);
    return this.prisma.botScenario.update({ where: { id }, data: { mediaKey: null, mediaType: null } });
  }

  // Публичный — Telegram сам фетчит эту ссылку при отправке (тот же приём, что и
  // GET /channels/:id/welcome-media). Без companyId-скоупа: id сценария сам по себе
  // непубличный/неугадываемый (cuid), а содержимое — ровно то, что уже уходит подписчикам.
  async streamMedia(id: string, res: Response): Promise<void> {
    const scenario = await this.prisma.botScenario.findFirst({ where: { id, deletedAt: null } });
    if (!scenario?.mediaKey || !scenario.mediaType) {
      res.status(404).end();
      return;
    }

    try {
      const [stream, stat] = await Promise.all([
        this.channelMedia.getObjectStream(scenario.mediaKey),
        this.channelMedia.getStat(scenario.mediaKey),
      ]);
      res.setHeader('Content-Type', SCENARIO_MEDIA_CONTENT_TYPE[scenario.mediaType] || 'application/octet-stream');
      // Content-Length — тот же фикс, что для pushes-media (WEBPAGE_CURL_FAILED, 2026-07-17).
      if (stat?.size) res.setHeader('Content-Length', String(stat.size));
      // no-transform — не даёт Cloudflare срезать Content-Length при проксировании публичного
      // домена (см. push-media.controller.ts, тот же баг класс, 2026-07-17).
      res.setHeader('Cache-Control', 'public, max-age=86400, no-transform');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
      });
      stream.pipe(res);
    } catch (error) {
      this.logger.warn(`streamMedia failed for scenario ${id}: ${(error as Error).message}`);
      res.status(404).end();
    }
  }
}
