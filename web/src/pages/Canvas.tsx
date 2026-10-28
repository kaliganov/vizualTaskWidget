import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  ViewportPortal,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { TaskNode, type TaskData } from '../components/TaskNode';
import { addCalendarDays, analyzeGraph, dayIndexFrom, formatEstimate, utcToday } from '../schedule';

type User = { id: string; name: string };
type GraphNode = {
  id: string;
  type: string;
  title: string;
  description: string;
  x: number;
  y: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  assigneeId: string | null;
  estimateValue: number;
  estimateUnit: string;
  status: string;
  progress: number | null;
};
type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  durationValue: number;
  durationUnit: string;
  label: string;
};
type Graph = {
  version: number;
  scaleStart: string;
  deadline: string | null;
  deadlineExceeded: boolean;
  criticalNodeIds: string[];
  criticalEdgeIds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};
type Goal = {
  title: string;
  description: string;
  deadline: string | null;
  scaleStart: string | null;
};

const nodeTypes = { task: TaskNode };
const DAY = 48;

/** Шаг подписей: каждый день, пока колонка читается, иначе неделя или месяц. */
function axisStep(zoom: number) {
  const gap = DAY * zoom;
  if (gap >= 32) return 1;
  if (gap >= 8) return 7;
  return 30;
}

