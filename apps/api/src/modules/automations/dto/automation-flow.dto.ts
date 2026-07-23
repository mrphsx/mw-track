import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Те же строки, что TrackingEvent.eventName — подмножество, подтверждённое пользователем для
// v1 (Subscribe/Purchase/Dialogue). Не весь KNOWN_EVENT_NAMES (PageView/Lead/Click слишком
// "шумные" для автозаписи в воронку — решение из плана, не техническое ограничение).
export const AUTOMATION_TRIGGER_EVENTS = ['Subscribe', 'Purchase', 'Dialogue'];

export class CreateAutomationFlowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(AUTOMATION_TRIGGER_EVENTS)
  triggerEvent: string;
}

export class UpdateAutomationFlowDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(AUTOMATION_TRIGGER_EVENTS)
  triggerEvent?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
