import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PixelPlatform } from '@prisma/client';

// Проверка ивента при создании/редактировании пикселя (запрос пользователя 2026-07-29: "пусть
// будет выборка event") — только события, для которых реально имеет смысл слать тест (не Click —
// он не уходит на рекламные платформы вообще, см. TRACKING_EVENT_TYPES/tracking-events.const.ts).
export const TESTABLE_EVENT_NAMES = ['PageView', 'Lead', 'Subscribe', 'Unsubscribe', 'Dialogue', 'Purchase', 'InitiateCheckout'] as const;

// action_source (запрос пользователя 2026-07-30: "сделай выборку в тесте для type, website,
// chat") — в боевой отправке (FacebookCAPIService) это больше НЕ выбор/вывод из payload.source:
// с того же дня все реальные события всегда шлются как action_source:'website' (осознанное
// решение пользователя после живого A/B-теста, показавшего byte-identical ответ Facebook для
// обоих значений). Эта выборка — единственное оставшееся место, где можно явно проверить 'chat'.
export const TESTABLE_ACTION_SOURCES = ['website', 'chat'] as const;
export type TestableActionSource = (typeof TESTABLE_ACTION_SOURCES)[number];

export class TestPixelEventDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsEnum(PixelPlatform)
  platform: PixelPlatform;

  @IsString()
  @IsNotEmpty()
  pixelId: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsOptional()
  @IsString()
  testEventCode?: string;

  @IsIn(TESTABLE_EVENT_NAMES)
  eventName: string;

  @IsOptional()
  @IsIn(TESTABLE_ACTION_SOURCES)
  actionSource?: TestableActionSource;
}

// Проверка ивента при РЕДАКТИРОВАНИИ уже существующего пикселя (запрос пользователя 2026-07-29:
// "сделай чтобы во время редактирования тоже можно было отправлять тестовые запросы") —
// pixelId/платформа/accessToken(по умолчанию) берутся из уже сохранённой записи, не из тела
// запроса. accessToken/testEventCode — опциональные оверрайды ещё не сохранённых правок формы.
export class TestExistingPixelEventDto {
  @IsIn(TESTABLE_EVENT_NAMES)
  eventName: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  testEventCode?: string;

  @IsOptional()
  @IsIn(TESTABLE_ACTION_SOURCES)
  actionSource?: TestableActionSource;
}
