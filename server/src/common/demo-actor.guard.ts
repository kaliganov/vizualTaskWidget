import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { apiError } from './api-error';
import type { AuthUser } from './current-user.decorator';
import { UsersService } from '../users/users.service';

/** Пока портал не подставляет пользователя, все запросы идут от основателя демо. */
const ACTOR_EMAIL = 'founder@demo.local';

@Injectable()
export class DemoActorGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      user?: AuthUser;
    }>();
    const path = (req.path || req.url || '').split('?')[0];
    if (path === '/health' || path === '/health/ping') return true;

    const user = await this.users.findByEmail(ACTOR_EMAIL);
    if (!user) {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ACTOR_MISSING',
        'Нет пользователя демо',
      );
    }
    req.user = {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      name: user.name,
    };
    return true;
  }
}
