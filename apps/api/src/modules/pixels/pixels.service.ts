import { Injectable, NotFoundException } from '@nestjs/common';
import { TrackingPixel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';

@Injectable()
export class PixelsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreatePixelDto): Promise<TrackingPixel> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, companyId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Проект не найден');

    return this.prisma.trackingPixel.create({ data: { ...dto } });
  }

  async findOne(id: string, companyId: string): Promise<TrackingPixel> {
    const pixel = await this.prisma.trackingPixel.findFirst({
      where: { id, project: { companyId } },
    });
    if (!pixel) throw new NotFoundException('Пиксель не найден');
    return pixel;
  }

  async update(id: string, companyId: string, dto: UpdatePixelDto): Promise<TrackingPixel> {
    await this.findOne(id, companyId);
    return this.prisma.trackingPixel.update({ where: { id }, data: dto });
  }

  // Без hard delete (см. инвариант "no hard deletes" в CLAUDE.md) и без отдельной
  // deletedAt-колонки — как и у Channel, деактивация эквивалентна удалению:
  // TrackingProcessor отбирает только isActive:true пиксели.
  async deactivate(id: string, companyId: string): Promise<TrackingPixel> {
    await this.findOne(id, companyId);
    return this.prisma.trackingPixel.update({ where: { id }, data: { isActive: false } });
  }
}
