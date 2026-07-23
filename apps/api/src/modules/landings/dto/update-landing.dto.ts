import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateLandingFromTemplateDto } from './create-landing-from-template.dto';

// templateId не меняется после создания — пересоздание лендинга проще, чем миграция данных.
// autoRedirect/cloaking* наследуются от CreateLandingFromTemplateDto (через LandingBehaviorDto)
// автоматически становятся optional через PartialType — отдельно их здесь дублировать не нужно.
export class UpdateLandingDto extends PartialType(OmitType(CreateLandingFromTemplateDto, ['templateId'] as const)) {}
