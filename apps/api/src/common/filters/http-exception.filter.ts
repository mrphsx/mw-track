import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { companyStorage } from '../context/company.context';

// Prisma-специфичные классы ошибок — если БД сама деградирует, запись в ErrorLog конкурировала
// бы за тот же пул соединений, что уже проблемный, усиливая деградацию вместо её фиксации
// (Super Admin панель, Фаза 4.3, найдено design-ревью 2026-07-19). Пропускаем полностью.
const PRISMA_ERROR_CLASSES = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientUnknownRequestError,
];

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private prisma: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal server error';
    let details: unknown;
    let code = 'INTERNAL_ERROR';

    if (typeof body === 'string') {
      message = body;
    } else if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (Array.isArray(b.message)) {
        message = 'Ошибка валидации';
        details = b.message;
      } else {
        message = (b.message as string) ?? message;
      }
      code = (b.error as string)?.toString().toUpperCase().replace(/\s+/g, '_') ?? code;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status === HttpStatus.BAD_REQUEST) code = 'VALIDATION_ERROR';
    if (status === HttpStatus.UNAUTHORIZED) code = 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) code = 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) code = 'NOT_FOUND';

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        details,
      },
    });

    this.logToErrorTable(exception, status, message, request);
  }

  // Super Admin панель (Фаза 4.3, запрос пользователя 2026-07-19) — "мониторинг ошибок".
  // Только реальные 500-е (осознанно исключены 400/401/403/404 — это штатные ответы, не баги,
  // иначе таблица захламляется рутинными отказами). Fire-and-forget: НЕ await, .catch глушит
  // саму запись — падение лога не должно повлиять на уже отправленный ответ клиенту.
  private logToErrorTable(exception: unknown, status: number, message: string, request: Request): void {
    if (status < 500) return;
    if (PRISMA_ERROR_CLASSES.some((cls) => exception instanceof cls)) return;

    const ctx = companyStorage.getStore();
    this.prisma.errorLog
      .create({
        data: {
          companyId: ctx?.companyId,
          userId: ctx?.userId,
          message,
          stack: exception instanceof Error ? exception.stack : undefined,
          route: `${request.method} ${request.originalUrl ?? request.url}`,
          method: request.method,
          statusCode: status,
        },
      })
      .catch(() => {});
  }
}
