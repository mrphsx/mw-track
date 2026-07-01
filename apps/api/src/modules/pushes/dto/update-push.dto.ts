import { PartialType } from '@nestjs/swagger';
import { CreatePushDto } from './create-push.dto';

export class UpdatePushDto extends PartialType(CreatePushDto) {}
