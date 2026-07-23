import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional, ValidateIf } from 'class-validator';
import { CreatePushDto } from './create-push.dto';

export class UpdatePushDto extends PartialType(CreatePushDto) {
  // Переопределяем поле базового класса — там строго `string | undefined` (создание пуша с
  // датой планирования либо задаёт её, либо нет). Здесь нужен ещё и `null` — запрос
  // пользователя 2026-07-18 "программировать рассылки на потом": раз календарь позволяет
  // ВЫБРАТЬ дату, должна быть возможность и СНЯТЬ расписание обратно в черновик, не только
  // отменить пуш насовсем через cancel(). ValidateIf пропускает IsDateString при null —
  // иначе class-validator отклонил бы null как невалидную дату.
  @IsOptional()
  @ValidateIf((o) => o.scheduledAt !== null)
  @IsDateString()
  declare scheduledAt?: string | null;
}
