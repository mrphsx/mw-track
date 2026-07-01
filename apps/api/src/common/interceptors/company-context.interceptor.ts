import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { companyStorage } from '../context/company.context';

/**
 * Устанавливает AsyncLocalStorage company-контекст для PrismaService middleware.
 *
 * В 03_BACKEND_CORE.md это описано как Express NestMiddleware, применённый через
 * `consumer.apply(CompanyContextMiddleware).forRoutes('*')`. Но в жизненном цикле
 * NestJS middleware выполняется ДО guards, а req.user заполняется JwtAuthGuard
 * (через Passport) — то есть на момент работы middleware req.user всегда undefined,
 * и companyStorage никогда бы не наполнялся. Поэтому контекст ставится здесь,
 * в глобальном interceptor'е, который выполняется уже после guards.
 */
@Injectable()
export class CompanyContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    if (request.user) {
      return new Observable((subscriber) => {
        companyStorage.run(
          {
            companyId: request.user.companyId,
            userId: request.user.userId,
            role: request.user.role,
          },
          () => {
            next.handle().subscribe({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            });
          },
        );
      });
    }

    return next.handle();
  }
}
