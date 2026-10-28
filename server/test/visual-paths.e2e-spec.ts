/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';

type NodeBody = {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  assigneeId?: string | null;
  estimateValue?: number;
  estimateUnit?: string;
  status?: string;
};

describe('Visual Paths §15', () => {
  let app: INestApplication;
  let founder = '';
  let worker = '';
  const goalIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ping'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    founder = await login('founder@demo.local');
    worker = await login('worker1@demo.local');
  }, 120000);

  afterAll(async () => {
    for (const id of goalIds) {
      await request(app.getHttpServer())
        .delete(`/api/v1/visual-paths/goals/${id}`)
        .set('Authorization', `Bearer ${founder}`);
    }
    if (app) await app.close();
  });

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'demo123' });
    expect(res.status).toBeLessThan(300);
    return res.body.accessToken as string;
  }

  async function createGoal(
    token: string,
    body: { title: string; deadline?: string; scaleStart?: string } = {
      title: 'Проверка',
      deadline: '2026-11-01',
      scaleStart: '2026-08-01',
    },
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/visual-paths/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBeLessThan(300);
    goalIds.push(res.body.id);
    return res.body as {
      id: string;
      scaleStart: string;
      deadline: string | null;
    };
  }

  async function graph(token: string, goalId: string) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/visual-paths/goals/${goalId}/graph`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as {
      version: number;
      scaleStart: string;
      deadline: string | null;
      deadlineExceeded: boolean;
      criticalNodeIds: string[];
      criticalEdgeIds: string[];
      nodes: Array<{
        id: string;
        type: string;
        title: string;
        estimateValue: number;
        estimateUnit: string;
        plannedStart: string;
        plannedEnd: string;
        status: string;
        progress: number | null;
      }>;
      edges: Array<{
        id: string;
        sourceNodeId: string;
        targetNodeId: string;
        durationValue: number;
        label: string;
      }>;
    };
  }

  async function putGraph(
    token: string,
    goalId: string,
    version: number,
    nodes: NodeBody[],
    edges: {
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      durationValue?: number;
    }[],
  ) {
    return request(app.getHttpServer())
      .put(`/api/v1/visual-paths/goals/${goalId}/graph`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version, nodes, edges });
  }

  it('эталон §13: 12 дней, подписи источника, оба исхода дедлайна, карточка путь не меняет', async () => {
    const goal = await createGoal(founder);
    const initial = await graph(founder, goal.id);
    const anchor = initial.nodes.find((node) => node.type === 'goal_anchor')!;
    const id = {
      db: crypto.randomUUID(),
      api: crypto.randomUUID(),
      pay: crypto.randomUUID(),
      ui: crypto.randomUUID(),
      cat: crypto.randomUUID(),
      cart: crypto.randomUUID(),
      qa: crypto.randomUUID(),
      lone: crypto.randomUUID(),
    };
    const edge = {
      db: crypto.randomUUID(),
      api: crypto.randomUUID(),
      pay: crypto.randomUUID(),
      ui: crypto.randomUUID(),
      cat: crypto.randomUUID(),
      cart: crypto.randomUUID(),
      qa: crypto.randomUUID(),
    };
    const nodes = (startX: number): NodeBody[] => [
      { ...anchorNode(anchor.id), x: 720, y: 200 },
      task(id.db, 'Схема БД', 3, startX),
      task(id.api, 'API заказов', 5, 0),
      task(id.pay, 'Платежи', 4, 0),
      task(id.ui, 'Дизайн витрины', 2, 0),
      task(id.cat, 'Каталог', 4, 0),
      task(id.cart, 'Корзина', 3, 0),
      task(id.qa, 'Интеграционный прогон', 0, startX),
      task(id.lone, 'Закупка рекламы', 100, 0),
    ];
    const edges = [
      link(edge.db, id.db, id.api),
      link(edge.api, id.api, id.pay),
      link(edge.pay, id.pay, id.qa),
      link(edge.ui, id.ui, id.cat),
      link(edge.cat, id.cat, id.cart),
      link(edge.cart, id.cart, id.qa),
      link(edge.qa, id.qa, anchor.id),
    ];
    const saved = await putGraph(
      founder,
      goal.id,
      initial.version,
      nodes(0),
      edges,
    );
    expect(saved.status).toBeLessThan(300);
    const critical = [id.api, id.db, id.pay, id.qa].sort();
    expect(saved.body.criticalNodeIds).toEqual(critical);
    expect(saved.body.deadlineExceeded).toBe(false);
    expect(saved.body.criticalNodeIds).not.toContain(id.lone);
    expect(saved.body.criticalNodeIds).not.toContain(id.ui);
    expect(saved.body.criticalNodeIds).not.toContain(anchor.id);
    const pay = saved.body.nodes.find(
      (node: {
        id: string;
        estimateValue: number;
        plannedStart: string;
        plannedEnd: string;
      }) => node.id === id.pay,
    );
    expect(pay.estimateValue).toBe(4);
    expect(pay.plannedStart).toBe('2026-08-01');
    expect(pay.plannedEnd).toBe('2026-08-05');
    const labels = new Map(
      saved.body.edges.map((item: { sourceNodeId: string; label: string }) => [
        item.sourceNodeId,
        item.label,
      ]),
    );
    expect(labels.get(id.db)).toBe('3д');
    expect(labels.get(id.api)).toBe('5д');
    expect(labels.get(id.pay)).toBe('4д');
    expect(labels.get(id.ui)).toBe('2д');
    expect(labels.get(id.cat)).toBe('4д');
    expect(labels.get(id.cart)).toBe('3д');
    expect(labels.get(id.qa)).toBe('0д');
    expect(
      saved.body.edges.find((item: { id: string }) => item.id === edge.db)
        .durationValue,
    ).toBe(3);

    const dayIndex = Math.round(
      (Date.UTC(2026, 9, 25) - Date.UTC(2026, 7, 1)) / 86400000,
    );
    const shifted = await putGraph(
      founder,
      goal.id,
      saved.body.version,
      nodes(dayIndex * 48).map((node) =>
        node.id === id.db ||
        node.id === id.api ||
        node.id === id.pay ||
        node.id === id.qa
          ? { ...node, x: dayIndex * 48 }
          : { ...node, x: node.id === anchor.id ? 720 : 0 },
      ),
      edges,
    );
    expect(shifted.status).toBeLessThan(300);
    expect([...shifted.body.criticalNodeIds].sort()).toEqual(critical);
    expect(shifted.body.deadlineExceeded).toBe(true);
    const shiftedPay = shifted.body.nodes.find(
      (node: { id: string }) => node.id === id.pay,
    );
    expect(shiftedPay.plannedStart).toBe('2026-10-25');

    const before = await graph(founder, goal.id);
    const card = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/nodes/${id.db}/cards`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ title: 'Индекс' });
    expect(card.status).toBeLessThan(300);
    const moved = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/cards/${card.body.id}/move`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ columnKey: 'done', position: 0 });
    expect(moved.status).toBeLessThan(300);
    const after = await graph(founder, goal.id);
    expect(after.criticalNodeIds).toEqual(before.criticalNodeIds);
    const dates = (
      nodes: { id: string; plannedStart: string; plannedEnd: string }[],
    ) =>
      nodes
        .map((node) => [node.id, node.plannedStart, node.plannedEnd])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(dates(after.nodes)).toEqual(dates(before.nodes));
    const db = after.nodes.find((node) => node.id === id.db)!;
    expect(db.progress).toBe(100);
    expect(db.status).toBe('done');

    const overwritten = await putGraph(
      founder,
      goal.id,
      after.version,
      after.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.id === id.db ? 'Схема БД правка' : node.title,
        x:
          node.id === anchor.id
            ? 720
            : node.id === id.db || node.id === id.qa
              ? dayIndex * 48
              : 0,
        y: 160,
        estimateValue: node.estimateValue,
        estimateUnit: node.estimateUnit,
        status: 'not_started',
      })),
      after.edges.map((item) => ({
        id: item.id,
        sourceNodeId: item.sourceNodeId,
        targetNodeId: item.targetNodeId,
      })),
    );
    expect(overwritten.status).toBeLessThan(300);
    const kept = overwritten.body.nodes.find(
      (node: { id: string }) => node.id === id.db,
    );
    expect(kept.title).toBe('Схема БД правка');
    expect(kept.status).toBe('done');
    expect(kept.progress).toBe(100);

    const manual = await request(app.getHttpServer())
      .patch(
        `/api/v1/visual-paths/goals/${goal.id}/nodes/${id.db}/manual-status`,
      )
      .set('Authorization', `Bearer ${founder}`)
      .send({ status: 'in_progress' });
    expect(manual.status).toBe(409);
    expect(manual.body.alertCode).toBe('STATUS_DERIVED');
    const still = await graph(founder, goal.id);
    expect(still.nodes.find((node) => node.id === id.db)?.status).toBe('done');
  });

  it('PUT с тем же id сохраняет карточку, без id удаляет', async () => {
    const goal = await createGoal(founder, { title: 'Карточки' });
    const current = await graph(founder, goal.id);
    const anchor = current.nodes[0];
    const taskId = crypto.randomUUID();
    const first = await putGraph(
      founder,
      goal.id,
      current.version,
      [anchorNode(anchor.id), task(taskId, 'Фундамент', 10, 0)],
      [],
    );
    expect(first.status).toBeLessThan(300);
    const card = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/nodes/${taskId}/cards`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ title: 'Свая' });
    expect(card.status).toBeLessThan(300);
    const again = await putGraph(
      founder,
      goal.id,
      first.body.version,
      [anchorNode(anchor.id), task(taskId, 'Фундамент обновлён', 12, 48)],
      [],
    );
    expect(again.status).toBeLessThan(300);
    const board = await request(app.getHttpServer())
      .get(`/api/v1/visual-paths/nodes/${taskId}/board`)
      .set('Authorization', `Bearer ${founder}`);
    expect(board.status).toBe(200);
    expect(
      board.body.columns[0].cards.map((item: { title: string }) => item.title),
    ).toContain('Свая');

    const removed = await putGraph(
      founder,
      goal.id,
      again.body.version,
      [anchorNode(anchor.id)],
      [],
    );
    expect(removed.status).toBeLessThan(300);
    const gone = await request(app.getHttpServer())
      .get(`/api/v1/visual-paths/cards/${card.body.id}`)
      .set('Authorization', `Bearer ${founder}`);
    expect(gone.status).toBe(404);
    expect(gone.body.alertCode).toBe('CARD_NOT_FOUND');
    const noBoard = await request(app.getHttpServer())
      .get(`/api/v1/visual-paths/nodes/${taskId}/board`)
      .set('Authorization', `Bearer ${founder}`);
    expect(noBoard.status).toBe(404);
    expect(noBoard.body.alertCode).toBe('NODE_NOT_FOUND');
  });

  it('цикл и чужая версия не пишут схему', async () => {
    const goal = await createGoal(founder, { title: 'Цикл' });
    const current = await graph(founder, goal.id);
    const anchor = current.nodes[0];
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const cycled = await putGraph(
      founder,
      goal.id,
      current.version,
      [anchorNode(anchor.id), task(a, 'A', 1, 0), task(b, 'B', 1, 48)],
      [link(crypto.randomUUID(), a, b), link(crypto.randomUUID(), b, a)],
    );
    expect(cycled.status).toBe(400);
    expect(cycled.body.alertCode).toBe('GRAPH_CYCLE_DETECTED');
    const afterCycle = await graph(founder, goal.id);
    expect(afterCycle.version).toBe(current.version);
    expect(afterCycle.nodes).toHaveLength(1);

    const ok = await putGraph(
      founder,
      goal.id,
      current.version,
      [anchorNode(anchor.id), task(a, 'A', 1, 0)],
      [],
    );
    expect(ok.status).toBeLessThan(300);
    const stale = await putGraph(
      founder,
      goal.id,
      current.version,
      [anchorNode(anchor.id), task(a, 'Другое', 2, 0)],
      [],
    );
    expect(stale.status).toBe(409);
    expect(stale.body.alertCode).toBe('GRAPH_VERSION_CONFLICT');
    const afterStale = await graph(founder, goal.id);
    expect(afterStale.version).toBe(ok.body.version);
    expect(afterStale.nodes.find((node) => node.id === a)?.title).toBe('A');
  });

  it('второй пользователь компании сохраняет граф', async () => {
    const goal = await createGoal(founder, { title: 'Общая' });
    const current = await graph(worker, goal.id);
    const anchor = current.nodes[0];
    const taskId = crypto.randomUUID();
    const saved = await putGraph(
      worker,
      goal.id,
      current.version,
      [anchorNode(anchor.id), task(taskId, 'От Ивана', 2, 0)],
      [],
    );
    expect(saved.status).toBeLessThan(300);
    const seen = await graph(founder, goal.id);
    expect(seen.nodes.some((node) => node.title === 'От Ивана')).toBe(true);
  });

  it('две карточки дают 50%, удаление возвращает «Не начата», сдвиг x двигает только эту задачу', async () => {
    const goal = await createGoal(founder, {
      title: 'Прогресс',
      deadline: '2026-11-01',
      scaleStart: '2026-08-01',
    });
    const current = await graph(founder, goal.id);
    const anchor = current.nodes[0];
    const taskId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    const saved = await putGraph(
      founder,
      goal.id,
      current.version,
      [
        anchorNode(anchor.id),
        task(taskId, 'Фундамент', 10, 0),
        task(otherId, 'Проект', 5, 96),
      ],
      [],
    );
    expect(saved.status).toBeLessThan(300);
    const first = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/nodes/${taskId}/cards`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ title: 'Первая' });
    const second = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/nodes/${taskId}/cards`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ title: 'Вторая' });
    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    const moved = await request(app.getHttpServer())
      .post(`/api/v1/visual-paths/cards/${first.body.id}/move`)
      .set('Authorization', `Bearer ${founder}`)
      .send({ columnKey: 'done', position: 0 });
    expect(moved.status).toBeLessThan(300);
    const half = await graph(founder, goal.id);
    const foundation = half.nodes.find((node) => node.id === taskId)!;
    expect(foundation.progress).toBe(50);
    expect(foundation.status).toBe('in_progress');
    expect(half.criticalNodeIds).toEqual(saved.body.criticalNodeIds);
    expect(foundation.plannedStart).toBe('2026-08-01');
    expect(foundation.plannedEnd).toBe('2026-08-11');

    for (const cardId of [first.body.id, second.body.id]) {
      const deleted = await request(app.getHttpServer())
        .delete(`/api/v1/visual-paths/cards/${cardId}`)
        .set('Authorization', `Bearer ${founder}`);
      expect(deleted.status).toBeLessThan(300);
    }
    const cleared = await graph(founder, goal.id);
    const reset = cleared.nodes.find((node) => node.id === taskId)!;
    expect(reset.progress).toBeNull();
    expect(reset.status).toBe('not_started');

    const shifted = await putGraph(
      founder,
      goal.id,
      cleared.version,
      [
        anchorNode(anchor.id),
        task(taskId, 'Фундамент', 10, 48),
        task(otherId, 'Проект', 5, 96),
      ],
      [],
    );
    expect(shifted.status).toBeLessThan(300);
    const movedTask = shifted.body.nodes.find(
      (node: { id: string }) => node.id === taskId,
    );
    const stayed = shifted.body.nodes.find(
      (node: { id: string }) => node.id === otherId,
    );
    const stayedAnchor = shifted.body.nodes.find(
      (node: { id: string }) => node.id === anchor.id,
    );
    expect(movedTask.plannedStart).toBe('2026-08-02');
    expect(movedTask.plannedEnd).toBe('2026-08-12');
    expect(movedTask.estimateValue).toBe(10);
    expect(stayed.plannedStart).toBe('2026-08-03');
    expect(stayedAnchor.plannedStart).toBe('2026-08-16');
    expect(stayedAnchor.plannedEnd).toBe('2026-08-16');
  });

  it('нельзя убрать якорь и нельзя добавить второй', async () => {
    const goal = await createGoal(founder, { title: 'Якорь' });
    const current = await graph(founder, goal.id);
    const anchor = current.nodes[0];
    const taskId = crypto.randomUUID();
    const missing = await putGraph(
      founder,
      goal.id,
      current.version,
      [task(taskId, 'Без якоря', 1, 0)],
      [],
    );
    expect(missing.status).toBe(400);
    expect(missing.body.alertCode).toBe('ANCHOR_REQUIRED');
    const extra = await putGraph(
      founder,
      goal.id,
      current.version,
      [
        anchorNode(anchor.id),
        { ...task(crypto.randomUUID(), 'Второй', 0, 0), type: 'goal_anchor' },
      ],
      [],
    );
    expect(extra.status).toBe(400);
    expect(extra.body.alertCode).toBe('ANCHOR_COUNT');
    const same = await graph(founder, goal.id);
    expect(same.version).toBe(current.version);
    expect(same.nodes).toHaveLength(1);
  });
});

function anchorNode(id: string): NodeBody {
  return {
    id,
    type: 'goal_anchor',
    title: 'Цель',
    x: 720,
    y: 200,
    estimateValue: 0,
    estimateUnit: 'day',
  };
}

function task(
  id: string,
  title: string,
  estimateValue: number,
  x: number,
): NodeBody {
  return {
    id,
    type: 'task',
    title,
    x,
    y: 160,
    estimateValue,
    estimateUnit: 'day',
  };
}

function link(id: string, sourceNodeId: string, targetNodeId: string) {
  return { id, sourceNodeId, targetNodeId, durationValue: 999, label: 'чужое' };
}
