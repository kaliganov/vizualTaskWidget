import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProcessTemplate } from './process-template.entity';

@Injectable()
export class ProcessTemplatesService {
  constructor(
    @InjectRepository(ProcessTemplate) private readonly templates: Repository<ProcessTemplate>,
  ) {}

  list(companyId: string) {
    return this.templates.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
  }
}
