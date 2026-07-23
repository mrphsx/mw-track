import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SUBSCRIPTION_LIMIT_KEY } from '../decorators/subscription-limit.decorator';
import { checkSubscriptionLimit } from './subscription.util';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.getAllAndOverride<string>(SUBSCRIPTION_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!limit) return true;

    const { user } = context.switchToHttp().getRequest();

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
    });

    const { blocked, reason } = checkSubscriptionLimit(company, limit);
    if (blocked) throw new ForbiddenException(reason);

    return true;
  }
}
