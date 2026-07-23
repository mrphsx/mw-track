import { OmitType } from '@nestjs/swagger';
import { CreateChannelDto } from './create-channel.dto';

// Поля канала без projectId/name — под 1:1 (см. ProjectsService.create()) projectId
// подставляется сервером, а name канала совпадает с name проекта (то же самое поле
// формы, отдельно не запрашивается — см. план "Project ↔ Channel: переход на строгий 1:1").
export class ChannelFieldsDto extends OmitType(CreateChannelDto, ['projectId', 'name'] as const) {}
