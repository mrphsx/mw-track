import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

// channel не редактируется через PATCH /projects/:id — тип канала неизменяем, а его
// конфигурация правится отдельно через PATCH /channels/:id (см. ChannelsController).
export class UpdateProjectDto extends PartialType(OmitType(CreateProjectDto, ['channel'] as const)) {}
