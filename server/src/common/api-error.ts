import { HttpException, HttpStatus } from '@nestjs/common';

export function apiError(
  status: HttpStatus,
  alertCode: string,
  message: string,
) {
  return new HttpException({ message, alertCode, statusCode: status }, status);
}
