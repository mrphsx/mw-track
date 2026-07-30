import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min, ValidateNested } from 'class-validator';

// "Элемент" — редизайн 2026-07-25 (запрос пользователя: один тип сообщения + кнопка на
// элемент, задержка внутри самого элемента вместо отдельного блока-шага "Задержка"). На уровне
// БД элемент по-прежнему один SEND_MESSAGE BotScenarioStep, опционально с одним DELAY-шагом
// прямо перед ним в цепочке (delaySeconds > 0) — см. BotScenariosService.groupSteps/addElement.
// Условие (CONDITION) как отдельно добавляемый элемент из UI убрано (запрос пользователя,
// "пока") — существующие CONDITION-шаги (если где-то есть) движок по-прежнему выполняет,
// просто новый редактор больше не даёт их создавать.

export class ScenarioElementButtonDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUrl({ require_protocol: true })
  url: string;
}

// Тот же формат, что CreatePushDto.PushMediaDto — video_note только в одиночку, до 10 элементов
// для фото/видео-альбома.
export class ScenarioElementMediaDto {
  @IsIn(['photo', 'video', 'video_note'])
  type: 'photo' | 'video' | 'video_note';

  @IsString()
  url: string;
}

const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;

export class CreateScenarioElementDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ScenarioElementMediaDto)
  messageMedia?: ScenarioElementMediaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ScenarioElementButtonDto)
  buttons?: ScenarioElementButtonDto[];
}

export class UpdateScenarioElementDto extends CreateScenarioElementDto {}

export class MoveScenarioElementDto {
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
