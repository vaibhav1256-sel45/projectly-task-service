import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

// gRPC status code -> HTTP status, so e.g. "project not found" from project-service is a 404, not a 500
const GRPC_TO_HTTP: Record<number, { status: number; code: string }> = {
  3: { status: 400, code: 'INVALID_ARGUMENT' },
  5: { status: 404, code: 'NOT_FOUND' },
  6: { status: 409, code: 'ALREADY_EXISTS' },
  7: { status: 403, code: 'FORBIDDEN' },
  16: { status: 401, code: 'UNAUTHENTICATED' },
};

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        this.logger.error(
          {
            error,
            stack: error.stack,
          },
          error.message,
        );

        const { status, code, message } = this.handleError(error);

        const shapedError = {
          success: false,
          error: {
            code,
            message,
          },
        };

        return throwError(
          () => new HttpException(shapedError, status),
        );
      }),
    );
  }

 private handleError(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    return {
      status: error.getStatus(),
      code:
        typeof response === 'object' &&
        response !== null &&
        'code' in response
          ? String(response.code)
          : 'HTTP_ERROR',
      message: error.message,
    };
  }

  if (
    error instanceof Error &&
    error.name === 'ValidationError'
  ) {
    const validationError = error as any;

    const message = Object.values(validationError.errors)
      .map((err: any) => err.message)
      .join(', ');

    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message,
    };
  }

  if (
    error instanceof Error &&
    error.name === 'CastError'
  ) {
    const castError = error as any;

    return {
      status: 400,
      code: 'INVALID_ID',
      message: `Invalid ${castError.path}: ${castError.value}`,
    };
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  ) {
    const mongoError = error as {
      code: number;
      keyPattern?: Record<string, unknown>;
      keyValue?: Record<string, unknown>;
    };

    const fields = Object.keys(
      mongoError.keyPattern ?? mongoError.keyValue ?? {},
    );

    return {
      status: 409,
      code: 'DUPLICATE_RESOURCE',
      message: fields.length
        ? `${fields.join(', ')} already exists`
        : 'Resource already exists',
    };
  }

  // An error another service answered with over gRPC (it carries a numeric gRPC status code)
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number' &&
    error.code in GRPC_TO_HTTP
  ) {
    const grpcError = error as { code: number; details?: string; message?: string };
    const { status, code } = GRPC_TO_HTTP[grpcError.code];
    return { status, code, message: grpcError.details || grpcError.message || 'Request failed' };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  };
}
}