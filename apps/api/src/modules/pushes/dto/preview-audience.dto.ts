import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsObject, IsString, ValidateNested } from 'class-validator';
import { PushFilterDto } from '../../clients/dto/push-filter.dto';

// Тело POST /pushes/preview-audience — обязательно отдельный класс, а не инлайн-тип параметра:
// глобальный ValidationPipe (whitelist:true, forbidNonWhitelisted:true, main.ts) отсеивает поля
// без class-validator метаданных, у голого TS-интерфейса их нет — body пришёл бы пустым.
export class PreviewAudienceDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  projectIds: string[];

  @IsObject()
  @ValidateNested()
  @Type(() => PushFilterDto)
  filter: PushFilterDto;
}
