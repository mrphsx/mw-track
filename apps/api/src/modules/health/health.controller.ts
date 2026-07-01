import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    const [db, redis] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);

    const dbOk = db.status === 'fulfilled';
    const redisOk = redis.status === 'fulfilled';

    if (!dbOk || !redisOk) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        services: { database: dbOk ? 'ok' : 'error', redis: redisOk ? 'ok' : 'error' },
      });
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: { database: 'ok', redis: 'ok' },
    };
  }
}
