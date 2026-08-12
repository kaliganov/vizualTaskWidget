import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { apiError } from '../common/api-error';
import { HttpStatus } from '@nestjs/common';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'WRONG_PASSWORD',
        'Неверный email или пароль',
      );
    }
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyId: user.companyId,
      },
    };
  }
}
