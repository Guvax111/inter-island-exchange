import { HttpException, HttpStatus } from '@nestjs/common';

/** Every API error has a stable machine-readable code and a human-readable message. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ error: { code, message, details } }, status);
  }
}

export const Errors = {
  unauthenticated: () => new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue'),
  forbidden: (message = 'You do not have permission to do this') => new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message),
  badRequest: (code: string, message: string, details?: unknown) => new AppError(HttpStatus.BAD_REQUEST, code, message, details),
};
