import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StoryMediaType, StoryPostStatus, UserRole } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelMediaService } from '../channels/channel-media.service';
import { TelegramPersonalService } from '../channels/providers/telegram-personal.service';
import { CreateStoryDto } from './dto/create-story.dto';

const ELEVATED_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];
const EDITABLE_STATUSES: StoryPostStatus[] = [StoryPostStatus.PENDING];
const MAX_STORY_MEDIA_SIZE = 50 * 1024 * 1024;

@Injectable()
export class StoriesService {
  constructor(
    private prisma: PrismaService,
    private media: ChannelMediaService,
    private personal: TelegramPersonalService,
  ) {}

  // Определяет, что показать на лендинге модуля (запрос пользователя 2026-07-21): есть ли
  // проекты с подключённым личным аккаунтом, есть ли Telegram-проекты БЕЗ подключения (тогда
  // кнопка "подключить" ведёт туда), или нет вообще ни одного подходящего проекта (тогда текст
  // "создайте проект с Telegram-каналом"). Та же форма запроса, что уже использует
  // ProjectsService.findAll/getAccessibleProjectIds — BUYER/OPERATOR видят только назначенные
  // проекты (ProjectAccess), OWNER/ADMIN/SUPER_ADMIN все проекты компании.
  async getCompanyOverview(companyId: string, userId: string, role: UserRole) {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        channel: { type: 'TELEGRAM' },
        ...(ELEVATED_ROLES.includes(role) ? {} : { projectAccess: { some: { userId } } }),
      },
      select: {
        id: true,
        name: true,
        channel: { select: { id: true, tgPersonalUsername: true, tgSessionEncrypted: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const connected = [];
    const eligibleUnconnected = [];
    for (const p of projects) {
      if (!p.channel) continue;
      const entry = { id: p.id, name: p.name, tgPersonalUsername: p.channel.tgPersonalUsername };
      if (p.channel.tgSessionEncrypted) connected.push(entry);
      else eligibleUnconnected.push(entry);
    }

    return {
      connectedProjects: connected,
      eligibleUnconnectedProjects: eligibleUnconnected,
      hasAnyTelegramProject: projects.length > 0,
    };
  }

  // Пагинация (запрос пользователя 2026-07-21: "список историй нужно отдельно показывать на
  // другой странице с пагинацией нормальной") — тот же паттерн page/limit/total/totalPages,
  // что уже использует ClientsService.findMany.
  async findMany(projectId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const [items, total] = await Promise.all([
      this.prisma.storyPost.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.storyPost.count({ where: { projectId } }),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / take) };
  }

  async findOneForMedia(id: string, projectId: string) {
    const story = await this.prisma.storyPost.findFirst({ where: { id, projectId } });
    if (!story) throw new NotFoundException('История не найдена');
    return story;
  }

  async create(
    projectId: string,
    companyId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    dto: CreateStoryDto,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_STORY_MEDIA_SIZE) throw new BadRequestException('Файл слишком большой (макс. 50MB)');

    const channel = await this.prisma.channel.findFirst({
      where: { projectId, project: { companyId, deletedAt: null } },
      select: { id: true, type: true, tgSessionEncrypted: true },
    });
    if (!channel || channel.type !== 'TELEGRAM') {
      throw new BadRequestException('У проекта нет Telegram-канала');
    }
    if (!channel.tgSessionEncrypted) {
      throw new BadRequestException('К этому проекту не подключён личный Telegram-аккаунт');
    }

    const isVideo = file.mimetype.startsWith('video/');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `story-media_${nanoid(16)}-${safeName}`;
    await this.media.uploadBuffer(key, file.buffer, file.mimetype);

    return this.prisma.storyPost.create({
      data: {
        companyId,
        projectId,
        channelId: channel.id,
        mediaKey: key,
        mediaType: isVideo ? StoryMediaType.VIDEO : StoryMediaType.PHOTO,
        caption: dto.caption,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        createdByUserId: userId,
      },
    });
  }

  async retry(id: string, projectId: string) {
    const claimed = await this.prisma.storyPost.updateMany({
      where: { id, projectId, status: StoryPostStatus.FAILED },
      data: { status: StoryPostStatus.PENDING, error: null },
    });
    if (claimed.count === 0) throw new ForbiddenException('Историю можно повторить только после ошибки');
  }

  async remove(id: string, projectId: string) {
    const story = await this.prisma.storyPost.findFirst({ where: { id, projectId } });
    if (!story) throw new NotFoundException('История не найдена');
    if (!EDITABLE_STATUSES.includes(story.status)) {
      throw new ForbiddenException('Эту историю уже нельзя отменить (публикуется или уже опубликована)');
    }
    await this.prisma.storyPost.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Общий путь для крона (см. StoriesCron) — атомарный claim (guard внутри WHERE, тот же
  // приём, что PushesService.send() использует против гонки крона/ручного действия), затем
  // публикация через личный аккаунт. Публичный, потому что вызывается и извне модуля (крон).
  async publish(storyPostId: string): Promise<void> {
    const claimed = await this.prisma.storyPost.updateMany({
      where: {
        id: storyPostId,
        status: StoryPostStatus.PENDING,
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      data: { status: StoryPostStatus.PUBLISHING },
    });
    if (claimed.count === 0) return; // уже забрано другим тиком/действием, либо ещё не время

    const story = await this.prisma.storyPost.findUniqueOrThrow({
      where: { id: storyPostId },
      include: { channel: true },
    });

    try {
      const [stream, contentType] = await Promise.all([
        this.media.getObjectStream(story.mediaKey),
        this.media.getContentType(story.mediaKey),
      ]);
      const buffer = await this.streamToBuffer(stream);

      const result = await this.personal.sendStory(story.channel, {
        buffer,
        mimeType: contentType || (story.mediaType === 'VIDEO' ? 'video/mp4' : 'image/jpeg'),
        isVideo: story.mediaType === 'VIDEO',
        caption: story.caption ?? undefined,
      });

      if (result.success) {
        await this.prisma.storyPost.update({
          where: { id: storyPostId },
          data: { status: StoryPostStatus.PUBLISHED, publishedAt: new Date() },
        });
      } else {
        await this.prisma.storyPost.update({
          where: { id: storyPostId },
          data: { status: StoryPostStatus.FAILED, error: result.error },
        });
      }
    } catch (error) {
      await this.prisma.storyPost.update({
        where: { id: storyPostId },
        data: { status: StoryPostStatus.FAILED, error: (error as Error).message },
      });
    }
  }

  private streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
