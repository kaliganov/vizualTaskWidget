import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

type Goal = {
  id: string;
  title: string;
  deadline: string | null;
  updatedAt: string;
};

export function GoalsPage() {
  const { user, logout } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('Постройка дома для продажи');
  const [deadline, setDeadline] = useState('');
  const [scaleStart, setScaleStart] = useState('2026-08-01');

  async function load() {
    setGoals(await api<Goal[]>('/visual-paths/goals'));
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await api('/visual-paths/goals', {
      method: 'POST',
      body: JSON.stringify({
        title,
        deadline: deadline || undefined,
        scaleStart: scaleStart || undefined,
      }),
    });
    setTitle('');
    await load();
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">Visual Paths</div>
        <div>
          <span className="muted">{user?.name}</span>{' '}
          <button className="btn ghost" onClick={logout}>Выйти</button>
        </div>
      </header>
      <div className="goals">
        <form className="card" onSubmit={create} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <strong>Новая цель</strong>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" required />
          <label className="muted">Дедлайн</label>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <label className="muted">Начало шкалы</label>
          <input type="date" value={scaleStart} onChange={(e) => setScaleStart(e.target.value)} />
          <button className="btn" type="submit">Создать цель</button>
        </form>
        <div className="goal-list">
          {goals.map((g) => (
            <Link key={g.id} className="card goal-item" to={`/goals/${g.id}`}>
              <div>
                <strong>{g.title}</strong>
                <div className="muted">{g.deadline ? `до ${g.deadline}` : 'без дедлайна'}</div>
              </div>
              <span className="muted">Открыть схему →</span>
            </Link>
          ))}
          {goals.length === 0 && (
            <p className="muted">Пока нет целей. Нажмите «Создать цель».</p>
          )}
        </div>
      </div>
    </div>
  );
}
