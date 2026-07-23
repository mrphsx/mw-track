import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TrackingPixel, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class PixelsService {
  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
  ) {}

  // ProjectsService резолвится лениво через ModuleRef — тот же паттерн, что уже применён в
  // PurchasesService/DomainsService, избегаем риска циклического require между доменами, не
  // связанными сейчас module-графом напрямую.
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  // Раньше здесь проверялось только company-владение проектом (баг найден при
  // проектировании гранулярных прав, 2026-07-17) — Buyer с ProjectAccess только к проекту A
  // мог создать/поменять/удалить пиксель ЛЮБОГО проекта той же компании, просто зная его id.
  async create(companyId: string, dto: CreatePixelDto, userId: string, role: UserRole): Promise<TrackingPixel> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, companyId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    await this.getProjectsService().assertAccess(dto.projectId, companyId, userId, role);

    return this.prisma.trackingPixel.create({ data: { ...dto } });
  }

  async findOne(id: string, companyId: string, userId: string, role: UserRole): Promise<TrackingPixel> {
    const pixel = await this.prisma.trackingPixel.findFirst({
      where: { id, project: { companyId } },
    });
    if (!pixel) throw new NotFoundException('Пиксель не найден');
    await this.getProjectsService().assertAccess(pixel.projectId, companyId, userId, role);
    return pixel;
  }

  async update(id: string, companyId: string, dto: UpdatePixelDto, userId: string, role: UserRole): Promise<TrackingPixel> {
    await this.findOne(id, companyId, userId, role);
    return this.prisma.trackingPixel.update({ where: { id }, data: dto });
  }

  // Без hard delete (см. инвариант "no hard deletes" в CLAUDE.md) и без отдельной
  // deletedAt-колонки — как и у Channel, деактивация эквивалентна удалению:
  // TrackingProcessor отбирает только isActive:true пиксели.
  async deactivate(id: string, companyId: string, userId: string, role: UserRole): Promise<TrackingPixel> {
    await this.findOne(id, companyId, userId, role);
    return this.prisma.trackingPixel.update({ where: { id }, data: { isActive: false } });
  }
}
