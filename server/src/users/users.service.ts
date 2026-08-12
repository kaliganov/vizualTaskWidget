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

  findById(id: string) {
    return this.users.findOne({ where: { id } });
  }

  listByCompany(companyId: string) {
    return this.users.find({
      where: { companyId },
      select: { id: true, email: true, name: true, companyId: true },
      order: { name: 'ASC' },
    });
  }

  async create(data: {
    email: string;
    password: string;
    name: string;
    companyId: string;
  }) {
    const user = this.users.create({
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(data.password, 10),
      name: data.name,
      companyId: data.companyId,
    });
    return this.users.save(user);
  }

  count() {
    return this.users.count();
  }
}
