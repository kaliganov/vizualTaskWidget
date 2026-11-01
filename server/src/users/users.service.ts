import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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
