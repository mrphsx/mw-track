import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ChannelFieldsDto } from '../../channels/dto/channel-fields.dto';
import { TRACKING_EVENT_TYPES } from '../../tracking/tracking-event-types.const';

// IANA-зоны (запрос пользователя 2026-07-04, диалоги с клиентами) — проект может целиться в
// аудиторию на другом конце света, "сутки" во всех дневных графиках считаются по зоне
// проекта, а не по UTC. Intl.supportedValuesOf уже даёт полный актуальный список от Node
// (доступен в рантайме с Node 18+), не нужно тащить отдельный npm-пакет со списком зон —
// приведение типа ниже, потому что tsconfig target (ES2021) ещё не знает про этот метод ES2022.
const IANA_TIMEZONES = (Intl as unknown as { supportedValuesOf(input: string): string[] }).supportedValuesOf('timeZone');

export class CreateProjectDto {
  // Название проекта — fallback/рабочее название. Для Telegram (не PERSONAL_DM) после
  // успешной инициализации канала перезаписывается реальным tgChannelTitle/tgBotFirstName —
  // см. ProjectsService.create(). Для WhatsApp/Instagram профиль сейчас не фетчится вообще,
  // остаётся то, что ввёл пользователь.
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsIn(IANA_TIMEZONES)
  timezone?: string;

  // Типы событий, которые НЕ пересылать в Facebook/TikTok (запрос пользователя 2026-07-27,
  // свитчи включения/выключения по типу события) — см. tracking-event-types.const.ts и
  // TrackingService.recordEvent. Событие всё равно всегда пишется в TrackingEvent.
  @IsOptional()
  @IsArray()
  @IsIn(TRACKING_EVENT_TYPES, { each: true })
  disabledTrackingEvents?: string[];

  // Кастомные имена query-параметров трекинг-ссылки лендинга (запрос пользователя
  // 2026-07-04) — { pixel: "px", adId: "zid1", ... }, ключи и формат значений проверяются
  // в ProjectsService.validateLinkParamMap (см. link-params.const.ts на бэкенде), не здесь —
  // объектная форма достаточна на уровне DTO, как и у Push.buttons/tgWelcomeButtons.
  @IsOptional()
  @IsObject()
  linkParamMap?: Record<string, string>;

  // Проект сам "становится" каналом — тип и конфигурация запрашиваются один раз тут,
  // при создании, и не добавляются отдельным шагом позже (см. CLAUDE.md/15_PHASES.md,
  // "Project ↔ Channel: переход на строгий 1:1").
  @ValidateNested()
  @Type(() => ChannelFieldsDto)
  channel: ChannelFieldsDto;
}
