import { IsIn } from 'class-validator';
import { PURCHASABLE_PLANS, PurchasablePlan } from '../plans';

export class SelectPlanDto {
  @IsIn(PURCHASABLE_PLANS)
  plan: PurchasablePlan;
}
