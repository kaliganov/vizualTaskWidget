import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { widgetMode } from '../portal-auth';

type Goal = {
  id: string;
  title: string;
  deadline: string | null;
  updatedAt: string;
  currentTaskTitle: string;
  applicationNumber: string | null;
  dealTypeTitle: string;
  customerName: string;
  status: string;
};
type DealType = { id: string; title: string };
type Person = { id: string; position: string };
type ProcessTemplate = { id: string; title: string; goalId: string | null };

export function GoalsPage() {
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('Постройка дома для продажи');
  const [deadline, setDeadline] = useState('');
  const [dealTypes, setDealTypes] = useState<DealType[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [number, setNumber] = useState('');
  const [filterNumber, setFilterNumber] = useState('');
  const [status, setStatus] = useState('');
  const [position, setPosition] = useState('');
  const [dealTypeId, setDealTypeId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [contractName, setContractName] = useState('');
  const [objectName, setObjectName] = useState('');
  const [objectAddress, setObjectAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [newDeal, setNewDeal] = useState('');
  const [formError, setFormError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<'new' | 'deal' | 'filter' | 'templates' | null>(null);
  const [admin, setAdmin] = useState(
    () => widgetMode || (sessionStorage.getItem('vp_viewer') || 'admin') === 'admin',
  );
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateError, setTemplateError] = useState('');

  useEffect(() => {
    function sync() {
      setAdmin(widgetMode || (sessionStorage.getItem('vp_viewer') || 'admin') === 'admin');
    }
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  useEffect(() => {
    if (panel !== 'templates') return;
    void api<ProcessTemplate[]>('/process-templates')
      .then((rows) => {
        setTemplates(rows);
        setTemplateError('');
      })
      .catch((err) => setTemplateError(errorMessage(err)));
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null);
    }
    function onDown(event: MouseEvent) {
      if (panel !== 'deal' && panel !== 'filter') return;
      const target = event.target;
      if (target instanceof Element && target.closest('.tool-slot')) return;
      setPanel(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [panel]);

  async function load(filters = { number: filterNumber, status, position }) {
    const params = new URLSearchParams();
    if (filters.number) params.set('number', filters.number);
    if (filters.status) params.set('status', filters.status);
    if (filters.position) params.set('position', filters.position);
    const query = params.toString();
    const [rows, types, people] = await Promise.all([
      api<Goal[]>(`/visual-paths/goals${query ? `?${query}` : ''}`),
      api<DealType[]>('/deal-types'),
      api<Person[]>('/users'),
    ]);
    setGoals(rows);
    setDealTypes(types);
    setPositions([...new Set(people.map((person) => person.position).filter(Boolean))]);
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await load();
          if (!cancelled) {
            setLoadError('');
            setLoading(false);
          }
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt === 7) {
            setLoadError(errorMessage(err));
            setLoading(false);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    try {
      const created = await api<{ id: string }>('/visual-paths/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: contractName || title || `Заявка ${number}`,
          deadline: deadline || undefined,
          applicationNumber: number,
          dealTypeId: dealTypeId || undefined,
          customerName,
          contractName,
          objectName,
          objectAddress,
          orderNotes,
        }),
      });
      navigate(`/goals/${created.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    setTemplateError('');
    try {
      const created = await api<{ goalId: string }>('/process-templates', {
        method: 'POST',
        body: JSON.stringify({ title: templateTitle.trim() }),
      });
      setTemplateTitle('');
      setPanel(null);
      navigate(`/goals/${created.goalId}`);
    } catch (err) {
      setTemplateError(errorMessage(err));
    }
  }

  async function addDealType(e: FormEvent) {
    e.preventDefault();
    if (!newDeal.trim()) return;
    await api('/deal-types', { method: 'POST', body: JSON.stringify({ title: newDeal.trim() }) });
    setNewDeal('');
    await load();
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">Visual Paths</div>
        <div />
      </header>
      <main className="goals">
        <div className="tool-row">
          <button className="btn" type="button" onClick={() => setPanel('new')}>Новая заявка</button>
          <div className="tool-slot">
            <button className="btn secondary" type="button" onClick={() => setPanel(panel === 'deal' ? null : 'deal')}>Вид сделки</button>
            {panel === 'deal' ? (
              <form className="card menu-pop" onSubmit={(event) => void addDealType(event)}>
                <strong>Виды сделки</strong>
                {dealTypes.length === 0 ? <p className="muted">Пока нет</p> : dealTypes.map((item) => (
                  <div key={item.id}>{item.title}</div>
                ))}
                <label className="muted" htmlFor="new-deal">Новый вид сделки</label>
                <input id="new-deal" name="newDeal" value={newDeal} onChange={(e) => setNewDeal(e.target.value)} placeholder="Новый вид сделки" />
                <button className="btn" type="submit">Добавить</button>
              </form>
            ) : null}
          </div>
          {admin ? (
            <button className="btn secondary" type="button" onClick={() => setPanel(panel === 'templates' ? null : 'templates')}>
              Шаблоны процессов
            </button>
          ) : null}
          <div className="tool-slot filter-slot">
            <button className="btn secondary" type="button" onClick={() => setPanel(panel === 'filter' ? null : 'filter')}>Фильтр</button>
            {panel === 'filter' ? (
              <form
                className="filter-rail"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPanel(null);
                  void load();
                }}
              >
                <div className="filter-step">
                  <label className="muted" htmlFor="filter-number">Номер заявки</label>
                  <input id="filter-number" name="number" value={filterNumber} onChange={(e) => setFilterNumber(e.target.value)} placeholder="Номер заявки" />
                </div>
                <div className="filter-step">
                  <label className="muted" htmlFor="filter-status">Статус</label>
                  <select id="filter-status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">Все статусы</option>
                    <option value="not_started">Не начата</option>
                    <option value="in_progress">В работе</option>
                    <option value="done">Готово</option>
                  </select>
                </div>
                <div className="filter-step">
                  <label className="muted" htmlFor="filter-position">Должность</label>
                  <select id="filter-position" name="position" value={position} onChange={(e) => setPosition(e.target.value)}>
                    <option value="">Все должности</option>
                    {positions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <button className="btn filter-step" type="submit">Применить</button>
              </form>
            ) : null}
          </div>
        </div>
        {loadError ? <p className="error">{loadError}</p> : null}
        {(filterNumber || status || position) ? (
          <p className="muted">
            Сейчас в списке: {[filterNumber, status === 'not_started' ? 'не начата' : status === 'in_progress' ? 'в работе' : status === 'done' ? 'готово' : '', position].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <div className="goal-list">
          {goals.map((g) => (
            <article key={g.id} className="card goal-item">
              <div>
                <strong>{g.applicationNumber ? `Заявка ${g.applicationNumber}` : g.title}</strong>
                <div className="muted">{g.customerName || g.dealTypeTitle || (g.deadline ? `до ${g.deadline}` : 'без дедлайна')}</div>
                <div className="muted">Сейчас: {g.currentTaskTitle || '—'}</div>
              </div>
              <div className="goal-actions">
                <button className="btn" type="button" onClick={() => navigate(`/goals/${g.id}`)}>Открыть</button>
              </div>
            </article>
          ))}
          {loading ? (
            <p className="muted" role="status">загрузка…</p>
          ) : goals.length === 0 && !loadError ? (
            <p className="muted">Пока нет заявок. Нажмите «Новая заявка».</p>
          ) : null}
        </div>
        {panel === 'new' ? (
          <div className="dialog-back" onMouseDown={() => setPanel(null)}>
            <form className="dialog card" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void create(event)}>
              <div className="dialog-head">
                <strong>Новая заявка</strong>
                <button className="btn ghost" type="button" onClick={() => setPanel(null)}>Закрыть</button>
              </div>
              <label className="muted" htmlFor="app-number">Номер заявки</label>
              <input id="app-number" name="number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Номер заявки" required autoFocus />
              <label className="muted" htmlFor="app-deal">Вид сделки</label>
              <select id="app-deal" name="dealTypeId" value={dealTypeId} onChange={(e) => setDealTypeId(e.target.value)} required>
                <option value="">Выберите</option>
                {dealTypes.map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
              <label className="muted" htmlFor="app-customer">Наименование заказчика</label>
              <input id="app-customer" name="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Наименование заказчика" required />
              <label className="muted" htmlFor="app-contract">Наименование контракта</label>
              <input id="app-contract" name="contractName" value={contractName} onChange={(e) => setContractName(e.target.value)} placeholder="Наименование контракта" required />
              <label className="muted" htmlFor="app-object">Наименование объекта</label>
              <input id="app-object" name="objectName" value={objectName} onChange={(e) => setObjectName(e.target.value)} placeholder="Наименование объекта" required />
              <label className="muted" htmlFor="app-address">Адрес объекта</label>
              <input id="app-address" name="objectAddress" value={objectAddress} onChange={(e) => setObjectAddress(e.target.value)} placeholder="Адрес объекта" required />
              <label className="muted" htmlFor="app-notes">Примечания</label>
              <textarea id="app-notes" name="orderNotes" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Примечания" />
              <label className="muted" htmlFor="app-deadline">Дедлайн</label>
              <input id="app-deadline" name="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              {formError ? <p className="error">{formError}</p> : null}
              <button className="btn" type="submit">Создать заявку</button>
            </form>
          </div>
        ) : null}
        {panel === 'templates' ? (
          <div className="dialog-back" onMouseDown={() => setPanel(null)}>
            <form className="dialog card template-sheet" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void createTemplate(event)}>
              <div className="dialog-head">
                <strong>Шаблоны процессов</strong>
                <button className="btn ghost" type="button" onClick={() => setPanel(null)}>Закрыть</button>
              </div>
              {templateError ? <p className="error">{templateError}</p> : templates.length > 0 ? (
                <ul className="template-list">
                  {templates.map((item) => (
                    <li key={item.id}>
                      <span>{item.title}</span>
                      {item.goalId ? (
                        <button className="btn secondary" type="button" onClick={() => navigate(`/goals/${item.goalId}`)}>Открыть</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Шаблонов пока нет</p>
              )}
              <div className="template-new">
                <label className="muted" htmlFor="template-title">Новый шаблон</label>
                <div className="row">
                  <input id="template-title" name="templateTitle" value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} placeholder="Название шаблона" required autoFocus />
                  <button className="btn" type="submit">Создать</button>
                </div>
              </div>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}

