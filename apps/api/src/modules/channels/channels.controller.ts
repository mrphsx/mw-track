import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Response } from 'express';
import { Permission } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChannelsService } from './channels.service';
import { TelegramPersonalService } from './providers/telegram-personal.service';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { TestMessageDto } from './dto/test-message.dto';
import { ConnectPersonalCodeDto, ConnectPersonalPasswordDto, ConnectPersonalPhoneDto } from './dto/personal-connect.dto';

// Нет POST / (создание канала как отдельного действия) — под 1:1 канал создаётся только
// вместе с проектом, см. ProjectsController/ProjectsService.create().
@Controller('channels')
export class ChannelsController {
  constructor(
    private channelsService: ChannelsService,
    private telegramPersonalService: TelegramPersonalService,
    private moduleRef: ModuleRef,
  ) {}

  // ProjectsService резолвится лениво через ModuleRef, а не конструктором — ChannelsModule
  // не импортирует ProjectsModule напрямую (тот уже держит forwardRef на ChannelsModule,
  // делать эту связь двусторонней рискованно, см. живой инцидент с зависанием бута из-за
  // тесного 3-узлового цикла провайдеров в PurchasesService/ChannelsService).
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  private async assertAccess(channelId: string, companyId: string, user: AuthUser, requiredPermissions?: Permission[]): Promise<void> {
    const channel = await this.channelsService.findOne(channelId, companyId);
    await this.getProjectsService().assertAccess(channel.projectId, companyId, user.userId, user.role, requiredPermissions);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    const channel = await this.channelsService.findOne(id, companyId);
    return this.sanitizeChannel(channel);
  }

  // Убираем зашифрованную MTProto-сессию из ответа — в отличие от tgBotToken (который
  // пользователь сам вводит и легитимно может увидеть в своей же настройке), это чисто
  // внутренний блоб, показывать нечего, а лишний ciphertext на клиенте — лишняя поверхность.
  // tgSessionEncrypted !== null уже само по себе достаточно фронту, чтобы знать "подключено".
  private sanitizeChannel(channel: Record<string, unknown>) {
    const { tgSessionEncrypted, ...safe } = channel;
    return { ...safe, tgPersonalConnected: !!tgSessionEncrypted };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateChannelDto) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    const channel = await this.channelsService.update(id, companyId, dto);
    return this.sanitizeChannel(channel);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.channelsService.deactivate(id, companyId);
  }

  @Post(':id/test')
  async test(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: TestMessageDto) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.channelsService.testMessage(id, companyId, dto);
  }

  // Стримим байты фото сами (а не отдаём прямую ссылку Telegram) — она содержит секретный
  // bot token в пути (api.telegram.org/file/bot<token>/...), отдавать такую ссылку клиенту
  // означало бы передать токен в открытом виде.
  // Багфикс 2026-07-28 (аудит разрешений сотрудников): ни @RequirePermission, ни assertAccess
  // вообще — любой авторизованный сотрудник компании мог стянуть аватарку ЛЮБОГО канала
  // компании, зная его id. Низкая критичность (только байты картинки), но тот же паттерн дыры.
  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.channelsService.streamAvatar(id, companyId, res);
  }

  @Get(':id/health')
  async health(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_VIEW]);
    return this.channelsService.checkHealth(id, companyId);
  }

  // Повторная попытка initialize() без пересоздания канала — частый случай: бот добавлен
  // до того, как пользователь сделал его админом канала, чинить нужно только в Telegram,
  // не пересобирать форму с токеном заново.
  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    return this.channelsService.reactivate(id, companyId);
  }

  // Подключение личного Telegram-аккаунта через MTProto (PERSONAL_DM, запрос пользователя
  // 2026-07-04) — пошаговый мастер, состояние между шагами держит TelegramPersonalService
  // (см. комментарий там — живой сокет нельзя сериализовать между HTTP-запросами).
  @Post(':id/personal-connect/start')
  async personalConnectStart(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: ConnectPersonalPhoneDto) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    const channel = await this.channelsService.findOne(id, companyId);
    await this.telegramPersonalService.startConnect(channel, dto.phone);
    return { needsCode: true };
  }

  @Post(':id/personal-connect/code')
  async personalConnectCode(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: ConnectPersonalCodeDto) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    const channel = await this.channelsService.findOne(id, companyId);
    const { needsPassword } = await this.telegramPersonalService.submitCode(channel, dto.code);
    return { needsPassword, connected: !needsPassword };
  }

  @Post(':id/personal-connect/password')
  async personalConnectPassword(
    @Param('id') id: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConnectPersonalPasswordDto,
  ) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    const channel = await this.channelsService.findOne(id, companyId);
    await this.telegramPersonalService.submitPassword(channel, dto.password);
    return { connected: true };
  }

  @Delete(':id/personal-connect')
  async personalConnectDisconnect(@Param('id') id: string, @Company() companyId: string, @CurrentUser() user: AuthUser) {
    await this.assertAccess(id, companyId, user, [Permission.CHANNEL_MANAGE]);
    const channel = await this.channelsService.findOne(id, companyId);
    await this.telegramPersonalService.disconnect(channel);
    return { connected: false };
  }
}
