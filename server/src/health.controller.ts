import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get(['health', 'health/ping'])
  ping() {
    return { status: 'ok' };
  }
}
