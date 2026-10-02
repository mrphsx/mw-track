import { Module } from '@nestjs/common';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';

// Зависит только от PrismaService (глобальный PrismaModule) — поэтому модуль можно безопасно
// импортировать и в AdminModule (сторона отправки), никакого цикла это не создаёт.
@Module({
  controllers: [NoticesController],
  providers: [NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
