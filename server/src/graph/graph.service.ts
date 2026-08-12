import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { GraphNode } from './graph-node.entity';
import { GraphEdge } from './graph-edge.entity';
import { Goal } from '../goals/goal.entity';
import { GoalsService } from '../goals/goals.service';
import { PutGraphDto } from './graph.dto';
import type { AuthUser } from '../common/current-user.decorator';
import { apiError } from '../common/api-error';
import { criticalPathNodeIds, hasCycle } from './dag';

function durationLabel(value: number, unit: string) {
  const u = unit === 'hour' ? 'ч' : unit === 'week' ? 'нед' : 'д';
  return `${value}${u}`;
}

@Injectable()
export class GraphService {
  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly goalsService: GoalsService,
    private readonly dataSource: DataSource,
  ) {}

  async get(user: AuthUser, goalId: string) {
    const goal = await this.goalsService.get(user, goalId);
    const nodes = await this.nodes.find({ where: { goalId } });
    const edges = await this.edges.find({ where: { goalId } });
    return {
      version: goal.graphVersion,
      deadline: goal.deadline,
      nodes,
      edges,
      criticalPathNodeIds: criticalPathNodeIds(nodes, edges),
    };
  }

  async put(user: AuthUser, goalId: string, dto: PutGraphDto) {
    const goal = await this.goalsService.get(user, goalId);
    if (dto.version !== goal.graphVersion) {
      throw apiError(
        HttpStatus.CONFLICT,
        'GRAPH_VERSION_CONFLICT',
        'Схема изменена другим пользователем. Обновите страницу.',
      );
    }
    if (hasCycle(dto.edges)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'GRAPH_CYCLE_DETECTED',
        'Нельзя создать цикл в зависимостях',
      );
    }
    const nodeById = new Map(dto.nodes.map((n) => [n.id, n]));
    const edges = dto.edges.map((e) => {
      const src = nodeById.get(e.sourceNodeId);
      const durationValue = e.durationValue ?? src?.estimateValue ?? 1;
      const durationUnit = e.durationUnit ?? src?.estimateUnit ?? 'day';
      return {
        ...e,
        durationValue,
        durationUnit,
        label: e.label || durationLabel(durationValue, durationUnit),
      };
    });

    await this.dataSource.transaction(async (em) => {
      await em.delete(GraphEdge, { goalId });
      await em.delete(GraphNode, { goalId });
      await em.save(
        GraphNode,
        dto.nodes.map((n) =>
          em.create(GraphNode, {
            id: n.id,
            goalId,
            type: n.type === 'goal_anchor' ? 'goal_anchor' : 'task',
            title: n.title,
            description: n.description ?? '',
            x: n.x,
            y: n.y,
            plannedStart: n.plannedStart ?? null,
            plannedEnd: n.plannedEnd ?? null,
            status: (n.status as GraphNode['status']) ?? 'not_started',
            assigneeId: n.assigneeId ?? null,
            estimateValue: n.estimateValue ?? 1,
            estimateUnit: (n.estimateUnit as GraphNode['estimateUnit']) ?? 'day',
          }),
        ),
      );
      await em.save(
        GraphEdge,
        edges.map((e) =>
          em.create(GraphEdge, {
            id: e.id,
            goalId,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            durationValue: e.durationValue,
            durationUnit: e.durationUnit as GraphEdge['durationUnit'],
            label: e.label,
          }),
        ),
      );
      goal.graphVersion += 1;
      await em.save(Goal, goal);
    });

    return this.get(user, goalId);
  }
}
