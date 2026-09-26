import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodValidationException } from 'nestjs-zod';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** Normalises every error into { error: { code, message, details?, requestId } } and never leaks internals. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = req.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL_ERROR', message: 'Something went wrong' };

    if (exception instanceof ZodValidationException) {
      status = HttpStatus.BAD_REQUEST;
      const zodError = exception.getZodError() as ZodError;
      body = {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are missing or invalid',
        details: zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response && 'error' in response && typeof response.error === 'object') {
        body = response.error as typeof body;
      } else {
        body = { code: HttpStatus[status] ?? 'ERROR', message: exception.message };
      }
    } else {
      this.logger.error({ requestId, err: exception }, 'Unhandled error');
    }
    res.status(status).json({ error: { ...body, requestId } });
  }
}
