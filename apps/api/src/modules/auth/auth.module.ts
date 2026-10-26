import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCron } from './auth.cron';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshStrategy } from './strategies/refresh.strategy';
import { EncryptionService } from '../../common/encryption.service';
import { TelegramLoginController } from './telegram/telegram-login.controller';
import { TelegramLoginService } from './telegram/telegram-login.service';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, TelegramLoginController],
  providers: [AuthService, AuthCron, JwtStrategy, RefreshStrategy, TelegramLoginService, EncryptionService],
  exports: [AuthService],
})
export class AuthModule {}
