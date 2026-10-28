import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { Goal } from '../goals/goal.entity';
import { KanbanService } from '../kanban/kanban.service';
import { User } from '../users/user.entity';
import { hasCycle } from './dag';
import { GraphEdge } from './graph-edge.entity';
import {
  GraphNode,
  type DurationUnit,
  type NodeStatus,
} from './graph-node.entity';
import type { GraphEdgeDto, GraphNodeDto, PutGraphDto } from './graph.dto';
import { analyzeGraph, asDate, formatEstimate, plannedDates } from './schedule';

const UNITS = new Set(['hour', 'day', 'week']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CanonNode = {
  id: string;
  type: string;
  title: string;
  description: string;
  x: number;
  y: number;
  assigneeId: string | null;
  estimateValue: number;
  estimateUnit: string;
};

function round3(value: number) {
  return Math.round(Number(value) * 1000) / 1000;
}

function canon(nodes: CanonNode[], edges: GraphEdgeDto[]) {
  return JSON.stringify({
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

@Injectable()
export class GraphService {
  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly kanban: KanbanService,
  ) {}

  async get(user: AuthUser, goalId: string) {
    const goal = await this.findGoal(user, goalId);
    return this.present(goal);
  }

  /**
   * Сопоставление узлов по id. Тот же task обновляется без доски.
   * Оценка ребра всегда берётся у узла-источника. Даты — из scaleStart и x.
   * Статус и progress из тела не пишутся.
   */
  async put(user: AuthUser, goalId: string, dto: PutGraphDto) {
    await this.dataSource.transaction(async (em) => {
      const goal = await em.findOne(Goal, {
        where: { id: goalId, companyId: user.companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!goal) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'GOAL_NOT_FOUND',
          'Цель не найдена',
        );
      }
      if (dto.version !== goal.graphVersion) {
        throw apiError(
          HttpStatus.CONFLICT,
          'GRAPH_VERSION_CONFLICT',
          'Схема изменена другим пользователем. Обновите страницу.',
        );
      }

      const existing = await em.find(GraphNode, { where: { goalId } });
      const existingEdges = await em.find(GraphEdge, { where: { goalId } });
      const existingById = new Map(existing.map((node) => [node.id, node]));
      this.assertGraph(dto, existingById);
      await this.assertAssignees(user.companyId, dto.nodes, existingById);

      const nextNodes = dto.nodes.map((node) =>
        this.effectiveNode(node, existingById.get(node.id)),
      );
      const same =
        canon(nextNodes, dto.edges) ===
        canon(
          existing.map((node) => this.storedNode(node)),
          existingEdges.map((edge) => ({
            id: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          })),
        );
      if (same) return;

      const incomingIds = new Set(dto.nodes.map((node) => node.id));
      const removed = existing
        .filter((node) => node.type === 'task' && !incomingIds.has(node.id))
        .map((node) => node.id);

      await em.delete(GraphEdge, { goalId });
      await this.kanban.removeTasks(em, removed);

      const scaleStart = asDate(goal.scaleStart)!;
      for (const node of dto.nodes) {
        const prev = existingById.get(node.id);
        const effective = this.effectiveNode(node, prev);
        const dates = plannedDates(
          scaleStart,
          effective.x,
          effective.estimateValue,
          effective.estimateUnit,
        );
        if (prev) {
          prev.title = effective.title;
          prev.description = effective.description;
          prev.x = effective.x;
          prev.y = effective.y;
          prev.assigneeId = effective.assigneeId;
          prev.estimateValue = effective.estimateValue;
          prev.estimateUnit = effective.estimateUnit as DurationUnit;
          prev.plannedStart = dates.plannedStart;
          prev.plannedEnd = dates.plannedEnd;
          await em.save(prev);
          continue;
        }
        await em.save(
          GraphNode,
          em.create(GraphNode, {
            id: effective.id,
            goalId,
            type: 'task',
            title: effective.title,
            description: effective.description,
            x: effective.x,
            y: effective.y,
            plannedStart: dates.plannedStart,
            plannedEnd: dates.plannedEnd,
            status: 'not_started' as NodeStatus,
            progress: null,
            progressCached: 0,
            assigneeId: effective.assigneeId,
            estimateValue: effective.estimateValue,
            estimateUnit: effective.estimateUnit as DurationUnit,
          }),
        );
        await this.kanban.createBoard(em, effective.id);
      }

      const byId = new Map(nextNodes.map((node) => [node.id, node]));
      await em.save(
        GraphEdge,
        dto.edges.map((edge) => {
          const source = byId.get(edge.sourceNodeId)!;
          return em.create(GraphEdge, {
            id: edge.id,
            goalId,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            durationValue: source.estimateValue,
            durationUnit: source.estimateUnit as DurationUnit,
            label: formatEstimate(source.estimateValue, source.estimateUnit),
          });
        }),
      );

      goal.graphVersion += 1;
      await em.save(goal);
    });
    return this.get(user, goalId);
  }

  async setManualStatus(
    user: AuthUser,
    goalId: string,
    nodeId: string,
    status: NodeStatus,
  ) {
    const goal = await this.findGoal(user, goalId);
    const node = await this.nodes.findOne({
      where: { id: nodeId, goalId: goal.id },
    });
    if (!node) {
      throw apiError(HttpStatus.NOT_FOUND, 'NODE_NOT_FOUND', 'Узел не найден');
    }
    if (node.type !== 'task') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'NOT_A_TASK',
        'Якорю ручной статус не задаётся',
      );
    }
    if ((await this.kanban.countCards(node.id)) > 0) {
      throw apiError(
        HttpStatus.CONFLICT,
        'STATUS_DERIVED',
        'Статус считается по карточкам',
      );
    }
    node.status = status;
    node.progress = null;
    await this.nodes.save(node);
    return { status: node.status, progress: null };
  }

  private async present(goal: Goal) {
    const nodes = await this.nodes.find({ where: { goalId: goal.id } });
    const edges = await this.edges.find({ where: { goalId: goal.id } });
    const deadline = asDate(goal.deadline);
    const analysis = analyzeGraph(
      nodes.map((node) => ({
        id: node.id,
        type: node.type,
        estimateValue: Number(node.estimateValue),
        estimateUnit: node.estimateUnit,
        plannedStart: asDate(node.plannedStart),
      })),
      edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
      deadline,
    );
    return {
      version: goal.graphVersion,
      scaleStart: asDate(goal.scaleStart),
      deadline,
      deadlineExceeded: analysis.deadlineExceeded,
      criticalNodeIds: analysis.criticalNodeIds,
      criticalEdgeIds: analysis.criticalEdgeIds,
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        description: node.description ?? '',
        x: Number(node.x),
        y: Number(node.y),
        plannedStart: asDate(node.plannedStart),
        plannedEnd: asDate(node.plannedEnd),
        status: node.status,
        progress:
          node.progress === null || node.progress === undefined
            ? null
            : Number(node.progress),
        assigneeId: node.assigneeId,
        estimateValue: Number(node.estimateValue),
        estimateUnit: node.estimateUnit,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        durationValue: Number(edge.durationValue),
        durationUnit: edge.durationUnit,
        label: edge.label,
      })),
    };
  }

  private async findGoal(user: AuthUser, goalId: string) {
    const goal = await this.goals.findOne({
      where: { id: goalId, companyId: user.companyId },
    });
    if (!goal) {
      throw apiError(HttpStatus.NOT_FOUND, 'GOAL_NOT_FOUND', 'Цель не найдена');
    }
    return goal;
  }

  private assertGraph(dto: PutGraphDto, existingById: Map<string, GraphNode>) {
    if (new Set(dto.nodes.map((node) => node.id)).size !== dto.nodes.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ERROR',
        'Повторяется идентификатор узла',
      );
    }
    if (new Set(dto.edges.map((edge) => edge.id)).size !== dto.edges.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'EDGE_DUPLICATE',
        'Повторяется стрелка',
      );
    }

    for (const node of dto.nodes) {
      const prev = existingById.get(node.id);
      if (prev && prev.type !== node.type) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'NODE_TYPE_IMMUTABLE',
          'Тип узла менять нельзя',
        );
      }
    }

    const anchors = dto.nodes.filter((node) => node.type === 'goal_anchor');
    if (anchors.length > 1) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ANCHOR_COUNT',
        'Якорь должен быть один',
      );
    }
    const storedAnchor = [...existingById.values()].find(
      (node) => node.type === 'goal_anchor',
    );
    if (
      anchors.length !== 1 ||
      !storedAnchor ||
      anchors[0].id !== storedAnchor.id
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ANCHOR_REQUIRED',
        'В схеме должен остаться якорь цели',
      );
    }

    for (const node of dto.nodes) {
      const prev = existingById.get(node.id);
      if (!prev && node.type !== 'task') {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ERROR',
          'Новый узел может быть только задачей',
        );
      }
      if (node.type === 'goal_anchor') continue;
      const estimate = this.estimateOf(node, prev);
      if (
        !UNITS.has(estimate.unit) ||
        !Number.isFinite(estimate.value) ||
        estimate.value < 0
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'BAD_ESTIMATE',
          'Оценка должна быть неотрицательным числом в часах, днях или неделях',
        );
      }
    }

    const nodeIds = new Set(dto.nodes.map((node) => node.id));
    const pairs = new Set<string>();
    for (const edge of dto.edges) {
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'EDGE_NODE_MISSING',
          'Стрелка ссылается на неизвестный узел',
        );
      }
      if (edge.sourceNodeId === edge.targetNodeId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'EDGE_DUPLICATE',
          'Нельзя провести стрелку из узла в себя',
        );
      }
      const pair = `${edge.sourceNodeId}->${edge.targetNodeId}`;
      if (pairs.has(pair)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'EDGE_DUPLICATE',
          'Между этими узлами стрелка уже есть',
        );
      }
      pairs.add(pair);
    }
    if (hasCycle(dto.edges)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'GRAPH_CYCLE_DETECTED',
        'Нельзя создать цикл в зависимостях',
      );
    }
  }

  private async assertAssignees(
    companyId: string,
    nodes: GraphNodeDto[],
    existingById: Map<string, GraphNode>,
  ) {
    const ids = [
      ...new Set(
        nodes
          .map((node) => this.assigneeOf(node, existingById.get(node.id)))
          .filter((id): id is string => !!id),
      ),
    ];
    if (!ids.length) return;
    if (ids.some((id) => !UUID.test(id))) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ASSIGNEE_NOT_IN_COMPANY',
        'Ответственный не из компании',
      );
    }
    const found = await this.users.count({ where: { id: In(ids), companyId } });
    if (found !== ids.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ASSIGNEE_NOT_IN_COMPANY',
        'Ответственный не из компании',
      );
    }
  }

  private estimateOf(node: GraphNodeDto, existing?: GraphNode) {
    if (node.type === 'goal_anchor') return { value: 0, unit: 'day' };
    return {
      value: Number(node.estimateValue ?? existing?.estimateValue ?? 1),
      unit: node.estimateUnit ?? existing?.estimateUnit ?? 'day',
    };
  }

  private assigneeOf(node: GraphNodeDto, existing?: GraphNode) {
    if (node.assigneeId === undefined) return existing?.assigneeId ?? null;
    if (!node.assigneeId) return null;
    return node.assigneeId;
  }

  private effectiveNode(node: GraphNodeDto, existing?: GraphNode): CanonNode {
    const estimate = this.estimateOf(node, existing);
    return {
      id: node.id,
      type: node.type === 'goal_anchor' ? 'goal_anchor' : 'task',
      title: node.title,
      description: node.description ?? existing?.description ?? '',
      x: round3(node.x),
      y: round3(node.y),
      assigneeId: this.assigneeOf(node, existing),
      estimateValue: estimate.value,
      estimateUnit: estimate.unit,
    };
  }

  private storedNode(node: GraphNode): CanonNode {
    return {
      id: node.id,
      type: node.type,
      title: node.title,
      description: node.description ?? '',
      x: round3(node.x),
      y: round3(node.y),
      assigneeId: node.assigneeId ?? null,
      estimateValue:
        node.type === 'goal_anchor' ? 0 : Number(node.estimateValue),
      estimateUnit: node.type === 'goal_anchor' ? 'day' : node.estimateUnit,
    };
  }
}
