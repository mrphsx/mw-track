import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TelegramLoginService } from './telegram-login.service';

class TelegramMiniAppLoginDto {
  @IsString() @MaxLength(64) botId!: string;
  @IsString() @MaxLength(8192) initData!: string;
}

class AddTelegramAccountDto {
  @IsString() @MaxLength(64) username!: string;
}

// Вход из мини-аппа Telegram и свои привязанные аккаунты (2026-10-26) — доступно всем ролям.
@Controller('auth/telegram')
export class TelegramLoginController {
  constructor(private service: TelegramLoginService) {}

  @Public()
  @Post('miniapp')
  login(@Body() dto: TelegramMiniAppLoginDto) {
    return this.service.login(dto.botId, dto.initData);
  }

  @Get('accounts')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post('accounts')
  add(@CurrentUser() user: AuthUser, @Body() dto: AddTelegramAccountDto) {
    return this.service.addByUsername(user, dto.username);
  }

  @Post('link')
  link(@CurrentUser() user: AuthUser) {
    return this.service.createLink(user);
  }

  @Delete('accounts/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
