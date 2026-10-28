import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { GraphNode } from '../graph/graph-node.entity';
import { asDate, plannedDates, utcToday } from '../graph/schedule';
import { CreateGoalDto, UpdateGoalDto } from './goals.dto';
import { Goal } from './goal.entity';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    private readonly dataSource: DataSource,
  ) {}

  async list(user: AuthUser, q?: string) {
    const qb = this.goals
      .createQueryBuilder('g')
      .where('g.companyId = :companyId', { companyId: user.companyId })
      .andWhere('g.archivedAt IS NULL')
      .orderBy('g.updatedAt', 'DESC');
    if (q) qb.andWhere('g.title ILIKE :q', { q: `%${q}%` });
    const rows = await qb.getMany();
    return rows.map((goal) => this.present(goal));
  }

  async get(user: AuthUser, id: string) {
    return this.present(await this.find(user, id));
  }

  async create(user: AuthUser, dto: CreateGoalDto) {
    const scaleStart = dto.scaleStart ?? dto.deadline ?? utcToday();
    const dates = plannedDates(scaleStart, 720, 0, 'day');
    const goal = await this.dataSource.transaction(async (em) => {
      const created = await em.save(
        Goal,
        em.create(Goal, {
          companyId: user.companyId,
          title: dto.title,
          description: dto.description ?? '',
          deadline: dto.deadline ?? null,
          scaleStart,
          createdBy: user.id,
        }),
      );
      await em.save(
        GraphNode,
        em.create(GraphNode, {
          goalId: created.id,
          type: 'goal_anchor',
          title: 'Цель',
          description: '',
          x: 720,
          y: 200,
          plannedStart: dates.plannedStart,
          plannedEnd: dates.plannedEnd,
          status: 'not_started',
          progress: null,
          progressCached: 0,
          assigneeId: null,
          estimateValue: 0,
          estimateUnit: 'day',
        }),
      );
      return created;
    });
    return this.present(goal);
  }

  async update(user: AuthUser, id: string, dto: UpdateGoalDto) {
    const goal = await this.find(user, id);
    const previousScale = asDate(goal.scaleStart);
    if (dto.title !== undefined) goal.title = dto.title;
    if (dto.description !== undefined) goal.description = dto.description;
    if (dto.deadline !== undefined) goal.deadline = dto.deadline;
    if (dto.scaleStart) goal.scaleStart = dto.scaleStart;
    if (dto.status) {
      goal.status = dto.status;
      if (dto.status === 'archived' && !goal.archivedAt) {
        goal.archivedAt = new Date();
      }
    }
    await this.goals.save(goal);
    if (asDate(goal.scaleStart) !== previousScale) {
      await this.recalculateDates(goal);
    }
    return this.present(goal);
  }

  async remove(user: AuthUser, id: string) {
    const goal = await this.find(user, id);
    goal.status = 'archived';
    if (!goal.archivedAt) goal.archivedAt = new Date();
    await this.goals.save(goal);
    return this.present(goal);
  }

  private async find(user: AuthUser, id: string) {
    const goal = await this.goals.findOne({
      where: { id, companyId: user.companyId },
    });
    if (!goal) {
      throw apiError(HttpStatus.NOT_FOUND, 'GOAL_NOT_FOUND', 'Цель не найдена');
    }
    return goal;
  }

  private async recalculateDates(goal: Goal) {
    const scaleStart = asDate(goal.scaleStart);
    if (!scaleStart) return;
    const nodes = await this.nodes.find({ where: { goalId: goal.id } });
    for (const node of nodes) {
      if (node.type === 'goal_anchor') {
        node.estimateValue = 0;
        node.estimateUnit = 'day';
      }
      const dates = plannedDates(
        scaleStart,
        Number(node.x),
        Number(node.estimateValue),
        node.estimateUnit,
      );
      node.plannedStart = dates.plannedStart;
      node.plannedEnd = dates.plannedEnd;
    }
    if (nodes.length) await this.nodes.save(nodes);
  }

  /** enforceDependencies и edgeDurationMeans в ответ не попадают. */
  private present(goal: Goal) {
    return {
      id: goal.id,
      companyId: goal.companyId,
      title: goal.title,
      description: goal.description,
      deadline: asDate(goal.deadline),
      scaleStart: asDate(goal.scaleStart),
      status: goal.status,
      graphVersion: goal.graphVersion,
      createdBy: goal.createdBy,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      archivedAt: goal.archivedAt,
    };
  }
}
