import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

// Global — PermissionsService используется в auth (issueTokens), team (create/update/invite),
// и в сервисах статистики (STATS_VIEW_REVENUE/STATS_VIEW_TEAM_LEADERBOARDS фильтрация),
// т.е. в модулях, которые иначе пришлось бы перечислять по одному (в отличие от
// EncryptionService, используемого только в ChannelsModule) — тот же паттерн, что уже
// применён к PrismaModule.
@Global()
@Module({
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
