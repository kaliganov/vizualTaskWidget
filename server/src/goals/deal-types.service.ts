import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { DealType } from './deal-type.entity';

export const DEFAULT_DEAL_TYPES = [
  'Договор ПТО с авансом',
  'Договор ПТО с ценой за месяц',
  'Договор ПТО без аванса 4%',
  'Договор ПТО без аванса 2%',
];

@Injectable()
export class DealTypesService {
  constructor(
    @InjectRepository(DealType) private readonly types: Repository<DealType>,
  ) {}

  list(companyId: string) {
    return this.types.find({ where: { companyId }, order: { sort: 'ASC', title: 'ASC' } });
  }

  async ensureDefaults(companyId: string) {
    if ((await this.types.count({ where: { companyId } })) > 0) return;
    await this.types.save(
      DEFAULT_DEAL_TYPES.map((title, sort) =>
        this.types.create({ companyId, title, sort }),
      ),
    );
  }

  async create(user: AuthUser, title: string) {
    const name = title.trim();
    if (!name) {
      throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Укажите вид сделки');
    }
    const sort = await this.types.count({ where: { companyId: user.companyId } });
    return this.types.save(this.types.create({ companyId: user.companyId, title: name, sort }));
  }
}
