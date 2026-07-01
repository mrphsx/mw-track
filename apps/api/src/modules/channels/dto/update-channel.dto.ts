import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateChannelDto } from './create-channel.dto';

// projectId/type не меняются после создания канала
export class UpdateChannelDto extends PartialType(OmitType(CreateChannelDto, ['projectId', 'type'] as const)) {}
