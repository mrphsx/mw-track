import { IsNumber, IsPositive } from 'class-validator';

// Без верхней границы/подтверждения — явный выбор пользователя (Фаза 4.3C, 2026-07-19: "без
// ограничений, как попросили"). IsPositive — единственная реальная защита: отрицательное или
// нулевое "пополнение" не имеет смысла и не должно тихо пройти как валидная операция.
export class TopUpBalanceDto {
  @IsNumber()
  @IsPositive()
  amount: number;
}
