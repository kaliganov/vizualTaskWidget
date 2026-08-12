import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        return res.status(status).json({
          message: obj.message ?? exception.message,
          alertCode: obj.alertCode ?? 'ERROR',
          statusCode: status,
        });
      }
      return res.status(status).json({
        message: body,
        alertCode: 'ERROR',
        statusCode: status,
      });
    }
    console.error(exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Внутренняя ошибка сервера',
      alertCode: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  }
}
