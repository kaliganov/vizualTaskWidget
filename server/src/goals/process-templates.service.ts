import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { ProcessStep, ProcessTemplate } from './process-template.entity';

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

  async create(user: AuthUser, title: string, steps: { title?: string; description?: string }[]) {
    const name = title.trim();
    if (!name) throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Укажите название шаблона');
    const clean: ProcessStep[] = [];
    for (const step of steps) {
      const stepTitle = step.title?.trim() ?? '';
      if (!stepTitle) continue;
      clean.push({ title: stepTitle, description: step.description?.trim() ?? '' });
    }
    if (!clean.length) throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Добавьте хотя бы один шаг');
    return this.templates.save(
      this.templates.create({
        companyId: user.companyId,
        title: name,
        steps: clean,
        createdBy: user.id,
      }),
    );
  }
}
