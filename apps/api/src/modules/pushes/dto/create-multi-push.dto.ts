import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { CreatePushDto } from './create-push.dto';

// Мульти-проектное создание рассылки (запрос пользователя 2026-08-04: "можно будет выбрать один
// или несколько проектов для рассылки") — расширяет CreatePushDto, у Push нет M2M-связи с
// проектами (одно обязательное Push.projectId), поэтому фан-аут на N обычных create() делает
// PushesService.createForProjects, а не сама модель. sendNow — единая точка входа что для одного,
// что для нескольких проектов сразу (см. новый унифицированный PushComposer на фронте, который
// всегда шлёт сюда, даже когда выбран один проект).
export class CreateMultiPushDto extends CreatePushDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  projectIds: string[];

  @IsOptional()
  @IsBoolean()
  sendNow?: boolean;
}
