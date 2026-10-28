import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { CardDialog } from '../components/CardDialog';

type User = { id: string; name: string };
type Card = {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  assigneeIds: string[];
  doneItems: number;
  itemCount: number;
  minutes: number;
  position: number;
};
type Column = { key: string; title: string; position: number; cards: Card[] };
type Board = { nodeId: string; title: string; columns: Column[] };

const PRIORITY: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

function findCard(board: Board, id: string) {
  for (const column of board.columns) {
    const card = column.cards.find((item) => item.id === id);
    if (card) return { card, column };
  }
  return null;
}

/** Та же вставка, что на сервере: вынуть и поставить индексом position. */
function placeCard(board: Board, cardId: string, columnKey: string, position: number): Board {
  const columns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.map((card) => ({ ...card })),
  }));
  let moving: Card | undefined;
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index < 0) continue;
    moving = column.cards.splice(index, 1)[0];
    column.cards.forEach((card, place) => {
      card.position = place;
    });
    break;
  }
  const target = columns.find((column) => column.key === columnKey);
  if (!moving || !target) return board;
  const index = Math.max(0, Math.min(position, target.cards.length));
  target.cards.splice(index, 0, moving);
  target.cards.forEach((card, place) => {
    card.position = place;
  });
  return { ...board, columns };
}

export function BoardPage() {
  const { goalId, nodeId } = useParams();
  const { user } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function load() {
    const [next, people] = await Promise.all([
      api<Board>(`/visual-paths/nodes/${nodeId}/board`),
      api<User[]>('/users'),
    ]);
    setBoard(next);
    setUsers(people);
  }

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  async function createCard() {
    const text = title.trim();
    if (!text) return;
    setTitle('');
    setError('');
    try {
      await api(`/visual-paths/nodes/${nodeId}/cards`, {
        method: 'POST',
        body: JSON.stringify({ title: text }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function onDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    dragged.current = true;
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
    if (!board || !event.over) return;
    const active = findCard(board, String(event.active.id));
    if (!active) return;
    const overId = String(event.over.id);
    let columnKey: string;
    let position: number;
    if (overId.startsWith('col:')) {
      columnKey = overId.slice(4);
      const column = board.columns.find((item) => item.key === columnKey);
      position = column?.cards.length ?? 0;
    } else {
      const over = findCard(board, overId);
      if (!over) return;
      columnKey = over.column.key;
      position = over.card.position;
    }
    if (columnKey === active.column.key && position === active.card.position) return;
    setBoard((current) => (current ? placeCard(current, active.card.id, columnKey, position) : current));
    setError('');
    try {
      await api(`/visual-paths/cards/${active.card.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ columnKey, position }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
      await load().catch(() => undefined);
    }
  }

  const names = new Map(users.map((item) => [item.id, item.name]));
  const dragging = draggingId && board ? findCard(board, draggingId) : null;

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <Link to={`/goals/${goalId}?node=${nodeId}`}>К схеме</Link>
          <strong style={{ marginLeft: 12 }}>{board?.title ?? 'Доска'}</strong>
        </div>
      </header>
      {error && <div className="error" style={{ padding: '8px 16px' }}>{error}</div>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={(event) => void onDragEnd(event)}
      >
        <div className="board">
          {board?.columns.map((column) => (
            <ColumnView
              key={column.key}
              column={column}
              names={names}
              title={title}
              setTitle={setTitle}
              onCreate={() => void createCard()}
              onOpen={(id) => {
                if (!dragged.current) setOpenId(id);
              }}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <CardFace card={dragging.card} names={names} overlay /> : null}
        </DragOverlay>
      </DndContext>
      {openId && user && (
        <CardDialog
          cardId={openId}
          users={users}
          me={user.id}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function ColumnView({
  column,
  names,
  title,
  setTitle,
  onCreate,
  onOpen,
}: {
  column: Column;
  names: Map<string, string>;
  title: string;
  setTitle: (value: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: `col:${column.key}` });
  return (
    <section className="column" ref={setNodeRef}>
      <strong>{column.title}</strong>
      <SortableContext items={column.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        {column.cards.map((card) => (
          <SortableCard key={card.id} card={card} names={names} onOpen={onOpen} />
        ))}
      </SortableContext>
      {column.key === 'todo' && (
        <div className="row">
          <input
            value={title}
            placeholder="Название"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreate();
            }}
          />
          <button className="btn" type="button" onClick={onCreate}>Добавить</button>
        </div>
      )}
    </section>
  );
}

function CardFace({
  card,
  names,
  overlay = false,
}: {
  card: Card;
  names: Map<string, string>;
  overlay?: boolean;
}) {
  const people = card.assigneeIds.map((id) => names.get(id) ?? id).join(', ');
  return (
    <article className={overlay ? 'kcard overlay' : 'kcard'}>
      <strong>{card.title}</strong>
      <div className="muted">
        {PRIORITY[card.priority] ?? card.priority}
        {card.dueDate ? ` · ${card.dueDate}` : ''}
      </div>
      {people && <div className="muted">{people}</div>}
      <div className="muted">
        Чек-лист {card.doneItems}/{card.itemCount} · {card.minutes} мин
      </div>
    </article>
  );
}

function SortableCard({
  card,
  names,
  onOpen,
}: {
  card: Card;
  names: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    animateLayoutChanges: () => false,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
    >
      <CardFace card={card} names={names} />
    </div>
  );
}
