import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { apiError } from './api-error';
import type { AuthUser } from './current-user.decorator';
import { UsersService } from '../users/users.service';

const ACTOR_EMAIL = 'founder@demo.local';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PortalToken = {
  sub?: string;
  email?: string;
  companyId?: string;
  name?: string;
};

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      headers?: { authorization?: string };
      user?: AuthUser;
    }>();
    const path = (req.path || req.url || '').split('?')[0];
    if (path === '/health' || path === '/health/ping') return true;

    if (this.demoAllowed()) return this.asFounder(req);

    const secret = this.config.get<string>('JWT_SECRET')?.trim() ?? '';
    if (!secret || secret === 'change-me-in-local-dev') {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_NOT_CONFIGURED',
        'Сервер не настроен для приёма токена портала',
      );
    }
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Нужен токен портала');
    }
    let payload: PortalToken;
    try {
      payload = await this.jwt.verifyAsync<PortalToken>(header.slice('Bearer '.length).trim(), {
        secret,
        algorithms: ['HS256'],
      });
    } catch {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Токен портала не принят');
    }
    const id = payload.sub ?? '';
    const email = (payload.email ?? '').trim().toLowerCase();
    const companyId = (payload.companyId ?? '').trim();
    const name = (payload.name ?? '').trim();
    if (
      !UUID.test(id) ||
      !email ||
      email.length > 200 ||
      !email.includes('@') ||
      !companyId ||
      companyId.length > 64 ||
      name.length > 200
    ) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'В токене нет нужных полей');
    }
    const user = await this.users.ensureFromToken({
      id,
      email,
      companyId,
      name: name || email,
    });
    req.user = {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      name: user.name,
    };
    return true;
  }

  /** Демо только вне production. На портале NODE_ENV=production, флаг не открывает доступ. */
  private demoAllowed() {
    if (this.config.get('NODE_ENV') === 'production') return false;
    return this.config.get('DEMO_ACTOR') !== 'false';
  }

  private async asFounder(req: { user?: AuthUser }) {
    const user = await this.users.findByEmail(ACTOR_EMAIL);
    if (!user) {
      throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'ACTOR_MISSING', 'Нет пользователя демо');
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
