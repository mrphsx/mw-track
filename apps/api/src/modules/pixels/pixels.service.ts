import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Permission, TrackingEvent, TrackingPixel, UserRole } from '@prisma/client';
import { Request } from 'express';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { UpdatePixelDto } from './dto/update-pixel.dto';
import { TestPixelEventDto, TestExistingPixelEventDto, TestableActionSource } from './dto/test-pixel-event.dto';
import { ProjectsService } from '../projects/projects.service';
import { FacebookCAPIService } from '../tracking/facebook-capi.service';
import { TikTokEventsService } from '../tracking/tiktok-events.service';
import { PixelSendResult } from '../tracking/providers/pixel.provider.interface';
import { buildPixelCurlCommand } from '../tracking/curl-command.util';

@Injectable()
export class PixelsService {
  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    private facebookCAPI: FacebookCAPIService,
    private tiktokEvents: TikTokEventsService,
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
    await this.getProjectsService().assertAccess(dto.projectId, companyId, userId, role, [Permission.PIXELS_CREATE]);

    return this.prisma.trackingPixel.create({ data: { ...dto } });
  }

  async findOne(id: string, companyId: string, userId: string, role: UserRole, requiredPermissions: Permission[] = [Permission.PIXELS_VIEW]): Promise<TrackingPixel> {
    const pixel = await this.prisma.trackingPixel.findFirst({
      where: { id, project: { companyId } },
    });
    if (!pixel) throw new NotFoundException('Пиксель не найден');
    await this.getProjectsService().assertAccess(pixel.projectId, companyId, userId, role, requiredPermissions);
    return pixel;
  }

  async update(id: string, companyId: string, dto: UpdatePixelDto, userId: string, role: UserRole): Promise<TrackingPixel> {
    await this.findOne(id, companyId, userId, role, [Permission.PIXELS_EDIT]);
    return this.prisma.trackingPixel.update({ where: { id }, data: dto });
  }

  // Без hard delete (см. инвариант "no hard deletes" в CLAUDE.md) и без отдельной
  // deletedAt-колонки — как и у Channel, деактивация эквивалентна удалению:
  // TrackingProcessor отбирает только isActive:true пиксели.
  async deactivate(id: string, companyId: string, userId: string, role: UserRole): Promise<TrackingPixel> {
    await this.findOne(id, companyId, userId, role, [Permission.PIXELS_DELETE]);
    return this.prisma.trackingPixel.update({ where: { id }, data: { isActive: false } });
  }

  // Синтетическое событие для проверки — общая часть между sendTestEvent (форма создания, пиксель
  // ещё не сохранён) и sendTestEventForExisting (форма редактирования, запрос пользователя
  // 2026-07-29: "сделай чтобы во время редактирования тоже можно было отправлять тестовые
  // запросы"). Ничего не пишет в TrackingEvent/Client — только в памяти, ровно те поля, которые
  // реально читает sendEvent(). actionSource (запрос пользователя 2026-07-30: "выборка для type,
  // website, chat") — payload.forceActionSource передаётся FacebookCAPIService напрямую (см. тот
  // файл): с 2026-07-30 боевые события всегда шлются с action_source:'website' по решению
  // пользователя, тестовая кнопка — единственное место, где ещё можно явно проверить 'chat'.
  private buildTestEvent(projectId: string, eventName: string, req: Request, actionSource: TestableActionSource = 'chat'): TrackingEvent {
    const ipAddress = this.getClientIp(req);
    const userAgent = req.headers['user-agent'];

    const payload: Record<string, unknown> = { ipAddress, userAgent, forceActionSource: actionSource };
    if (eventName === 'Purchase') {
      payload.value = 1;
      payload.currency = 'USD';
      payload.orderId = 'test-order';
    }

    return {
      id: 'test',
      eventName,
      eventId: `test_${eventName}_${Date.now()}_${nanoid(8)}`,
      eventTime: new Date(),
      clientId: `test-${projectId}`,
      payload,
    } as unknown as TrackingEvent;
  }

  // Проверка ивента при создании (запрос пользователя 2026-07-29: "при создании pixel для
  // проверки ивента пусть будет выборка event") — по данным из формы (pixelId/accessToken/
  // testEventCode), ДО того как пиксель вообще сохранён в БД. curlCommand (уточнение того же
  // дня: "показывай не только тело запроса а весь запрос с курл... чтобы сразу в cmd отправить")
  // — не гейтится отдельной ролью сверх уже требуемого PIXELS_CREATE: тот, кто вправе создать
  // пиксель, и так только что своими руками ввёл этот access_token в форму.
  async sendTestEvent(
    companyId: string,
    dto: TestPixelEventDto,
    userId: string,
    role: UserRole,
    req: Request,
  ): Promise<PixelSendResult & { curlCommand?: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, companyId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    await this.getProjectsService().assertAccess(dto.projectId, companyId, userId, role, [Permission.PIXELS_CREATE]);

    const event = this.buildTestEvent(dto.projectId, dto.eventName, req, dto.actionSource);
    const pixel = {
      id: 'test',
      projectId: dto.projectId,
      platform: dto.platform,
      pixelId: dto.pixelId,
      accessToken: dto.accessToken,
      testEventCode: dto.testEventCode ?? null,
    } as unknown as TrackingPixel;

    const provider = dto.platform === 'FACEBOOK' ? this.facebookCAPI : this.tiktokEvents;
    const result = await provider.sendEvent(event, pixel);
    const curlCommand = result.requestPayload
      ? buildPixelCurlCommand(dto.platform, dto.pixelId, dto.accessToken, result.requestPayload, result.testEventCode)
      : undefined;
    return { ...result, curlCommand };
  }

  // Проверка ивента при редактировании уже существующего пикселя (запрос пользователя
  // 2026-07-29) — читает accessToken/pixelId из уже сохранённой записи (клиенту токен обратно
  // никогда не отдаётся), но позволяет проверить ЕЩЁ НЕ сохранённые правки формы: accessToken —
  // пусто значит "как в БД сейчас" (тот же принцип, что и у update() — пустое поле формы не
  // значит "очистить токен", это бессмысленно для пикселя); testEventCode — если поле вообще
  // передано (даже пустой строкой), значит "тестируй ровно с тем, что сейчас в форме", а не с
  // сохранённым значением — соответствует ожиданию "проверь то, что я сейчас редактирую".
  async sendTestEventForExisting(
    id: string,
    companyId: string,
    dto: TestExistingPixelEventDto,
    userId: string,
    role: UserRole,
    req: Request,
  ): Promise<PixelSendResult & { curlCommand?: string }> {
    const pixel = await this.findOne(id, companyId, userId, role, [Permission.PIXELS_EDIT]);

    const event = this.buildTestEvent(pixel.projectId, dto.eventName, req, dto.actionSource);
    const usedAccessToken = dto.accessToken || pixel.accessToken;
    const testPixel: TrackingPixel = {
      ...pixel,
      accessToken: usedAccessToken,
      testEventCode: dto.testEventCode !== undefined ? dto.testEventCode || null : pixel.testEventCode,
    };

    const provider = pixel.platform === 'FACEBOOK' ? this.facebookCAPI : this.tiktokEvents;
    const result = await provider.sendEvent(event, testPixel);
    const curlCommand = result.requestPayload
      ? buildPixelCurlCommand(pixel.platform, pixel.pixelId, usedAccessToken, result.requestPayload, result.testEventCode)
      : undefined;
    return { ...result, curlCommand };
  }

  // Та же логика, что в TrackingController/LandingRendererService (запрос реального IP клиента
  // за прокси Cloudflare/nginx) — не вынесено в общий модуль ради одного метода, тот же принцип,
  // что и у остальных дублей getClientIp в проекте.
  private getClientIp(req: Request): string {
    return (
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
