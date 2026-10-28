import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { apiError } from '../common/api-error';
import type { AuthUser } from '../common/current-user.decorator';
import { asDate } from '../graph/schedule';
import { Goal } from '../goals/goal.entity';
import { GraphNode } from '../graph/graph-node.entity';
import { User } from '../users/user.entity';
import { Board } from './board.entity';
import { CardAssignee } from './card-assignee.entity';
import { CardEvent, type CardEventType } from './card-event.entity';
import { Card, type ColumnKey } from './card.entity';
import { ChecklistItem } from './checklist-item.entity';
import { Comment } from './comment.entity';
import type {
  CreateCardDto,
  MoveCardDto,
  PutChecklistDto,
  TimeEntryDto,
  UpdateCardDto,
} from './kanban.dto';
import { TimeEntry } from './time-entry.entity';
import { Timer } from './timer.entity';

const COLUMNS: { key: ColumnKey; title: string; position: number }[] = [
  { key: 'todo', title: 'Задача', position: 1 },
  { key: 'in_progress', title: 'В работе', position: 2 },
  { key: 'testing', title: 'Тестирование', position: 3 },
  { key: 'done', title: 'Готово', position: 4 },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class KanbanService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async countCards(nodeId: string) {
    const board = await this.boards.findOne({ where: { nodeId } });
    if (!board) return 0;
    return this.cards.count({ where: { boardId: board.id } });
  }

  async createBoard(em: EntityManager, nodeId: string) {
    const found = await em.findOne(Board, { where: { nodeId } });
    if (found) return found;
    return em.save(Board, em.create(Board, { nodeId }));
  }

  /** Узел удаляется вместе с доской, карточками и историей. */
  async removeTasks(em: EntityManager, nodeIds: string[]) {
    if (!nodeIds.length) return;
    const boards = await em.find(Board, { where: { nodeId: In(nodeIds) } });
    const boardIds = boards.map((board) => board.id);
    if (boardIds.length) {
      const cards = await em.find(Card, { where: { boardId: In(boardIds) } });
      const cardIds = cards.map((card) => card.id);
      if (cardIds.length) {
        await em.delete(CardEvent, { cardId: In(cardIds) });
        await em.delete(CardAssignee, { cardId: In(cardIds) });
        await em.delete(ChecklistItem, { cardId: In(cardIds) });
        await em.delete(Comment, { cardId: In(cardIds) });
        await em.delete(TimeEntry, { cardId: In(cardIds) });
        await em.delete(Timer, { cardId: In(cardIds) });
        await em.delete(Card, { id: In(cardIds) });
      }
      await em.delete(Board, { id: In(boardIds) });
    }
    await em.delete(GraphNode, { id: In(nodeIds) });
  }

  getBoard(user: AuthUser, nodeId: string) {
    return this.dataSource.transaction((em) => this.boardOf(em, user, nodeId));
  }

  createCard(user: AuthUser, nodeId: string, dto: CreateCardDto) {
    const title = dto.title.trim();
    if (!title) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ERROR',
        'Название карточки не может быть пустым',
      );
    }
    return this.dataSource.transaction(async (em) => {
      const { node } = await this.requireTask(em, user, nodeId);
      const board = await this.createBoard(em, node.id);
      const position = await em.count(Card, {
        where: { boardId: board.id, columnKey: 'todo' },
      });
      const card = await em.save(
        Card,
        em.create(Card, {
          boardId: board.id,
          columnKey: 'todo',
          position,
          title,
          description: '',
          priority: 'medium',
          dueDate: null,
        }),
      );
      await this.addEvent(em, card.id, user.id, 'created', { title });
      await this.recompute(em, node.id);
      return this.cardDocument(em, user, card.id);
    });
  }

  getCard(user: AuthUser, cardId: string) {
    return this.dataSource.transaction((em) =>
      this.cardDocument(em, user, cardId),
    );
  }

  updateCard(user: AuthUser, cardId: string, dto: UpdateCardDto) {
    return this.dataSource.transaction(async (em) => {
      const { card, goal } = await this.requireCard(em, user, cardId);
      const fields: string[] = [];
      if (dto.title !== undefined) {
        const title = dto.title.trim();
        if (!title) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'ERROR',
            'Название карточки не может быть пустым',
          );
        }
        if (title !== card.title) {
          card.title = title;
          fields.push('title');
        }
      }
      if (
        dto.description !== undefined &&
        dto.description !== card.description
      ) {
        card.description = dto.description;
        fields.push('description');
      }
      if (dto.priority !== undefined && dto.priority !== card.priority) {
        card.priority = dto.priority;
        fields.push('priority');
      }
      if (dto.dueDate !== undefined) {
        if (dto.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dto.dueDate)) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'ERROR',
            'Срок в формате ГГГГ-ММ-ДД',
          );
        }
        const next = dto.dueDate ? asDate(dto.dueDate) : null;
        if (next !== asDate(card.dueDate)) {
          card.dueDate = next;
          fields.push('dueDate');
        }
      }
      if (dto.assigneeIds !== undefined) {
        const ids = await this.assertAssignees(goal.companyId, dto.assigneeIds);
        const current = await em.find(CardAssignee, { where: { cardId } });
        const same =
          current
            .map((row) => row.userId)
            .sort()
            .join(',') === [...ids].sort().join(',');
        if (!same) {
          await em.delete(CardAssignee, { cardId });
          if (ids.length) {
            await em.save(
              CardAssignee,
              ids.map((userId) => em.create(CardAssignee, { cardId, userId })),
            );
          }
          fields.push('assigneeIds');
        }
      }
      if (fields.length) {
        await em.save(card);
        await this.addEvent(em, card.id, user.id, 'updated', { fields });
      }
      return this.cardDocument(em, user, card.id);
    });
  }

  moveCard(user: AuthUser, cardId: string, dto: MoveCardDto) {
    return this.dataSource.transaction(async (em) => {
      const { card, board, node } = await this.requireCard(em, user, cardId);
      const from = card.columnKey;
      const to = dto.columnKey;
      const all = await em.find(Card, {
        where: { boardId: board.id },
        order: { position: 'ASC' },
      });
      const source = all.filter(
        (item) => item.columnKey === from && item.id !== card.id,
      );
      const target =
        from === to
          ? source
          : all.filter((item) => item.columnKey === to && item.id !== card.id);
      const index = Math.max(0, Math.min(dto.position, target.length));
      target.splice(index, 0, card);
      card.columnKey = to;
      target.forEach((item, position) => {
        item.position = position;
      });
      await em.save(Card, target);
      if (from !== to) {
        source.forEach((item, position) => {
          item.position = position;
        });
        await em.save(Card, source);
      }
      await this.addEvent(em, card.id, user.id, 'moved', {
        columnKey: to,
        position: index,
      });
      await this.recompute(em, node.id);
      return this.boardOf(em, user, node.id);
    });
  }

  deleteCard(user: AuthUser, cardId: string) {
    return this.dataSource.transaction(async (em) => {
      const { card, board, node } = await this.requireCard(em, user, cardId);
      const columnKey = card.columnKey;
      await this.addEvent(em, card.id, user.id, 'deleted', {
        title: card.title,
      });
      await em.delete(CardAssignee, { cardId });
      await em.delete(ChecklistItem, { cardId });
      await em.delete(Comment, { cardId });
      await em.delete(TimeEntry, { cardId });
      await em.delete(Timer, { cardId });
      await em.delete(Card, { id: cardId });
      const rest = await em.find(Card, {
        where: { boardId: board.id, columnKey },
        order: { position: 'ASC' },
      });
      rest.forEach((item, position) => {
        item.position = position;
      });
      if (rest.length) await em.save(Card, rest);
      await this.recompute(em, node.id);
      return this.boardOf(em, user, node.id);
    });
  }

  setChecklist(user: AuthUser, cardId: string, dto: PutChecklistDto) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const previous = await em.find(ChecklistItem, { where: { cardId } });
      const owned = new Set(previous.map((item) => item.id));
      await em.delete(ChecklistItem, { cardId });
      const rows = dto.items.map((item, position) => {
        const text = item.text.trim();
        if (!text) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'ERROR',
            'Пункт чек-листа не может быть пустым',
          );
        }
        return em.create(ChecklistItem, {
          ...(item.id && owned.has(item.id) ? { id: item.id } : {}),
          cardId,
          text,
          done: item.done,
          position,
        });
      });
      if (rows.length) await em.save(ChecklistItem, rows);
      await this.addEvent(em, cardId, user.id, 'checklist_set', {
        count: rows.length,
      });
      return this.cardDocument(em, user, cardId);
    });
  }

  addComment(user: AuthUser, cardId: string, text: string) {
    const body = text.trim();
    if (!body) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ERROR',
        'Комментарий не может быть пустым',
      );
    }
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const comment = await em.save(
        Comment,
        em.create(Comment, { cardId, authorId: user.id, text: body }),
      );
      await this.addEvent(em, cardId, user.id, 'comment_added', {
        commentId: comment.id,
      });
      return this.cardDocument(em, user, cardId);
    });
  }

  updateComment(
    user: AuthUser,
    cardId: string,
    commentId: string,
    text: string,
  ) {
    const body = text.trim();
    if (!body) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ERROR',
        'Комментарий не может быть пустым',
      );
    }
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const comment = await em.findOne(Comment, {
        where: { id: commentId, cardId },
      });
      if (!comment) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'CARD_NOT_FOUND',
          'Комментарий не найден',
        );
      }
      if (comment.authorId !== user.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'COMMENT_FORBIDDEN',
          'Комментарий может изменить только автор',
        );
      }
      comment.text = body;
      await em.save(comment);
      await this.addEvent(em, cardId, user.id, 'comment_updated', {
        commentId,
      });
      return this.cardDocument(em, user, cardId);
    });
  }

  deleteComment(user: AuthUser, cardId: string, commentId: string) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const comment = await em.findOne(Comment, {
        where: { id: commentId, cardId },
      });
      if (!comment) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'CARD_NOT_FOUND',
          'Комментарий не найден',
        );
      }
      if (comment.authorId !== user.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'COMMENT_FORBIDDEN',
          'Комментарий может удалить только автор',
        );
      }
      await em.delete(Comment, { id: commentId });
      await this.addEvent(em, cardId, user.id, 'comment_deleted', {
        commentId,
      });
      return this.cardDocument(em, user, cardId);
    });
  }

  addTime(user: AuthUser, cardId: string, dto: TimeEntryDto) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      await em.save(
        TimeEntry,
        em.create(TimeEntry, {
          cardId,
          userId: user.id,
          minutes: dto.minutes,
          note: dto.note ?? '',
        }),
      );
      await this.addEvent(em, cardId, user.id, 'time_logged', {
        minutes: dto.minutes,
      });
      return this.cardDocument(em, user, cardId);
    });
  }

  startTimer(user: AuthUser, cardId: string) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const running = await em.findOne(Timer, {
        where: { cardId, userId: user.id },
      });
      if (running) {
        throw apiError(
          HttpStatus.CONFLICT,
          'TIMER_ALREADY_RUNNING',
          'Таймер уже запущен',
        );
      }
      await em.save(
        Timer,
        em.create(Timer, { cardId, userId: user.id, startedAt: new Date() }),
      );
      await this.addEvent(em, cardId, user.id, 'timer_started', {});
      return this.cardDocument(em, user, cardId);
    });
  }

  stopTimer(user: AuthUser, cardId: string) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const timer = await em.findOne(Timer, {
        where: { cardId, userId: user.id },
      });
      if (!timer) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'TIMER_NOT_FOUND',
          'Таймер не запущен',
        );
      }
      const elapsed = Date.now() - new Date(timer.startedAt).getTime();
      const minutes = Math.max(1, Math.round(elapsed / 60000));
      await em.save(
        TimeEntry,
        em.create(TimeEntry, {
          cardId,
          userId: user.id,
          minutes,
          note: '',
        }),
      );
      await em.delete(Timer, { id: timer.id });
      await this.addEvent(em, cardId, user.id, 'timer_stopped', { minutes });
      return this.cardDocument(em, user, cardId);
    });
  }

  history(user: AuthUser, cardId: string) {
    return this.dataSource.transaction(async (em) => {
      await this.requireCard(em, user, cardId);
      const events = await em.find(CardEvent, {
        where: { cardId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      const names = await this.names(events.map((event) => event.actorId));
      return events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
        actorId: event.actorId,
        authorName: names.get(event.actorId) ?? '',
      }));
    });
  }

  private async boardOf(em: EntityManager, user: AuthUser, nodeId: string) {
    const { node } = await this.requireTask(em, user, nodeId);
    const board = await this.createBoard(em, node.id);
    const cards = await em.find(Card, {
      where: { boardId: board.id },
      order: { position: 'ASC' },
    });
    const ids = cards.map((card) => card.id);
    const assignees = ids.length
      ? await em.find(CardAssignee, { where: { cardId: In(ids) } })
      : [];
    const items = ids.length
      ? await em.find(ChecklistItem, { where: { cardId: In(ids) } })
      : [];
    const times = ids.length
      ? await em.find(TimeEntry, { where: { cardId: In(ids) } })
      : [];
    return {
      nodeId: node.id,
      title: node.title,
      columns: COLUMNS.map((column) => ({
        key: column.key,
        title: column.title,
        position: column.position,
        cards: cards
          .filter((card) => card.columnKey === column.key)
          .sort((a, b) => a.position - b.position)
          .map((card) => ({
            id: card.id,
            title: card.title,
            priority: card.priority,
            dueDate: asDate(card.dueDate),
            assigneeIds: assignees
              .filter((row) => row.cardId === card.id)
              .map((row) => row.userId),
            doneItems: items.filter(
              (item) => item.cardId === card.id && item.done,
            ).length,
            itemCount: items.filter((item) => item.cardId === card.id).length,
            minutes: times
              .filter((row) => row.cardId === card.id)
              .reduce((sum, row) => sum + row.minutes, 0),
            position: card.position,
          })),
      })),
    };
  }

  private async cardDocument(
    em: EntityManager,
    user: AuthUser,
    cardId: string,
  ) {
    const { card } = await this.requireCard(em, user, cardId);
    const assignees = await em.find(CardAssignee, { where: { cardId } });
    const checklist = await em.find(ChecklistItem, {
      where: { cardId },
      order: { position: 'ASC' },
    });
    const comments = await em.find(Comment, {
      where: { cardId },
      order: { createdAt: 'ASC' },
    });
    const timeEntries = await em.find(TimeEntry, {
      where: { cardId },
      order: { createdAt: 'ASC' },
    });
    const timer = await em.findOne(Timer, {
      where: { cardId, userId: user.id },
    });
    const names = await this.names([
      ...comments.map((comment) => comment.authorId),
      ...timeEntries.map((entry) => entry.userId),
    ]);
    return {
      id: card.id,
      columnKey: card.columnKey,
      position: card.position,
      title: card.title,
      description: card.description,
      priority: card.priority,
      dueDate: asDate(card.dueDate),
      assigneeIds: assignees.map((row) => row.userId),
      checklist: checklist.map((item) => ({
        id: item.id,
        text: item.text,
        done: item.done,
        position: item.position,
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        authorId: comment.authorId,
        authorName: names.get(comment.authorId) ?? '',
        text: comment.text,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      })),
      timeEntries: timeEntries.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        userName: names.get(entry.userId) ?? '',
        minutes: entry.minutes,
        note: entry.note,
        createdAt: entry.createdAt,
      })),
      runningTimer: timer ? { startedAt: timer.startedAt } : null,
      minutes: timeEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    };
  }

  /** Пока карточек нет — ручной not_started. Иначе статус выводится из колонок. */
  private async recompute(em: EntityManager, nodeId: string) {
    const board = await em.findOne(Board, { where: { nodeId } });
    const node = await em.findOne(GraphNode, { where: { id: nodeId } });
    if (!board || !node) return;
    const cards = await em.find(Card, { where: { boardId: board.id } });
    if (cards.length === 0) {
      node.progress = null;
      node.progressCached = 0;
      node.status = 'not_started';
    } else {
      const doneCount = cards.filter(
        (card) => card.columnKey === 'done',
      ).length;
      node.progress = Math.round((100 * doneCount) / cards.length);
      node.progressCached = node.progress;
      const allTodo = cards.every((card) => card.columnKey === 'todo');
      const allDone = doneCount === cards.length;
      node.status = allTodo ? 'not_started' : allDone ? 'done' : 'in_progress';
    }
    await em.save(node);
  }

  private async requireTask(em: EntityManager, user: AuthUser, nodeId: string) {
    const node = await em.findOne(GraphNode, { where: { id: nodeId } });
    if (!node) {
      throw apiError(HttpStatus.NOT_FOUND, 'NODE_NOT_FOUND', 'Узел не найден');
    }
    const goal = await em.findOne(Goal, {
      where: { id: node.goalId, companyId: user.companyId },
    });
    if (!goal) {
      throw apiError(HttpStatus.NOT_FOUND, 'NODE_NOT_FOUND', 'Узел не найден');
    }
    if (node.type !== 'task') {
      throw apiError(HttpStatus.BAD_REQUEST, 'NOT_A_TASK', 'У якоря нет доски');
    }
    return { node, goal };
  }

  private async requireCard(em: EntityManager, user: AuthUser, cardId: string) {
    const card = await em.findOne(Card, { where: { id: cardId } });
    if (!card) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Карточка не найдена',
      );
    }
    const board = await em.findOne(Board, { where: { id: card.boardId } });
    if (!board) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Карточка не найдена',
      );
    }
    const node = await em.findOne(GraphNode, { where: { id: board.nodeId } });
    if (!node) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Карточка не найдена',
      );
    }
    const goal = await em.findOne(Goal, {
      where: { id: node.goalId, companyId: user.companyId },
    });
    if (!goal) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Карточка не найдена',
      );
    }
    return { card, board, node, goal };
  }

  private async assertAssignees(companyId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return unique;
    if (unique.some((id) => !UUID.test(id))) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ASSIGNEE_NOT_IN_COMPANY',
        'Ответственный не из компании',
      );
    }
    const found = await this.users.count({
      where: { id: In(unique), companyId },
    });
    if (found !== unique.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ASSIGNEE_NOT_IN_COMPANY',
        'Ответственный не из компании',
      );
    }
    return unique;
  }

  private names(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return Promise.resolve(new Map<string, string>());
    return this.users
      .find({ where: { id: In(unique) } })
      .then((rows) => new Map(rows.map((user) => [user.id, user.name])));
  }

  private addEvent(
    em: EntityManager,
    cardId: string,
    actorId: string,
    type: CardEventType,
    payload: Record<string, unknown>,
  ) {
    return em.save(
      CardEvent,
      em.create(CardEvent, { cardId, actorId, type, payload }),
    );
  }
}
