import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Раньше ротация refresh-токена удаляла старую строку сразу же (см. AuthService.refresh) —
// таблица RefreshToken сама себя чистила. После добавления льготного окна ротации
// (запрос пользователя 2026-09-01, "многие говорят что их делогинит часто") использованные
// токены задерживаются в БД на REFRESH_TOKEN_GRACE_MS вместо мгновенного удаления — без этого
// крона строки с supersededAt копились бы до истечения полного 30-дневного expiresAt вместо
// удаления сразу после того, как льготное окно закрылось.
const RETENTION_BUFFER_MS = 5 * 60 * 1000; // запас сверх самого окна — не гоняемся секунда в секунду

@Injectable()
export class AuthCron {
  private readonly logger = new Logger(AuthCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/10 * * * *')
  async purgeSupersededRefreshTokens() {
    const cutoff = new Date(Date.now() - RETENTION_BUFFER_MS);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { supersededAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`purgeSupersededRefreshTokens: удалено ${count} использованных refresh-токенов`);
    }
  }
}
