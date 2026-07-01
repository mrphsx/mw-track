import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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
  }
}
