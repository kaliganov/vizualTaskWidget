import { Link, useParams } from 'react-router-dom';

export function BoardStubPage() {
  const { goalId } = useParams();
  return (
    <div className="page">
      <header className="topbar">
        <Link to={`/goals/${goalId}`}>← К схеме</Link>
      </header>
      <div className="goals">
        <div className="card">
          <h2>Канбан узла</h2>
          <p className="muted">
            Следующая фаза: 4 колонки, карточки, ответственные, чек-лист, комментарии, учёт времени и история.
          </p>
        </div>
      </div>
    </div>
  );
}
