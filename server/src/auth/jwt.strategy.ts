import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { apiError } from '../common/api-error';
import { HttpStatus } from '@nestjs/common';

type JwtPayload = { sub: string; email: string; companyId: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Нет доступа');
    }
    return {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      name: user.name,
    };
  }
}
