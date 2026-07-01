import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateLandingFromTemplateDto } from './create-landing-from-template.dto';

// templateId не меняется после создания — пересоздание лендинга проще, чем миграция данных
export class UpdateLandingDto extends PartialType(OmitType(CreateLandingFromTemplateDto, ['templateId'] as const)) {}
