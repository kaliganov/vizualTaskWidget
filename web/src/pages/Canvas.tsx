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
  ViewportPortal,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { TaskNode, type TaskData } from '../components/TaskNode';
import { analyzeGraph, formatEstimate } from '../schedule';

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
  width: number | null;
  height: number | null;
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
const ROW_GAP = 80;
const PASTE_SHIFT = 192;

type TaskClip = {
  sourceId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  estimateValue: number;
  estimateUnit: string;
  status: string;
  width: number | null;
  height: number | null;
  x: number;
  y: number;
  pasted: number;
};

function nodeBox(width: number | null, height: number | null) {
  if (width == null || height == null) return {};
  return { width, height, style: { width, height } };
}

/** Полосы только если узлы стоят в разных рядах по вертикали. Один ряд — без полосы. */
function TaskLanes() {
  const flowNodes = useStore((state) => state.nodes);
  const lanes = useMemo(() => {
    const sorted = [...flowNodes].sort((a, b) => a.position.y - b.position.y);
    const groups: { y: number; minX: number; maxX: number; maxH: number; n: number }[] = [];
    for (const node of sorted) {
      const found = groups.find((lane) => Math.abs(node.position.y - lane.y) <= ROW_GAP);
      const right = node.position.x + (node.width ?? 170);
      const height = node.height ?? 90;
      if (!found) {
        groups.push({ y: node.position.y, minX: node.position.x, maxX: right, maxH: height, n: 1 });
        continue;
      }
      found.y = (found.y * found.n + node.position.y) / (found.n + 1);
      found.n += 1;
      found.minX = Math.min(found.minX, node.position.x);
      found.maxX = Math.max(found.maxX, right);
      found.maxH = Math.max(found.maxH, height);
    }
    return groups;
  }, [flowNodes]);
  if (lanes.length < 2) return null;
  return (
    <ViewportPortal>
      {lanes.map((lane, index) => (
        <div
          key={`${Math.round(lane.y)}-${index}`}
          className={`task-lane lane-${index % 5}`}
          style={{
            transform: `translate(${lane.minX - 28}px, ${lane.y - 28}px)`,
            width: Math.max(180, lane.maxX - lane.minX + 56),
            height: Math.max(118, lane.maxH + 28),
          }}
        />
      ))}
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
  const clipRef = useRef<TaskClip | null>(null);
  const copiedStatus = useRef(new Map<string, string>());
  const [clip, setClip] = useState<TaskClip | null>(null);
  const resizeLive = useRef<(id: string, width: number, height: number) => void>(() => {});
  const commitResize = useRef<() => void>(() => {});
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
        ...nodeBox(node.width, node.height),
        data: {
          title: node.title,
          type: node.type,
          assigneeName: node.assigneeId ? names.get(node.assigneeId) : undefined,
          role: node.type === 'goal_anchor' ? '' : node.description,
          estimateLabel:
            node.type === 'goal_anchor' ? '' : formatEstimate(node.estimateValue, node.estimateUnit),
          critical: node.type !== 'goal_anchor' && criticalNodes.has(node.id),
          status: node.status,
          progress: node.progress,
          dates: datesOf(node),
          onResize: (width: number, height: number) => resizeLive.current(node.id, width, height),
          onResizeEnd: () => commitResize.current(),
        },
      })),
    );
    setEdges(
      g.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label === '0д' || edge.label === '0ч' || edge.label === '0нед' ? undefined : edge.label,
        className: criticalEdges.has(edge.id) ? 'critical-edge' : undefined,
        style: criticalEdges.has(edge.id)
          ? { stroke: '#d97706', strokeWidth: 2.5 }
          : { stroke: '#16a34a', strokeWidth: 1.5 },
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
    window.setTimeout(() => {
      flow.fitView({ padding: 0.2, duration: 200 });
    }, 80);
    if (!keepMessage) {
      setError('');
      setHint('сохранено');
    }
  }, [applyGraph, flow, goalId]);

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
          width: prev?.width ?? null,
          height: prev?.height ?? null,
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
      await applyCopiedStatuses(g);
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

  async function applyCopiedStatuses(g: Graph) {
    for (const [id, status] of [...copiedStatus.current]) {
      if (status === 'not_started') {
        copiedStatus.current.delete(id);
        continue;
      }
      if (!g.nodes.some((node) => node.id === id)) {
        if (!nodesRef.current.some((node) => node.id === id)) copiedStatus.current.delete(id);
        continue;
      }
      try {
        await api(`/visual-paths/goals/${goalId}/nodes/${id}/manual-status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        const meta = extra.current.get(id);
        if (meta) extra.current.set(id, { ...meta, status, progress: null });
        setNodes((current) =>
          current.map((node) =>
            node.id === id ? { ...node, data: { ...node.data, status, progress: null } } : node,
          ),
        );
        copiedStatus.current.delete(id);
      } catch (err) {
        copiedStatus.current.delete(id);
        setError(errorMessage(err));
      }
    }
  }

  function scheduleSave() {
    const seq = ++editSeq.current;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(seq);
    }, 1000);
    setHint('есть изменения');
  }

  resizeLive.current = (id, width, height) => {
    const meta = extra.current.get(id);
    if (meta) extra.current.set(id, { ...meta, width, height });
    setNodes((current) =>
      current.map((node) =>
        node.id === id ? { ...node, width, height, style: { width, height } } : node,
      ),
    );
  };
  commitResize.current = () => scheduleSave();

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
        setError('Такая стрелка уже есть');
        return;
      }
      const source = extra.current.get(connection.source);
      const next = addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          label: formatEstimate(source?.estimateValue ?? 1, source?.estimateUnit ?? 'day'),
          style: { stroke: '#16a34a', strokeWidth: 1.5 },
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
    const flowNodes = nodesRef.current;
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width * 0.35,
          y: bounds.top + bounds.height * 0.45,
        })
      : { x: 0, y: 200 };
    let x = Math.round(center.x / DAY) * DAY;
    let y = Math.round(center.y / 20) * 20;
    for (let step = 0; step < 8; step += 1) {
      const busy = flowNodes.some(
        (node) => Math.abs(node.position.x - x) < DAY && Math.abs(node.position.y - y) < 40,
      );
      if (!busy) break;
      x += DAY;
    }

    const id = crypto.randomUUID();
    const created: GraphNode = {
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
      width: null,
      height: null,
    };

    extra.current.set(id, created);
    const nextNodes = flowNodes.map((item) => ({ ...item, selected: false }));
    nextNodes.push({
      id,
      type: 'task',
      selected: true,
      position: { x, y },
      data: {
        title: created.title,
        type: 'task',
        estimateLabel: '1д',
        status: 'not_started',
        progress: null,
        onResize: (width: number, height: number) => resizeLive.current(id, width, height),
        onResizeEnd: () => commitResize.current(),
      },
    });

    nodesRef.current = nextNodes;
    ignoreClearUntil.current = Date.now() + 400;
    selectedRef.current = id;
    setNodes(nextNodes);
    setSelected(id);
    setError('');
    scheduleSave();
  }

  function copyTask() {
    const id = selectedRef.current;
    const source = id ? extra.current.get(id) : undefined;
    if (!source || source.type !== 'task') {
      setError(source?.type === 'goal_anchor' ? 'Цель копировать нельзя' : 'Сначала выберите задачу');
      return false;
    }
    const node = nodesRef.current.find((item) => item.id === id);
    const next: TaskClip = {
      sourceId: source.id,
      title: source.title,
      description: source.description,
      assigneeId: source.assigneeId,
      estimateValue: source.estimateValue,
      estimateUnit: source.estimateUnit,
      status: source.status,
      width: source.width,
      height: source.height,
      x: node?.position.x ?? source.x,
      y: node?.position.y ?? source.y,
      pasted: 0,
    };
    clipRef.current = next;
    setClip(next);
    setError('');
    return true;
  }

  function pasteTask() {
    const copied = clipRef.current;
    if (!copied) {
      setError('Сначала скопируйте задачу');
      return false;
    }
    const index = copied.pasted + 1;
    let x = copied.x + PASTE_SHIFT * index;
    const y = copied.y;
    for (let step = 0; step < 12; step += 1) {
      const busy = nodesRef.current.some(
        (node) => Math.abs(node.position.x - x) < 80 && Math.abs(node.position.y - y) < 40,
      );
      if (!busy) break;
      x += PASTE_SHIFT;
    }

    const id = crypto.randomUUID();
    const created: GraphNode = {
      id,
      type: 'task',
      title: copied.title,
      description: copied.description,
      x,
      y,
      plannedStart: null,
      plannedEnd: null,
      assigneeId: copied.assigneeId,
      estimateValue: copied.estimateValue,
      estimateUnit: copied.estimateUnit,
      status: copied.status,
      progress: null,
      width: copied.width,
      height: copied.height,
    };
    extra.current.set(id, created);
    if (copied.status !== 'not_started') copiedStatus.current.set(id, copied.status);

    const nextNodes = nodesRef.current.map((item) => ({ ...item, selected: false }));
    nextNodes.push({
      id,
      type: 'task',
      selected: true,
      position: { x, y },
      ...nodeBox(created.width, created.height),
      data: {
        title: created.title,
        type: 'task',
        role: created.description,
        assigneeName: created.assigneeId ? userMap.get(created.assigneeId) : undefined,
        estimateLabel: formatEstimate(created.estimateValue, created.estimateUnit),
        status: created.status,
        progress: null,
        onResize: (width: number, height: number) => resizeLive.current(id, width, height),
        onResizeEnd: () => commitResize.current(),
      },
    });

    const nextClip = { ...copied, pasted: index };
    clipRef.current = nextClip;
    nodesRef.current = nextNodes;
    ignoreClearUntil.current = Date.now() + 400;
    selectedRef.current = id;
    setClip(nextClip);
    setNodes(nextNodes);
    setSelected(id);
    setError('');
    scheduleSave();
    return true;
  }

  const copyRef = useRef(copyTask);
  const pasteRef = useRef(pasteTask);
  copyRef.current = copyTask;
  pasteRef.current = pasteTask;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'c' && copyRef.current()) event.preventDefault();
      if (key === 'v' && pasteRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
                role: next.description,
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
            <button className="btn secondary" onClick={copyTask} disabled={!selectedNode || selectedNode.type !== 'task'}>
              Копировать
            </button>
            <button className="btn secondary" onClick={pasteTask} disabled={!clip}>
              Вставить
            </button>
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
            connectionLineStyle={{ stroke: '#16a34a', strokeWidth: 2 }}
            connectionRadius={28}
            fitView
            snapToGrid
            snapGrid={[DAY, 140]}
            deleteKeyCode={['Delete', 'Backspace']}
          >
            <TaskLanes />
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
                  <label className="muted">Роль</label>
                  <input
                    value={selectedNode.description}
                    onChange={(event) => patchSelected({ description: event.target.value })}
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
