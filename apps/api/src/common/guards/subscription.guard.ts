import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SUBSCRIPTION_LIMIT_KEY } from '../decorators/subscription-limit.decorator';

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

    if (company.planExpiresAt && company.planExpiresAt < new Date()) {
      throw new ForbiddenException('Подписка истекла. Пожалуйста, продлите план.');
    }

    switch (limit) {
      case 'projects':
        if (company.currentProjects >= company.maxProjects) {
          throw new ForbiddenException(`Достигнут лимит проектов (${company.maxProjects}) для вашего плана`);
        }
        break;
      case 'clients':
        if (company.currentClients >= company.maxClients) {
          throw new ForbiddenException(`Достигнут лимит клиентов (${company.maxClients})`);
        }
        break;
      case 'pushes':
        if (company.pushesThisMonth >= company.maxPushesPerMonth) {
          throw new ForbiddenException('Достигнут лимит рассылок в этом месяце');
        }
        break;
    }

    return true;
  }
}
