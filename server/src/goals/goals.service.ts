import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { Goal } from './goal.entity';
import { GraphNode } from '../graph/graph-node.entity';
import { CreateGoalDto, UpdateGoalDto } from './goals.dto';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  list(user: AuthUser, q?: string) {
    const qb = this.goals
      .createQueryBuilder('g')
      .where('g.companyId = :companyId', { companyId: user.companyId })
      .andWhere('g.archivedAt IS NULL')
      .orderBy('g.updatedAt', 'DESC');
    if (q) {
      qb.andWhere('g.title ILIKE :q', { q: `%${q}%` });
    }
    return qb.getMany();
  }

  async get(user: AuthUser, id: string) {
    const goal = await this.goals.findOne({
      where: { id, companyId: user.companyId },
    });
    if (!goal) {
      throw apiError(HttpStatus.NOT_FOUND, 'GOAL_NOT_FOUND', 'Цель не найдена');
    }
    return goal;
  }

  async create(user: AuthUser, dto: CreateGoalDto) {
    const goal = await this.goals.save(
      this.goals.create({
        companyId: user.companyId,
        title: dto.title,
        description: dto.description ?? '',
        deadline: dto.deadline ?? null,
        createdBy: user.id,
      }),
    );
    await this.nodes.save(
      this.nodes.create({
        goalId: goal.id,
        type: 'goal_anchor',
        title: 'Цель',
        x: 720,
        y: 200,
        estimateValue: 0,
        estimateUnit: 'day',
      }),
    );
    return goal;
  }

  async update(user: AuthUser, id: string, dto: UpdateGoalDto) {
    const goal = await this.get(user, id);
    Object.assign(goal, {
      title: dto.title ?? goal.title,
      description: dto.description ?? goal.description,
      deadline: dto.deadline === undefined ? goal.deadline : dto.deadline,
      status: dto.status ?? goal.status,
    });
    if (dto.status === 'archived') {
      goal.archivedAt = new Date();
    }
    return this.goals.save(goal);
  }

  async remove(user: AuthUser, id: string) {
    const goal = await this.get(user, id);
    goal.status = 'archived';
    goal.archivedAt = new Date();
    return this.goals.save(goal);
  }
}
