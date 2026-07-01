import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CompanyContextInterceptor } from './common/interceptors/company-context.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DomainsModule } from './modules/domains/domains.module';
import { HealthModule } from './modules/health/health.module';
import { LandingsModule } from './modules/landings/landings.module';
import { PixelsModule } from './modules/pixels/pixels.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PushesModule } from './modules/pushes/pushes.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

// Модули остальных доменов (Billing и т.д.)
// подключаются по мере реализации соответствующих фаз — см. 15_PHASES.md.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL'),
      }),
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    ClientsModule,
    ChannelsModule,
    PixelsModule,
    TrackingModule,
    PushesModule,
    LandingsModule,
    DomainsModule,
    BillingModule,
    WebhooksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: CompanyContextInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
