import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if ((await this.users.count()) > 0) return;
    const companyId = this.config.get('DEMO_COMPANY_ID', 'demo-company');
    const accounts = [
      { email: 'founder@demo.local', name: 'Основатель', password: 'demo123' },
      { email: 'worker1@demo.local', name: 'Иван Петров', password: 'demo123' },
      { email: 'worker2@demo.local', name: 'Мария Сидорова', password: 'demo123' },
    ];
    for (const a of accounts) {
      await this.users.create({ ...a, companyId });
    }
    console.log('Сиды: founder@demo.local / demo123');
  }
}
