import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';

type User = { id: string; name: string };
type ChecklistItem = { id?: string; text: string; done: boolean };
type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
};
type TimeEntry = {
  id: string;
  userName: string;
  minutes: number;
  note: string;
  createdAt: string;
};
type HistoryEvent = {
  id: string;
  type: string;
  payload: { fields?: string[]; minutes?: number; columnKey?: string };
  createdAt: string;
  authorName: string;
};
type CardDetail = {
  id: string;
  title: string;
  description: string;
  priority: string;
  dueDate: string | null;
  assigneeIds: string[];
  checklist: ChecklistItem[];
  comments: Comment[];
  timeEntries: TimeEntry[];
  runningTimer: { startedAt: string } | null;
  minutes: number;
};

const PRIORITY = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];

const EVENT_LABEL: Record<string, string> = {
  created: 'Создание',
  updated: 'Изменение',
  moved: 'Перенос',
  comment_added: 'Комментарий',
  comment_updated: 'Правка комментария',
  comment_deleted: 'Удаление комментария',
  checklist_set: 'Чек-лист',
  time_logged: 'Учёт времени',
  timer_started: 'Старт таймера',
  timer_stopped: 'Стоп таймера',
  deleted: 'Удаление',
};

const FIELD_LABEL: Record<string, string> = {
  title: 'название',
  description: 'описание',
  priority: 'приоритет',
  dueDate: 'срок',
  assigneeIds: 'ответственные',
};

function stamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

