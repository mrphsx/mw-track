import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// @CurrentUser() — получить request.user (userId, companyId, role из JWT payload)
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
