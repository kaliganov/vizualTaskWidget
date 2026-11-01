import { randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { GraphEdge } from '../graph/graph-edge.entity';
import { GraphNode } from '../graph/graph-node.entity';
import { asDate, formatTrackedEstimate, plannedDates, utcToday } from '../graph/schedule';
import { Board } from '../kanban/board.entity';
import { User } from '../users/user.entity';
import { DealType } from './deal-type.entity';
import { CreateGoalDto, UpdateGoalDto } from './goals.dto';
import { Goal } from './goal.entity';
import { OrderDocument } from './order-document.entity';
import { ProcessStep, ProcessTemplate } from './process-template.entity';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(DealType) private readonly dealTypes: Repository<DealType>,
    @InjectRepository(OrderDocument) private readonly documents: Repository<OrderDocument>,
    @InjectRepository(ProcessTemplate) private readonly templates: Repository<ProcessTemplate>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    user: AuthUser,
    q?: string,
    number?: string,
    status?: string,
    position?: string,
  ) {
    const qb = this.goals
      .createQueryBuilder('g')
      .where('g.companyId = :companyId', { companyId: user.companyId })
      .andWhere('g.archivedAt IS NULL')
      .orderBy('g.updatedAt', 'DESC');
    if (q) qb.andWhere('g.title ILIKE :q', { q: `%${q}%` });
    if (number) {
      qb.andWhere('g.applicationNumber ILIKE :number', { number: `%${number}%` });
    }
    if (status) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM graph_nodes n WHERE n."goalId" = g.id AND n.type = 'task' AND n.status = :status)`,
        { status },
      );
    }
    if (position) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM graph_nodes n
          JOIN users u ON u.id = n."assigneeId"
          WHERE n."goalId" = g.id AND u.position = :position AND u."companyId" = :companyId
        )`,
        { position },
      );
    }
    const templateRows = await this.templates.find({ where: { companyId: user.companyId } });
    const hidden = templateRows.map((item) => item.goalId).filter((id): id is string => Boolean(id));
    if (hidden.length) qb.andWhere('g.id NOT IN (:...templateGoals)', { templateGoals: hidden });
    const rows = await qb.getMany();
    const titles = await this.dealTitles(user.companyId);
    const ids = rows.map((goal) => goal.id);
    const taskNodes = ids.length
      ? await this.nodes.find({ where: { goalId: In(ids), type: 'task' } })
      : [];
    const byGoal = new Map<string, GraphNode[]>();
    for (const node of taskNodes) {
      const list = byGoal.get(node.goalId) ?? [];
      list.push(node);
      byGoal.set(node.goalId, list);
    }
    return rows.map((goal) =>
      this.present(goal, titles, this.currentTitle(byGoal.get(goal.id) ?? [])),
    );
  }

  async get(user: AuthUser, id: string) {
    const titles = await this.dealTitles(user.companyId);
    const goal = await this.find(user, id);
    const nodes = await this.nodes.find({ where: { goalId: goal.id, type: 'task' } });
    return this.present(goal, titles, this.currentTitle(nodes));
  }

  async create(user: AuthUser, dto: CreateGoalDto) {
    const number = dto.applicationNumber?.trim() || null;
    if (number) await this.assertNumberFree(user.companyId, number);
    if (dto.dealTypeId) await this.assertDealType(user.companyId, dto.dealTypeId);
    const scaleStart = dto.scaleStart ?? dto.deadline ?? utcToday();
    const withChain = Boolean(number);
    const latest = withChain ? await this.latestTemplate(user.companyId) : null;
    const chainSteps = withChain && !latest?.goalId ? await this.templateChain(user.companyId) : null;
    const anchorX = withChain ? 192 * (chainSteps?.length || 5) : 720;
    const dates = plannedDates(scaleStart, anchorX, 0, 'day');
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
          applicationNumber: dto.applicationNumber?.trim() || null,
          dealTypeId: dto.dealTypeId || null,
          customerName: dto.customerName?.trim() ?? '',
          contractName: dto.contractName?.trim() ?? '',
          objectName: dto.objectName?.trim() ?? '',
          objectAddress: dto.objectAddress?.trim() ?? '',
          orderNotes: dto.orderNotes?.trim() ?? '',
        }),
      );
      await em.save(
        GraphNode,
        em.create(GraphNode, {
          goalId: created.id,
          type: 'goal_anchor',
          title: 'Цель',
          description: '',
          x: anchorX,
          y: withChain ? 120 : 200,
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
      if (withChain && number) {
        const copied = latest?.goalId
          ? await this.copyTemplateGraph(em, created, scaleStart, latest.goalId)
          : 'none';
        if (copied === 'none') {
          await this.seedOrderPath(em, created, scaleStart, user.companyId, chainSteps);
        }
        await em.save(
          OrderDocument,
          em.create(OrderDocument, {
            companyId: user.companyId,
            goalId: created.id,
            title: `Заявка ${number}`,
            body: [
              created.customerName && `Заказчик: ${created.customerName}`,
              created.contractName && `Контракт: ${created.contractName}`,
              created.objectName && `Объект: ${created.objectName}`,
              created.objectAddress && `Адрес: ${created.objectAddress}`,
              created.orderNotes && `Примечания: ${created.orderNotes}`,
            ]
              .filter(Boolean)
              .join('\n'),
          }),
        );
      }
      return created;
    });
    const titles = await this.dealTitles(user.companyId);
    return this.present(goal, titles);
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
    if (dto.applicationNumber !== undefined) {
      const number = dto.applicationNumber.trim() || null;
      if (number && number !== goal.applicationNumber) {
        await this.assertNumberFree(user.companyId, number);
      }
      goal.applicationNumber = number;
    }
    if (dto.dealTypeId !== undefined) {
      if (dto.dealTypeId) await this.assertDealType(user.companyId, dto.dealTypeId);
      goal.dealTypeId = dto.dealTypeId || null;
    }
    if (dto.customerName !== undefined) goal.customerName = dto.customerName;
    if (dto.contractName !== undefined) goal.contractName = dto.contractName;
    if (dto.objectName !== undefined) goal.objectName = dto.objectName;
    if (dto.objectAddress !== undefined) goal.objectAddress = dto.objectAddress;
    if (dto.orderNotes !== undefined) goal.orderNotes = dto.orderNotes;
    await this.goals.save(goal);
    if (asDate(goal.scaleStart) !== previousScale) {
      await this.recalculateDates(goal);
    }
    const titles = await this.dealTitles(user.companyId);
    return this.present(goal, titles);
  }

  async remove(user: AuthUser, id: string) {
    const goal = await this.find(user, id);
    goal.status = 'archived';
    if (!goal.archivedAt) goal.archivedAt = new Date();
    await this.goals.save(goal);
    const titles = await this.dealTitles(user.companyId);
    return this.present(goal, titles);
  }

  async listDocuments(user: AuthUser, goalId: string) {
    await this.find(user, goalId);
    return this.documents.find({
      where: { goalId, companyId: user.companyId },
      order: { createdAt: 'ASC' },
    });
  }

  async addDocument(user: AuthUser, goalId: string, title: string, body: string) {
    await this.find(user, goalId);
    const name = title.trim();
    if (!name) throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Укажите название документа');
    return this.documents.save(
      this.documents.create({
        companyId: user.companyId,
        goalId,
        title: name,
        body: body?.trim() ?? '',
      }),
    );
  }

  async removeDocument(user: AuthUser, goalId: string, documentId: string) {
    await this.find(user, goalId);
    const row = await this.documents.findOne({
      where: { id: documentId, goalId, companyId: user.companyId },
    });
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'ERROR', 'Документ не найден');
    await this.documents.remove(row);
    return { id: documentId };
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
  private currentTitle(nodes: GraphNode[]) {
    const tasks = [...nodes].filter((node) => node.type === 'task').sort((a, b) => a.x - b.x);
    const current =
      tasks.find((node) => node.status === 'in_progress') ??
      tasks.find((node) => node.status !== 'done');
    if (current) return current.title;
    return tasks.length ? 'Процесс завершён' : 'Нет задач';
  }

  private present(goal: Goal, titles = new Map<string, string>(), currentTaskTitle = '') {
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
      startedAt: goal.createdAt,
      currentTaskTitle,
      updatedAt: goal.updatedAt,
      archivedAt: goal.archivedAt,
      applicationNumber: goal.applicationNumber,
      dealTypeId: goal.dealTypeId,
      dealTypeTitle: goal.dealTypeId ? titles.get(goal.dealTypeId) ?? '' : '',
      customerName: goal.customerName ?? '',
      contractName: goal.contractName ?? '',
      objectName: goal.objectName ?? '',
      objectAddress: goal.objectAddress ?? '',
      orderNotes: goal.orderNotes ?? '',
    };
  }

  private async dealTitles(companyId: string) {
    const rows = await this.dealTypes.find({ where: { companyId } });
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  private async assertNumberFree(companyId: string, number: string) {
    const dup = await this.goals.findOne({ where: { companyId, applicationNumber: number } });
    if (dup && !dup.archivedAt) {
      throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Заявка с таким номером уже есть');
    }
  }

  private async assertDealType(companyId: string, id: string) {
    const row = await this.dealTypes.findOne({ where: { id, companyId } });
    if (!row) throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Вид сделки не найден');
  }

  async createProcessTemplate(user: AuthUser, title: string) {
    const name = title.trim();
    if (!name) throw apiError(HttpStatus.BAD_REQUEST, 'ERROR', 'Укажите название шаблона');
    const scaleStart = utcToday();
    const anchorX = 720;
    const dates = plannedDates(scaleStart, anchorX, 0, 'day');
    return this.dataSource.transaction(async (em) => {
      const created = await em.save(
        Goal,
        em.create(Goal, {
          companyId: user.companyId,
          title: name,
          description: '',
          deadline: null,
          scaleStart,
          createdBy: user.id,
          applicationNumber: null,
          dealTypeId: null,
          customerName: '',
          contractName: '',
          objectName: '',
          objectAddress: '',
          orderNotes: '',
        }),
      );
      await em.save(
        GraphNode,
        em.create(GraphNode, {
          goalId: created.id,
          type: 'goal_anchor',
          title: 'Цель',
          description: '',
          x: anchorX,
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
      const template = await em.save(
        ProcessTemplate,
        em.create(ProcessTemplate, {
          companyId: user.companyId,
          title: name,
          steps: [],
          goalId: created.id,
          createdBy: user.id,
        }),
      );
      return { id: template.id, title: name, goalId: created.id, steps: [] };
    });
  }

  private latestTemplate(companyId: string) {
    return this.templates.findOne({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
  }

  private async copyTemplateGraph(
    em: EntityManager,
    goal: Goal,
    scaleStart: string,
    templateGoalId: string,
  ): Promise<'copied' | 'empty'> {
    const sourceNodes = await em.find(GraphNode, {
      where: { goalId: templateGoalId },
      order: { x: 'ASC' },
    });
    const tasks = sourceNodes.filter((node) => node.type === 'task');
    if (!tasks.length) return 'empty';
    const templateAnchor = sourceNodes.find((node) => node.type === 'goal_anchor');
    const freshAnchor = await em.findOne(GraphNode, { where: { goalId: goal.id, type: 'goal_anchor' } });
    const idMap = new Map<string, string>();
    if (templateAnchor && freshAnchor) idMap.set(templateAnchor.id, freshAnchor.id);
    let maxX = 0;
    for (const node of tasks) {
      const id = randomUUID();
      idMap.set(node.id, id);
      maxX = Math.max(maxX, Number(node.x));
      const dates = plannedDates(scaleStart, Number(node.x), Number(node.estimateValue), node.estimateUnit);
      await em.save(
        GraphNode,
        em.create(GraphNode, {
          id,
          goalId: goal.id,
          type: 'task',
          title: node.title,
          description: node.description,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          plannedStart: dates.plannedStart,
          plannedEnd: dates.plannedEnd,
          status: 'not_started',
          progress: null,
          progressCached: 0,
          assigneeId: node.assigneeId,
          takenAt: null,
          estimateValue: node.estimateValue,
          estimateUnit: node.estimateUnit,
        }),
      );
      await em.save(Board, em.create(Board, { nodeId: id }));
    }
    if (freshAnchor) {
      freshAnchor.x = maxX + 192;
      freshAnchor.y = 120;
      await em.save(freshAnchor);
    }
    const edges = await em.find(GraphEdge, { where: { goalId: templateGoalId } });
    for (const edge of edges) {
      const sourceNodeId = idMap.get(edge.sourceNodeId);
      const targetNodeId = idMap.get(edge.targetNodeId);
      if (!sourceNodeId || !targetNodeId) continue;
      await em.save(
        GraphEdge,
        em.create(GraphEdge, {
          goalId: goal.id,
          sourceNodeId,
          targetNodeId,
          durationValue: edge.durationValue,
          durationUnit: edge.durationUnit,
          label: edge.label,
        }),
      );
    }
    return 'copied';
  }

  private async templateChain(companyId: string) {
    const template = await this.templates.findOne({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
    const steps = (template?.steps ?? []).filter((step) => step.title?.trim());
    if (!steps.length) return null;
    return steps.map((step: ProcessStep) => ({
      title: step.title.trim(),
      hours: 8,
      role: step.description?.trim() || '',
      email: '',
    }));
  }

  private async seedOrderPath(
    em: EntityManager,
    goal: Goal,
    scaleStart: string,
    companyId: string,
    preset: { title: string; hours: number; role: string; email: string }[] | null,
  ) {
    const people = await em.find(User, { where: { companyId } });
    const byEmail = new Map(people.map((person) => [person.email, person]));
    const steps = preset?.length
      ? preset
      : [
      { title: 'Принять заявку', hours: 4, role: 'приём', email: 'worker1@demo.local' },
      { title: 'Собрать документацию', hours: 8, role: 'документы', email: 'worker2@demo.local' },
      { title: 'Проверить объект', hours: 16, role: 'объект', email: 'worker1@demo.local' },
      { title: 'Выпустить комплект', hours: 24, role: 'комплект', email: 'worker2@demo.local' },
      { title: 'Сдать заказчику', hours: 4, role: 'сдача', email: 'worker1@demo.local' },
    ];
    const nodes: GraphNode[] = [];
    for (const [index, step] of steps.entries()) {
      const dates = plannedDates(scaleStart, index * 192, step.hours, 'hour');
      nodes.push(
        await em.save(
          GraphNode,
          em.create(GraphNode, {
            goalId: goal.id,
            type: 'task',
            title: step.title,
            description: step.role,
            x: index * 192,
            y: 120,
            plannedStart: dates.plannedStart,
            plannedEnd: dates.plannedEnd,
            status: 'not_started',
            progress: null,
            progressCached: 0,
            assigneeId: byEmail.get(step.email)?.id ?? null,
            estimateValue: step.hours,
            estimateUnit: 'hour',
          }),
        ),
      );
      await em.save(Board, em.create(Board, { nodeId: nodes[nodes.length - 1].id }));
    }
    const anchor = await em.find(GraphNode, { where: { goalId: goal.id, type: 'goal_anchor' } });
    const chain = [...nodes, ...anchor];
    for (let i = 0; i < chain.length - 1; i++) {
      const source = chain[i];
      await em.save(
        GraphEdge,
        em.create(GraphEdge, {
          goalId: goal.id,
          sourceNodeId: source.id,
          targetNodeId: chain[i + 1].id,
          durationValue: source.estimateValue,
          durationUnit: source.estimateUnit,
          label: formatTrackedEstimate(source.estimateValue, source.estimateUnit),
        }),
      );
    }
  }
}