export function CardDialog({
  cardId,
  users,
  me,
  onClose,
  onChanged,
}: {
  cardId: string;
  users: User[];
  me: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const cardRef = useRef<CardDetail | null>(null);
  cardRef.current = card;
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState('');
  const [checkText, setCheckText] = useState('');

  async function load() {
    const [detail, events] = await Promise.all([
      api<CardDetail>(`/visual-paths/cards/${cardId}`),
      api<HistoryEvent[]>(`/visual-paths/cards/${cardId}/history`),
    ]);
    setCard(detail);
    setHistory(events);
  }

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function saveFields(patch: Partial<CardDetail>) {
    const current = cardRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    cardRef.current = next;
    setCard(next);
    void run(() =>
      api(`/visual-paths/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: next.title,
          description: next.description,
          priority: next.priority,
          dueDate: next.dueDate,
          assigneeIds: next.assigneeIds,
        }),
      }),
    );
  }

  function saveChecklist(items: ChecklistItem[]) {
    void run(() =>
      api(`/visual-paths/cards/${cardId}/checklist`, {
        method: 'PUT',
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            text: item.text,
            done: item.done,
          })),
        }),
      }),
    );
  }

  if (!card) {
    return (
      <div className="dialog-back">
        <div className="dialog card">
          {error ? <div className="error">{error}</div> : <p>Загрузка…</p>}
          <button className="btn secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <strong>Карточка</strong>
          <button className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
        {error && <div className="error">{error}</div>}
        <label className="muted">Название</label>
        <input
          value={card.title}
          onChange={(event) => setCard({ ...card, title: event.target.value })}
          onBlur={(event) => saveFields({ title: event.target.value })}
        />
        <label className="muted">Описание</label>
        <textarea
          value={card.description}
          onChange={(event) => setCard({ ...card, description: event.target.value })}
          onBlur={(event) => saveFields({ description: event.target.value })}
        />
        <label className="muted">Приоритет</label>
        <select
          value={card.priority}
          onChange={(event) => saveFields({ priority: event.target.value })}
        >
          {PRIORITY.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <label className="muted">Срок</label>
        <input
          type="date"
          value={card.dueDate ?? ''}
          onChange={(event) => saveFields({ dueDate: event.target.value || null })}
        />
        <label className="muted">Ответственные</label>
        <div className="checks">
          {users.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={card.assigneeIds.includes(item.id)}
                onChange={(event) => {
                  const assigneeIds = event.target.checked
                    ? [...card.assigneeIds, item.id]
                    : card.assigneeIds.filter((id) => id !== item.id);
                  saveFields({ assigneeIds });
                }}
              />
              {item.name}
            </label>
          ))}
        </div>
        <strong>Чек-лист</strong>
        {card.checklist.map((item, index) => (
          <label key={item.id ?? index} className="check-row">
            <input
              type="checkbox"
              checked={item.done}
              onChange={(event) => {
                const checklist = card.checklist.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, done: event.target.checked } : row,
                );
                saveChecklist(checklist);
              }}
            />
            <span>{item.text}</span>
            <button
              className="btn ghost"
              type="button"
              onClick={() => saveChecklist(card.checklist.filter((_, rowIndex) => rowIndex !== index))}
            >
              убрать
            </button>
          </label>
        ))}
        <div className="row">
          <input
            value={checkText}
            placeholder="Новый пункт"
            onChange={(event) => setCheckText(event.target.value)}
          />
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              const text = checkText.trim();
              if (!text) return;
              setCheckText('');
              saveChecklist([...card.checklist, { text, done: false }]);
            }}
          >
            Добавить
          </button>
        </div>
        <strong>Комментарии</strong>
        {card.comments.map((item) => (
          <div key={item.id} className="comment">
            <div className="muted">{item.authorName} · {stamp(item.createdAt)}</div>
            <div>{item.text}</div>
            {item.authorId === me && (
              <div className="row">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    const text = window.prompt('Комментарий', item.text);
                    if (!text?.trim()) return;
                    void run(() =>
                      api(`/visual-paths/cards/${cardId}/comments/${item.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ text: text.trim() }),
                      }),
                    );
                  }}
                >
                  Изменить
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    void run(() =>
                      api(`/visual-paths/cards/${cardId}/comments/${item.id}`, { method: 'DELETE' }),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
        ))}
        <div className="row">
          <input
            value={comment}
            placeholder="Комментарий"
            onChange={(event) => setComment(event.target.value)}
          />
          <button
            className="btn"
            type="button"
            onClick={() => {
              const text = comment.trim();
              if (!text) return;
              setComment('');
              void run(() =>
                api(`/visual-paths/cards/${cardId}/comments`, {
                  method: 'POST',
                  body: JSON.stringify({ text }),
                }),
              );
            }}
          >
            Отправить
          </button>
        </div>
        <strong>Время · {card.minutes} мин</strong>
        {card.timeEntries.map((entry) => (
          <div key={entry.id} className="muted">
            {entry.userName}: {entry.minutes} мин{entry.note ? ` — ${entry.note}` : ''}
          </div>
        ))}
        <div className="row">
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
          <input value={note} placeholder="Заметка" onChange={(event) => setNote(event.target.value)} />
          <button
            className="btn secondary"
            type="button"
            onClick={() =>
              void run(() =>
                api(`/visual-paths/cards/${cardId}/time-entries`, {
                  method: 'POST',
                  body: JSON.stringify({ minutes, note }),
                }),
              )
            }
          >
            Записать
          </button>
        </div>
        {card.runningTimer ? (
          <button
            className="btn"
            type="button"
            onClick={() => void run(() => api(`/visual-paths/cards/${cardId}/timer/stop`, { method: 'POST' }))}
          >
            Остановить таймер ({stamp(card.runningTimer.startedAt)})
          </button>
        ) : (
          <button
            className="btn secondary"
            type="button"
            onClick={() => void run(() => api(`/visual-paths/cards/${cardId}/timer/start`, { method: 'POST' }))}
          >
            Старт таймера
          </button>
        )}
        <strong>История</strong>
        {history.map((event) => (
          <div key={event.id} className="muted">
            {stamp(event.createdAt)} · {event.authorName} · {EVENT_LABEL[event.type] ?? event.type}
            {event.payload?.fields?.length
              ? `: ${event.payload.fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}`
              : ''}
            {event.payload?.minutes ? ` · ${event.payload.minutes} мин` : ''}
          </div>
        ))}
        {history.length === 0 && <p className="muted">Пока пусто</p>}
      </div>
    </div>
  );
}
