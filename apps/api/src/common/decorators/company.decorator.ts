import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// @Company() — получить companyId текущего пользователя из request
export const Company = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user?.companyId;
});
