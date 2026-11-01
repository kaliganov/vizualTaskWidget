import { randomBytes } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { apiError } from '../common/api-error';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.users.findOne({ where: { email: email.toLowerCase() } });
  }

  /** Пользователь из проверенного JWT. Пароль не задаётся известным значением. */
  async ensureFromToken(data: { id: string; email: string; name: string; companyId: string }) {
    const existing = await this.users.findOne({ where: { id: data.id } });
    if (existing) {
      if (existing.companyId !== data.companyId || existing.email !== data.email) {
        throw apiError(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHORIZED',
          'Токен не совпал с известным пользователем',
        );
      }
      return existing;
    }
    const byEmail = await this.findByEmail(data.email);
    if (byEmail) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Токен не совпал с известным пользователем',
      );
    }
    const user = this.users.create({
      id: data.id,
      email: data.email,
      passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
      name: data.name,
      companyId: data.companyId,
      position: '',
    });
    try {
      return await this.users.save(user);
    } catch {
      const again = await this.users.findOne({ where: { id: data.id } });
      if (again && again.companyId === data.companyId && again.email === data.email) return again;
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Токен не совпал с известным пользователем',
      );
    }
  }

  listByCompany(companyId: string) {
    return this.users.find({
      where: { companyId },
      select: { id: true, email: true, name: true, companyId: true, position: true },
      order: { name: 'ASC' },
    });
  }

  async create(data: {
    email: string;
    password: string;
    name: string;
    companyId: string;
    position?: string;
  }) {
    const user = this.users.create({
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(data.password, 10),
      name: data.name,
      companyId: data.companyId,
      position: data.position ?? '',
    });
    return this.users.save(user);
  }

  count() {
    return this.users.count();
  }

  async ensurePositions() {
    const positions: Record<string, string> = {
      'founder@demo.local': 'Руководитель',
      'worker1@demo.local': 'Инженер ПТО',
      'worker2@demo.local': 'Сметчик',
    };
    for (const [email, position] of Object.entries(positions)) {
      const user = await this.findByEmail(email);
      if (user && !user.position) {
        user.position = position;
        await this.users.save(user);
      }
    }
  }
}
