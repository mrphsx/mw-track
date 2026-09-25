import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ChannelsModule } from '../channels/channels.module';
import { LandingsController } from './landings.controller';
import { ProjectLandingsController } from './project-landings.controller';
import { AbTestGroupsController } from './ab-test-groups.controller';
import { InternalController } from './internal.controller';
import { LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { NginxService } from './nginx.service';
import { StorageService } from './storage.service';
import { CloakingService } from './cloaking/cloaking.service';
import { RedirectCloakingHandler } from './cloaking/redirect-cloaking.handler';
import { PrelandingCloakingHandler } from './cloaking/prelanding-cloaking.handler';
import { NotFoundCloakingHandler } from './cloaking/not-found-cloaking.handler';
import { BlankCloakingHandler } from './cloaking/blank-cloaking.handler';
import { CustomHtmlCloakingHandler } from './cloaking/custom-html-cloaking.handler';
import { CustomTextCloakingHandler } from './cloaking/custom-text-cloaking.handler';
import { CountryConditionEvaluator, RegionConditionEvaluator, CityConditionEvaluator } from './cloaking/conditions/geo.evaluators';
import { IpConditionEvaluator, BotConditionEvaluator } from './cloaking/conditions/network.evaluators';
import {
  ReferrerConditionEvaluator,
  UserAgentConditionEvaluator,
  XRequestedWithConditionEvaluator,
  LanguageConditionEvaluator,
} from './cloaking/conditions/http-header.evaluators';
import {
  BrowserConditionEvaluator,
  BrowserVersionConditionEvaluator,
  OsConditionEvaluator,
  OsVersionConditionEvaluator,
  DeviceTypeConditionEvaluator,
  DeviceModelConditionEvaluator,
} from './cloaking/conditions/user-agent-parsed.evaluators';
import { ParameterConditionEvaluator } from './cloaking/conditions/parameter.evaluator';
import { DateBetweenConditionEvaluator, TimetableConditionEvaluator } from './cloaking/conditions/time.evaluators';
import { LimitClicksConditionEvaluator, UniquenessConditionEvaluator } from './cloaking/conditions/stateful.evaluators';

// ChannelsModule — LandingsService.publish() создаёт персональную invite-ссылку лендинга
// через TelegramProvider (см. Client.landingId, пер-лендинговая атрибуция подписчиков).
// Не циклическая зависимость: ChannelsModule (через ClientsModule/TrackingModule) тянет
// ProjectsModule, но не LandingsModule — цикл не замыкается.
@Module({
  imports: [ProjectsModule, ChannelsModule],
  controllers: [LandingsController, ProjectLandingsController, AbTestGroupsController, InternalController],
  providers: [
    LandingsService,
    LandingRendererService,
    NginxService,
    StorageService,
    CloakingService,
    RedirectCloakingHandler,
    PrelandingCloakingHandler,
    NotFoundCloakingHandler,
    BlankCloakingHandler,
    CustomHtmlCloakingHandler,
    CustomTextCloakingHandler,
    CountryConditionEvaluator,
    RegionConditionEvaluator,
    CityConditionEvaluator,
    IpConditionEvaluator,
    BotConditionEvaluator,
    ReferrerConditionEvaluator,
    UserAgentConditionEvaluator,
    XRequestedWithConditionEvaluator,
    LanguageConditionEvaluator,
    BrowserConditionEvaluator,
    BrowserVersionConditionEvaluator,
    OsConditionEvaluator,
    OsVersionConditionEvaluator,
    DeviceTypeConditionEvaluator,
    DeviceModelConditionEvaluator,
    ParameterConditionEvaluator,
    DateBetweenConditionEvaluator,
    TimetableConditionEvaluator,
    LimitClicksConditionEvaluator,
    UniquenessConditionEvaluator,
  ],
  // LandingRendererService — экспортирован для AdminModule (превью лендинга в дрилл-дауне
  // компании, см. AdminCompanyService.getLandingPreview), не только внутримодульное использование.
  exports: [LandingsService, NginxService, LandingRendererService],
})
export class LandingsModule {}
