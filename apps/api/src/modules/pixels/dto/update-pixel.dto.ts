import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePixelDto } from './create-pixel.dto';

// projectId/platform не меняются после создания пикселя — для смены платформы создаётся новый
export class UpdatePixelDto extends PartialType(OmitType(CreatePixelDto, ['projectId', 'platform'] as const)) {}
