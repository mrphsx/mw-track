import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Landing, LandingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { CreateLandingFromTemplateDto } from './dto/create-landing-from-template.dto';
import { UploadCustomLandingDto } from './dto/upload-custom-landing.dto';
import { UpdateLandingDto } from './dto/update-landing.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  customizableFields: string[];
}

@Injectable()
export class LandingsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async getTemplates(): Promise<TemplateInfo[]> {
    return [
      {
        id: 'minimal',
        name: 'Minimal',
        description: 'Чистый минималистичный дизайн',
        previewUrl: `${process.env.CDN_URL}/templates/minimal/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'BG_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'gradient',
        name: 'Gradient',
        description: 'Яркий градиентный фон',
        previewUrl: `${process.env.CDN_URL}/templates/gradient/preview.jpg`,
        customizableFields: ['GRADIENT_FROM', 'GRADIENT_TO', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'dark',
        name: 'Dark',
        description: 'Тёмная премиум тема',
        previewUrl: `${process.env.CDN_URL}/templates/dark/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
    ];
  }

  // companyId приходит из контекста авторизации (контроллер передаёт его явно),
  // не из тела запроса — в доке dto.companyId был полем DTO, что позволяло бы
  // клиенту указать ЧУЖОЙ companyId и создать лендинг не в своей компании.
  async createFromTemplate(projectId: string, companyId: string, dto: CreateLandingFromTemplateDto): Promise<Landing> {
    return this.prisma.landing.create({
      data: {
        projectId,
        companyId,
        name: dto.name,
        type: 'TEMPLATE',
        templateId: dto.templateId,
        templateData: {
          PRIMARY_COLOR: dto.primaryColor || '#2AABEE',
          BG_COLOR: dto.bgColor || '#f0f4f8',
          GRADIENT_FROM: dto.gradientFrom || '#667eea',
          GRADIENT_TO: dto.gradientTo || '#764ba2',
          JOIN_BUTTON_TEXT: dto.buttonText || 'Вступить в канал',
          CHANNEL_TITLE: dto.channelTitle || '',
          CHANNEL_DESCRIPTION: dto.channelDescription || '',
          CHANNEL_AVATAR: dto.channelAvatar || '',
          SUBSCRIBERS_COUNT: dto.subscribersCount || '',
        },
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        status: LandingStatus.DRAFT,
      },
    });
  }

  async findAll(projectId: string, companyId: string): Promise<Landing[]> {
    return this.prisma.landing.findMany({
      where: { projectId, companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string): Promise<Landing> {
    const landing = await this.prisma.landing.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!landing) throw new NotFoundException('Лендинг не найден');
    return landing;
  }

  async update(id: string, companyId: string, dto: UpdateLandingDto): Promise<Landing> {
    const landing = await this.findOne(id, companyId);

    const existingData = (landing.templateData as Record<string, string>) || {};
    const templateDataPatch: Record<string, string> = {};
    if (dto.primaryColor !== undefined) templateDataPatch.PRIMARY_COLOR = dto.primaryColor;
    if (dto.bgColor !== undefined) templateDataPatch.BG_COLOR = dto.bgColor;
    if (dto.gradientFrom !== undefined) templateDataPatch.GRADIENT_FROM = dto.gradientFrom;
    if (dto.gradientTo !== undefined) templateDataPatch.GRADIENT_TO = dto.gradientTo;
    if (dto.buttonText !== undefined) templateDataPatch.JOIN_BUTTON_TEXT = dto.buttonText;
    if (dto.channelTitle !== undefined) templateDataPatch.CHANNEL_TITLE = dto.channelTitle;
    if (dto.channelDescription !== undefined) templateDataPatch.CHANNEL_DESCRIPTION = dto.channelDescription;
    if (dto.channelAvatar !== undefined) templateDataPatch.CHANNEL_AVATAR = dto.channelAvatar;
    if (dto.subscribersCount !== undefined) templateDataPatch.SUBSCRIBERS_COUNT = dto.subscribersCount;

    return this.prisma.landing.update({
      where: { id },
      data: {
        name: dto.name,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        templateData: { ...existingData, ...templateDataPatch } as Prisma.InputJsonValue,
      },
    });
  }

  // Создать новый CUSTOM-лендинг сразу из ZIP — отдельно от createFromTemplate,
  // чтобы в UI не нужен был промежуточный "создать пустой лендинг, потом загрузить в него ZIP".
  async createCustom(projectId: string, companyId: string, dto: UploadCustomLandingDto, file: Express.Multer.File): Promise<Landing> {
    const landing = await this.prisma.landing.create({
      data: { projectId, companyId, name: dto.name, type: 'CUSTOM', status: LandingStatus.DRAFT },
    });
    return this.processZipUpload(landing, file);
  }

  // Перезалить ZIP в существующий лендинг (первая загрузка переводит его в CUSTOM,
  // повторная — заменяет файлы, например при TEMPLATE → CUSTOM миграции или правке вёрстки).
  async uploadCustomLanding(id: string, companyId: string, file: Express.Multer.File): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    return this.processZipUpload(landing, file);
  }

  private async processZipUpload(landing: Landing, file: Express.Multer.File): Promise<Landing> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (!file.originalname.toLowerCase().endsWith('.zip') && file.mimetype !== 'application/zip') {
      throw new BadRequestException('Только ZIP-файлы');
    }
    if (file.size > MAX_ZIP_SIZE) {
      throw new BadRequestException('Максимальный размер ZIP — 50MB');
    }

    const extractPath = path.join('/tmp', `landing-${landing.id}-${Date.now()}`);

    let zip: AdmZip;
    try {
      zip = new AdmZip(file.buffer);
    } catch {
      throw new BadRequestException('Не удалось прочитать ZIP-архив');
    }

    // Защита от zip-slip помимо встроенной в adm-zip (>=0.5.2) — не доверяем единственному
    // слою защиты при работе с файлами, загруженными произвольным пользователем.
    for (const entry of zip.getEntries()) {
      if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
        throw new BadRequestException('Архив содержит недопустимые пути');
      }
    }

    const hasIndex = zip.getEntries().some((e) => e.entryName.toLowerCase() === 'index.html');
    if (!hasIndex) {
      throw new BadRequestException('ZIP должен содержать index.html в корне архива');
    }

    try {
      zip.extractAllTo(extractPath, true);

      const basePath = `landings/${landing.id}`;
      await this.storage.removePrefix(basePath);
      await this.storage.uploadDirectory(extractPath, basePath);

      return this.prisma.landing.update({
        where: { id: landing.id },
        data: { type: 'CUSTOM', customBasePath: basePath, templateId: null, templateData: Prisma.JsonNull },
      });
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  async publish(id: string, companyId: string): Promise<Landing> {
    await this.findOne(id, companyId);
    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.PUBLISHED } });
  }

  async unpublish(id: string, companyId: string): Promise<Landing> {
    await this.findOne(id, companyId);
    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.DRAFT } });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);
    await this.prisma.landing.update({ where: { id }, data: { deletedAt: new Date(), status: LandingStatus.ARCHIVED } });
  }
}