function shortDate(iso: string) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** Вертикальные дни шкалы. x = 0 — это scaleStart, 48 px = один день. */
function DayAxis({ scaleStart }: { scaleStart: string }) {
  const { x, y, zoom } = useViewport();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  if (!scaleStart || !width || !height || zoom <= 0) return null;

  const left = -x / zoom;
  const right = (width - x) / zoom;
  const top = -y / zoom;
  const bottom = (height - y) / zoom;
  const step = axisStep(zoom);
  const first = Math.floor(left / DAY);
  const last = Math.ceil(right / DAY);
  const days: number[] = [];
  for (let day = Math.ceil(first / step) * step; day <= last; day += step) days.push(day);
  const today = dayIndexFrom(scaleStart, utcToday());
  if (today >= first && today <= last && !days.includes(today)) days.push(today);
  days.sort((a, b) => a - b);

  const labelOffset = 46 / zoom;
  return (
    <ViewportPortal>
      <div className="day-axis" style={{ height: bottom - top, transform: `translateY(${top}px)` }}>
        {days.map((day) => {
          const date = addCalendarDays(scaleStart, day);
          const todayLine = day === today;
          return (
            <div
              key={day}
              className={todayLine ? 'day-line today' : 'day-line'}
              style={{
                transform: `translateX(${day * DAY}px)`,
                width: (todayLine ? 2 : 1) / zoom,
              }}
            >
              <span
                className="day-label"
                style={{ top: labelOffset, transform: `scale(${1 / zoom})` }}
              >
                {todayLine ? `сегодня ${shortDate(date)}` : shortDate(date)}
              </span>
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}

function hasCycle(edges: { source: string; target: string }[]) {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    adj.set(edge.source, [...(adj.get(edge.source) ?? []), edge.target]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adj.get(id) ?? []) if (dfs(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...new Set(edges.flatMap((edge) => [edge.source, edge.target]))].some(dfs);
}

function datesOf(node: GraphNode) {
  if (!node.plannedStart || !node.plannedEnd) return '';
  return `${node.plannedStart}–${node.plannedEnd}`;
}

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const { goalId } = useParams();
  const [search] = useSearchParams();
  const focus = search.get('node');
  const { logout, user } = useAuth();
  const nav = useNavigate();
  const flow = useReactFlow();
  const [goalTitle, setGoalTitle] = useState('Схема');
  const [goalForm, setGoalForm] = useState({
    title: '',
    description: '',
    deadline: '',
    scaleStart: '',
  });
  const [version, setVersion] = useState(1);
  const [users, setUsers] = useState<User[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState('загрузка…');
  const [error, setError] = useState('');
  const [deadlineExceeded, setDeadlineExceeded] = useState(false);
  const [finishDate, setFinishDate] = useState<string | null>(null);
  const extra = useRef<Map<string, GraphNode>>(new Map());
  const saveTimer = useRef<number>(0);
  const versionRef = useRef(1);
  const editSeq = useRef(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const usersRef = useRef<User[]>([]);
  const focused = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const ignoreClearUntil = useRef(0);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  selectedRef.current = selected;

  const userMap = useMemo(() => new Map(users.map((item) => [item.id, item.name])), [users]);

  const applyGraph = useCallback((g: Graph, people: User[]) => {
    const names = new Map(people.map((item) => [item.id, item.name]));
    setVersion(g.version);
    versionRef.current = g.version;
    extra.current = new Map(g.nodes.map((node) => [node.id, node]));
    const criticalNodes = new Set(g.criticalNodeIds);
    const criticalEdges = new Set(g.criticalEdgeIds);
    ignoreClearUntil.current = Date.now() + 400;
    setNodes(
      g.nodes.map((node) => ({
        id: node.id,
        type: 'task',
        selected: node.id === selectedRef.current,
        position: { x: node.x, y: node.y },
        data: {
          title: node.title,
          type: node.type,
          assigneeName: node.assigneeId ? names.get(node.assigneeId) : undefined,
          estimateLabel:
            node.type === 'goal_anchor' ? '' : formatEstimate(node.estimateValue, node.estimateUnit),
          critical: node.type !== 'goal_anchor' && criticalNodes.has(node.id),
          status: node.status,
          progress: node.progress,
          dates: datesOf(node),
        },
      })),
    );
    setEdges(
      g.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label,
        className: criticalEdges.has(edge.id) ? 'critical-edge' : undefined,
        style: criticalEdges.has(edge.id)
          ? { stroke: '#d97706', strokeWidth: 2.5 }
          : undefined,
      })),
    );
    const analyzed = analyzeGraph(
      g.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        estimateValue: node.estimateValue,
        estimateUnit: node.estimateUnit,
        plannedStart: node.plannedStart,
      })),
      g.edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
      g.deadline,
    );
    setDeadlineExceeded(g.deadlineExceeded);
    setFinishDate(g.deadlineExceeded ? analyzed.finishDate : null);
  }, [setEdges, setNodes]);

  const load = useCallback(async (keepMessage = false) => {
    const [g, goal, list] = await Promise.all([
      api<Graph>(`/visual-paths/goals/${goalId}/graph`),
      api<Goal>(`/visual-paths/goals/${goalId}`),
      api<User[]>('/users'),
    ]);
    usersRef.current = list;
    setUsers(list);
    setGoalTitle(goal.title);
    setGoalForm({
      title: goal.title,
      description: goal.description ?? '',
      deadline: goal.deadline ?? '',
      scaleStart: goal.scaleStart ?? '',
    });
    applyGraph(g, list);
    if (!keepMessage) {
      setError('');
      setHint('сохранено');
    }
  }, [applyGraph, goalId]);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  useEffect(() => {
    if (focused.current || !focus || !nodes.some((node) => node.id === focus)) return;
    focused.current = true;
    flow.fitView({ nodes: [{ id: focus }], padding: 0.5, maxZoom: 1.2 });
  }, [flow, focus, nodes]);

  const persist = useCallback(async (seq: number) => {
    setHint('сохранение…');
    setError('');
    const body = {
      version: versionRef.current,
      nodes: nodesRef.current.map((node) => {
        const prev = extra.current.get(node.id);
        return {
          id: node.id,
          type: prev?.type ?? node.data.type,
          title: node.data.title,
          description: prev?.description ?? '',
          x: node.position.x,
          y: node.position.y,
          assigneeId: prev?.assigneeId ?? null,
          estimateValue: prev?.estimateValue ?? 1,
          estimateUnit: prev?.estimateUnit ?? 'day',
        };
      }),
      edges: edgesRef.current.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
      })),
    };
    try {
      const g = await api<Graph>(`/visual-paths/goals/${goalId}/graph`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      versionRef.current = g.version;
      setVersion(g.version);
      if (editSeq.current !== seq) {
        setHint('есть изменения');
        return true;
      }
      applyGraph(g, usersRef.current);
      setHint('сохранено');
      return true;
    } catch (err) {
      const message = errorMessage(err);
      const alertCode = (err as { alertCode?: string }).alertCode;
      setError(message);
      setHint(message);
      if (alertCode === 'GRAPH_VERSION_CONFLICT') {
        await load(true);
      }
      return false;
    }
  }, [applyGraph, goalId, load]);

  function scheduleSave() {
    const seq = ++editSeq.current;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(seq);
    }, 1000);
    setHint('есть изменения');
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = extra.current.get(connection.source!);
      const next = addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          label: formatEstimate(source?.estimateValue ?? 1, source?.estimateUnit ?? 'day'),
        },
        edges,
      );
      if (hasCycle(next.map((edge) => ({ source: edge.source, target: edge.target })))) {
        setError('Нельзя создать цикл в зависимостях');
        return;
      }
      setError('');
      setEdges(next);
      scheduleSave();
    },
    [edges, setEdges],
  );

  function addTask() {
    const id = crypto.randomUUID();
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width * 0.35,
          y: bounds.top + bounds.height * 0.45,
        })
      : { x: 0, y: 200 };
    const slot = nodes.filter((node) => node.data.type !== 'goal_anchor').length;
    const x = Math.round(center.x / DAY) * DAY - DAY * (slot % 4);
    const y = Math.round(center.y / 20) * 20 + 140 * Math.floor(slot / 4);
    const node: GraphNode = {
      id,
      type: 'task',
      title: 'Новая задача',
      description: '',
      x,
      y,
      plannedStart: null,
      plannedEnd: null,
      assigneeId: null,
      estimateValue: 1,
      estimateUnit: 'day',
      status: 'not_started',
      progress: null,
    };
    extra.current.set(id, node);
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'task',
        position: { x, y },
        data: {
          title: node.title,
          type: 'task',
          estimateLabel: '1д',
          status: 'not_started',
          progress: null,
        },
      },
    ]);
    scheduleSave();
  }

  const selectedNode = selected ? extra.current.get(selected) : undefined;

  function patchSelected(patch: Partial<GraphNode>) {
    if (!selected) return;
    const current = extra.current.get(selected);
    if (!current || current.type === 'goal_anchor') return;
    const next = { ...current, ...patch };
    extra.current.set(selected, next);
    setNodes((current) =>
      current.map((node) =>
        node.id !== selected
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                title: next.title,
                assigneeName: next.assigneeId ? userMap.get(next.assigneeId) : undefined,
                estimateLabel: formatEstimate(next.estimateValue, next.estimateUnit),
                status: next.status,
                progress: next.progress,
              },
            },
      ),
    );
    if (patch.estimateValue != null || patch.estimateUnit) {
      const label = formatEstimate(next.estimateValue, next.estimateUnit);
      setEdges((current) =>
        current.map((edge) => (edge.source === selected ? { ...edge, label } : edge)),
      );
    }
    scheduleSave();
  }

  async function changeManualStatus(status: string) {
    if (!selected || !selectedNode || selectedNode.progress !== null) return;
    try {
      await api(`/visual-paths/goals/${goalId}/nodes/${selected}/manual-status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const next = { ...selectedNode, status, progress: null };
      extra.current.set(selected, next);
      setNodes((current) =>
        current.map((node) =>
          node.id === selected
            ? { ...node, data: { ...node.data, status, progress: null } }
            : node,
        ),
      );
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function removeSelected() {
    if (!selected || selectedNode?.type === 'goal_anchor') return;
    if (!window.confirm('Удалить задачу?')) return;
    extra.current.delete(selected);
    setNodes((current) => current.filter((node) => node.id !== selected));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selected && edge.target !== selected),
    );
    setSelected(null);
    scheduleSave();
  }

  async function saveGoal() {
    const ok = await persist(editSeq.current);
    if (!ok) return;
    try {
      await api(`/visual-paths/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: goalForm.title,
          description: goalForm.description,
          deadline: goalForm.deadline || null,
          scaleStart: goalForm.scaleStart || undefined,
        }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <Link to="/goals">← Цели</Link>
          <strong style={{ marginLeft: 12 }}>{goalTitle}</strong>
        </div>
        <div>
          <span className="muted">{user?.name} · v{version}</span>{' '}
          <button className="btn ghost" onClick={logout}>Выйти</button>
        </div>
      </header>
      <div className="canvas-wrap">
        <div className="canvas-main">
          <div className="toolbar">
            <button className="btn" onClick={addTask}>+ Задача</button>
            <button className="btn secondary" onClick={() => void persist(editSeq.current)}>
              Сохранить
            </button>
          </div>
          <div className="save-hint">{hint}</div>
          {deadlineExceeded && finishDate && (
            <div className="deadline-banner">
              Расчётная дата финиша {finishDate} позже дедлайна.
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => scheduleSave()}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((change) => change.type === 'remove')) scheduleSave();
            }}
            onBeforeDelete={async ({ nodes: selectedNodes }) => {
              if (selectedNodes.some((node) => extra.current.get(node.id)?.type === 'goal_anchor')) {
                return false;
              }
              if (selectedNodes.length === 0) return true;
              return window.confirm('Удалить задачу?');
            }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selectedNodes }) => {
              const id = selectedNodes[0]?.id ?? null;
              if (!id && Date.now() < ignoreClearUntil.current) return;
              selectedRef.current = id;
              setSelected(id);
            }}
            onNodeDoubleClick={(_, node) => {
              if (extra.current.get(node.id)?.type === 'goal_anchor') {
                setSelected(node.id);
                return;
              }
              nav(`/goals/${goalId}/nodes/${node.id}/board`);
            }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[DAY, 20]}
            deleteKeyCode={['Delete', 'Backspace']}
          >
            {goalForm.scaleStart && <DayAxis scaleStart={goalForm.scaleStart} />}
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="panel">
          {selectedNode?.type === 'goal_anchor' ? (
            <>
              <strong>Свойства цели</strong>
              {error && <div className="error">{error}</div>}
              <label className="muted">Название</label>
              <input
                value={goalForm.title}
                onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })}
              />
              <label className="muted">Описание</label>
              <textarea
                value={goalForm.description}
                onChange={(event) => setGoalForm({ ...goalForm, description: event.target.value })}
              />
              <label className="muted">Начало шкалы</label>
              <input
                type="date"
                value={goalForm.scaleStart}
                onChange={(event) => setGoalForm({ ...goalForm, scaleStart: event.target.value })}
              />
              <label className="muted">Дедлайн</label>
              <input
                type="date"
                value={goalForm.deadline}
                onChange={(event) => setGoalForm({ ...goalForm, deadline: event.target.value })}
              />
              <button className="btn" onClick={() => void saveGoal()}>Сохранить свойства</button>
            </>
          ) : (
            <>
              <strong>Свойства задачи</strong>
              {error && <div className="error">{error}</div>}
              {!selectedNode && <p className="muted">Выберите узел. Двойной щелчок по задаче открывает доску.</p>}
              {selectedNode && (
                <>
                  <label className="muted">Название</label>
                  <input
                    value={selectedNode.title}
                    onChange={(event) => patchSelected({ title: event.target.value })}
                  />
                  <label className="muted">Ответственный</label>
                  <select
                    value={selectedNode.assigneeId ?? ''}
                    onChange={(event) => patchSelected({ assigneeId: event.target.value || null })}
                  >
                    <option value="">не назначен</option>
                    {users.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <label className="muted">Оценка</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      value={selectedNode.estimateValue}
                      onChange={(event) => patchSelected({ estimateValue: Number(event.target.value) })}
                    />
                    <select
                      value={selectedNode.estimateUnit}
                      onChange={(event) => patchSelected({ estimateUnit: event.target.value })}
                    >
                      <option value="hour">часы</option>
                      <option value="day">дни</option>
                      <option value="week">недели</option>
                    </select>
                  </div>
                  <p className="muted">
                    {selectedNode.plannedStart && selectedNode.plannedEnd
                      ? `${selectedNode.plannedStart}–${selectedNode.plannedEnd}`
                      : 'Даты появятся после сохранения'}
                  </p>
                  {selectedNode.progress === null && (
                    <>
                      <label className="muted">Статус</label>
                      <select
                        value={selectedNode.status}
                        onChange={(event) => void changeManualStatus(event.target.value)}
                      >
                        <option value="not_started">Не начата</option>
                        <option value="in_progress">В работе</option>
                        <option value="done">Готово</option>
                      </select>
                    </>
                  )}
                  <button className="btn danger" onClick={removeSelected}>Удалить задачу</button>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
