import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DealTypesService } from '../goals/deal-types.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    private readonly users: UsersService,
    private readonly dealTypes: DealTypesService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const companyId = this.config.get('DEMO_COMPANY_ID', 'demo-company');
    if ((await this.users.count()) === 0) {
      const accounts = [
        { email: 'founder@demo.local', name: 'Основатель', password: 'demo123', position: 'Руководитель' },
        { email: 'worker1@demo.local', name: 'Иван Петров', password: 'demo123', position: 'Инженер ПТО' },
        { email: 'worker2@demo.local', name: 'Мария Сидорова', password: 'demo123', position: 'Сметчик' },
      ];
      for (const a of accounts) {
        await this.users.create({ ...a, companyId });
      }
      console.log('Сиды: пользователи демо-компании созданы');
    }
    await this.users.ensurePositions();
    await this.dealTypes.ensureDefaults(companyId);
  }
}
