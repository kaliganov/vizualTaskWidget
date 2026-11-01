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
import { TaskNode, type TaskData } from '../components/TaskNode';
import { analyzeGraph, formatTrackedEstimate } from '../schedule';
import { widgetMode } from '../portal-auth';
import { buildChain, currentOf, mine, statusLabel } from '../process-view';

type User = { id: string; name: string; email: string; position: string };
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
  takenAt: string | null;
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
  deadline: string | null;
  deadlineExceeded: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
type Goal = {
  title: string;
  description: string;
  deadline: string | null;
  applicationNumber: string | null;
  dealTypeTitle: string;
  customerName: string;
  contractName: string;
  objectName: string;
  objectAddress: string;
  orderNotes: string;
};
type OrderDoc = { id: string; title: string; body: string };
type DocMark = 'collected' | 'waiting' | 'missing';

function documentRows(docs: OrderDoc[]) {
  const rows: { id: string; title: string; status: DocMark }[] = [];
  for (const doc of docs) {
    const lines = doc.body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      rows.push({ id: doc.id, title: doc.title, status: 'waiting' });
      continue;
    }
    lines.forEach((line, index) => {
      const split = line.indexOf(':');
      const title = (split >= 0 ? line.slice(0, split) : line).trim();
      const value = split >= 0 ? line.slice(split + 1).trim() : '';
      rows.push({
        id: `${doc.id}-${index}`,
        title: title || doc.title,
        status: value ? 'collected' : 'missing',
      });
    });
  }
  if (!rows.length) rows.push({ id: 'empty', title: 'Документы пока не указаны', status: 'waiting' });
  return rows;
}

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

function taskRowY(items: { type: string; y: number }[]) {
  const ys = items.filter((node) => node.type === 'task').map((node) => node.y).sort((a, b) => a - b);
  if (!ys.length) return 140;
  return ys[Math.floor(ys.length / 2)];
}

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
  const nav = useNavigate();
  const flow = useReactFlow();
  const [goalTitle, setGoalTitle] = useState('Схема');
  const [goalForm, setGoalForm] = useState({
    title: '',
    description: '',
    deadline: '',
  });
  const [order, setOrder] = useState<Goal | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);

  useEffect(() => {
    if (!processOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setProcessOpen(false);
    }
    function onDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.process-slot')) return;
      setProcessOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [processOpen]);
  const [docs, setDocs] = useState<OrderDoc[]>([]);
  const [docTitle, setDocTitle] = useState('');
  const [version, setVersion] = useState(1);
  const [users, setUsers] = useState<User[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState('загрузка…');
  const [error, setError] = useState('');
  const [deadlineExceeded, setDeadlineExceeded] = useState(false);
  const [finishDate, setFinishDate] = useState<string | null>(null);
  const [viewerKey, setViewerKey] = useState(() =>
    widgetMode ? 'admin' : sessionStorage.getItem('vp_viewer') || 'admin',
  );
  const [showAll, setShowAll] = useState(false);
  const [docMarks, setDocMarks] = useState<Record<string, DocMark>>({});
  const adminEdit = useRef(true);
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
    ignoreClearUntil.current = Date.now() + 400;
    setNodes(
      g.nodes.map((node) => ({
        id: node.id,
        type: 'task',
        selected: node.id === selectedRef.current,
        position: { x: node.x, y: node.type === 'goal_anchor' ? taskRowY(g.nodes) : node.y },
        ...nodeBox(
          node.type === 'goal_anchor' ? null : node.width,
          node.type === 'goal_anchor' ? null : node.height,
        ),
        data: {
          title: node.title,
          type: node.type,
          assigneeName: node.assigneeId ? names.get(node.assigneeId) : undefined,
          role: node.type === 'goal_anchor' ? '' : node.description,
          estimateLabel:
            node.type === 'goal_anchor' ? '' : formatTrackedEstimate(node.estimateValue, node.estimateUnit),
          status: node.status,
          taken: Boolean(node.takenAt),
          progress: node.progress,
          dates: datesOf(node),
          onResize: (width: number, height: number) => resizeLive.current(node.id, width, height),
          onResizeEnd: () => commitResize.current(),
        },
      })),
    );
    const estimateById = new Map(g.nodes.map((node) => [node.id, node]));
    setEdges(
      g.edges.map((edge) => {
        const source = estimateById.get(edge.sourceNodeId);
        const label = source
          ? formatTrackedEstimate(source.estimateValue, source.estimateUnit)
          : edge.label;
        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          label,
          style: { stroke: '#4A4A4A', strokeWidth: 1 },
        };
      }),
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
    const [g, goal, list, papers] = await Promise.all([
      api<Graph>(`/visual-paths/goals/${goalId}/graph`),
      api<Goal>(`/visual-paths/goals/${goalId}`),
      api<User[]>('/users'),
      api<OrderDoc[]>(`/visual-paths/goals/${goalId}/documents`).catch(() => []),
    ]);
    usersRef.current = list;
    setUsers(list);
    setGoalTitle(goal.title);
    setGoalForm({
      title: goal.title,
      description: goal.description ?? '',
      deadline: goal.deadline ?? '',
    });
    setOrder(goal);
    setDocs(papers);
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
    let cancelled = false;
    async function start() {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await load();
          return;
        } catch (err) {
          if (cancelled) return;
          const message = errorMessage(err);
          if (attempt === 7) {
            setError(message);
            setHint(message);
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
  }, [load]);

  useEffect(() => {
    setShowAll(false);
  }, [viewerKey]);

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
          estimateUnit: prev?.estimateUnit ?? 'hour',
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
    if (!adminEdit.current) return;
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
      if (!adminEdit.current) return;
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
          label: formatTrackedEstimate(source?.estimateValue ?? 1, source?.estimateUnit ?? 'hour'),
          style: { stroke: '#4A4A4A', strokeWidth: 1 },
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
      estimateUnit: 'hour',
      takenAt: null,
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
        estimateLabel: '1 ч',
        status: 'not_started',
        taken: false,
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
      takenAt: null,
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
        estimateLabel: formatTrackedEstimate(created.estimateValue, created.estimateUnit),
        status: created.status,
        taken: false,
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
                estimateLabel: formatTrackedEstimate(next.estimateValue, next.estimateUnit),
                status: next.status,
                progress: next.progress,
              },
            },
      ),
    );
    if (patch.estimateValue != null || patch.estimateUnit) {
      const label = formatTrackedEstimate(next.estimateValue, next.estimateUnit);
      setEdges((current) =>
        current.map((edge) => (edge.source === selected ? { ...edge, label } : edge)),
      );
    }
    scheduleSave();
  }

  async function takeTask(id: string, taken: boolean) {
    try {
      const saved = await api<{ takenAt: string | null }>(
        `/visual-paths/goals/${goalId}/nodes/${id}/taken`,
        { method: 'PATCH', body: JSON.stringify({ taken }) },
      );
      const prev = extra.current.get(id);
      if (prev) extra.current.set(id, { ...prev, takenAt: saved.takenAt });
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, taken } } : node,
        ),
      );
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
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
        }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const chain = useMemo(() => {
    const rows = nodes.map((node) => {
      const meta = extra.current.get(node.id);
      return {
        id: node.id,
        type: String(node.data.type ?? ''),
        title: String(node.data.title ?? ''),
        description: meta?.description ?? '',
        x: node.position.x,
        assigneeId: meta?.assigneeId ?? null,
        status: String(node.data.status ?? 'not_started'),
        takenAt: node.data.taken ? 'taken' : null,
      };
    });
    return buildChain(rows);
  }, [nodes]);
  const viewers = useMemo(() => {
    const options: { key: string; label: string; person: { id: string; position: string } | null }[] = [
      { key: 'admin', label: 'Администратор', person: null },
    ];
    const roles = new Set(chain.map((task) => task.role).filter(Boolean));
    for (const person of users) {
      const admin = /руковод/i.test(person.position) || person.email === 'founder@demo.local';
      if (admin) continue;
      options.push({
        key: person.id,
        label: `${person.name}${person.position ? ` · ${person.position}` : ''}`,
        person: { id: person.id, position: person.position },
      });
    }
    for (const role of roles) {
      const covered = users.some((person) => {
        const position = person.position.trim().toLowerCase();
        const name = role.toLowerCase();
        return position && (name.includes(position) || position.includes(name));
      });
      if (covered) continue;
      options.push({ key: `role:${role}`, label: role, person: { id: '', position: role } });
    }
    return options;
  }, [users, chain]);
  const viewer = viewers.find((item) => item.key === viewerKey) ?? viewers[0];
  const isAdmin = !viewer.person;
  adminEdit.current = isAdmin;
  const own = isAdmin || !viewer.person ? [] : chain.filter((task) => mine(task, viewer.person!));
  const ownsSelected = Boolean(selected && own.some((task) => task.id === selected));
  const showStatusOnly = !isAdmin && ownsSelected && selectedNode?.type === 'task' && selectedNode.progress === null;
  const current = currentOf(chain);
  const seeAll = isAdmin || showAll;
  const visibleNodes = seeAll
    ? nodes
    : nodes.filter((node) => node.data.type === 'goal_anchor' || own.some((task) => task.id === node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = seeAll ? edges : edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  return (
    <div className="page">
      <header className="topbar slim">
        <div className="top-cluster">
          <Link to="/goals">← Цели</Link>
          <strong>{goalTitle}</strong>
          {order ? (
            <button className="btn secondary" type="button" onClick={() => setOrderOpen(true)}>
              Заявка {order.applicationNumber || '—'}
            </button>
          ) : null}
          <div className="tool-slot process-slot">
            <button className="btn secondary" type="button" onClick={() => setProcessOpen((open) => !open)}>
              Сейчас: {current ? current.title : chain.length ? 'Процесс завершён' : 'Нет задач'}
            </button>
            {processOpen && current ? (
              <div className="card menu-pop process-pop">
                <div className="step-sheet">
                  <strong className="step-title">{current.title}</strong>
                  <p className="step-status">{statusLabel(current.status)}</p>
                  <div className="step-details">
                    <p className="muted">Что сделать</p>
                    {current.title === 'Сбор документов' ? (
                      <ul className="doc-step-list">
                        {documentRows(docs).map((row) => {
                          const mark = docMarks[row.id] ?? row.status;
                          return (
                            <li key={row.id} className="doc-step-row">
                              <span>{row.title}</span>
                              <select
                                aria-label={`Статус: ${row.title}`}
                                value={mark}
                                onChange={(event) => setDocMarks((prev) => ({ ...prev, [row.id]: event.target.value as DocMark }))}
                              >
                                <option value="collected">Собрано</option>
                                <option value="waiting">Ожидает</option>
                                <option value="missing">Не хватает</option>
                              </select>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p>{current.role || 'Сделать этот шаг по заявке.'}</p>
                    )}
                  </div>
                  <button className="btn" type="button" onClick={() => void takeTask(current.id, !current.taken)}>
                    {current.taken ? 'Не взял' : 'Взять в работу'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="process-row">
          {widgetMode ? null : (
            <>
              <label className="muted" htmlFor="viewer">Кто смотрит</label>
              <select
                id="viewer"
                value={viewer.key}
                onChange={(event) => {
                  setViewerKey(event.target.value);
                  sessionStorage.setItem('vp_viewer', event.target.value);
                }}
              >
                {viewers.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </>
          )}
          <span className="muted">v{version}</span>
        </div>
      </header>
      {order && orderOpen ? (
        <div className="dialog-back" onMouseDown={() => setOrderOpen(false)}>
          <div className="dialog card order-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <strong>Заявка {order.applicationNumber || '—'}</strong>
              <button className="btn ghost" type="button" onClick={() => setOrderOpen(false)}>Закрыть</button>
            </div>
            <section className="order-block">
              <h3>Откуда</h3>
              <ul>
                {[
                  ['Заказчик', order.customerName],
                  ['Вид сделки', order.dealTypeTitle],
                  ['Контракт', order.contractName],
                ].map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span>{value || '—'}</span>
                    <span className={value ? 'order-mark ok' : 'order-mark miss'}>{value ? 'Собрано' : 'Не хватает'}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="order-block">
              <h3>Куда</h3>
              <ul>
                {[
                  ['Объект', order.objectName],
                  ['Адрес', order.objectAddress],
                ].map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span>{value || '—'}</span>
                    <span className={value ? 'order-mark ok' : 'order-mark miss'}>{value ? 'Собрано' : 'Не хватает'}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="order-block">
              <h3>Документы</h3>
              <ul>
                {docs.length === 0 ? (
                  <li>
                    <span>Пока нет</span>
                    <span />
                    <span className="order-mark wait">Ожидает</span>
                  </li>
                ) : docs.map((doc) => (
                  <li key={doc.id}>
                    <span>{doc.title}</span>
                    <span />
                    <span className={doc.body.trim() ? 'order-mark ok' : 'order-mark wait'}>{doc.body.trim() ? 'Собрано' : 'Ожидает'}</span>
                  </li>
                ))}
              </ul>
            </section>
            <div className="order-foot">
              <form
                className="row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!docTitle.trim()) return;
                  void api(`/visual-paths/goals/${goalId}/documents`, {
                    method: 'POST',
                    body: JSON.stringify({ title: docTitle.trim(), body: '' }),
                  }).then(() => {
                    setDocTitle('');
                    return load(true);
                  });
                }}
              >
                <label className="muted" htmlFor="doc-title">Новый документ</label>
                <input id="doc-title" name="docTitle" value={docTitle} onChange={(event) => setDocTitle(event.target.value)} placeholder="Название документа" />
                <button className="btn" type="submit">Добавить</button>
              </form>
              <p className="muted">{order.orderNotes ? `Примечание: ${order.orderNotes}` : 'Примечание не задано'}</p>
            </div>
          </div>
        </div>
      ) : null}
      <div className="canvas-wrap">
        <div className="canvas-main">
          <div className="toolbar">
            {isAdmin ? (
              <>
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
              </>
            ) : (
              <button className="btn secondary" type="button" onClick={() => setShowAll((open) => !open)}>
                {showAll ? 'Мои задачи' : 'Показать всю схему'}
              </button>
            )}
          </div>
          <div className="save-hint">{hint}</div>
          {deadlineExceeded && finishDate && (
            <div className="deadline-banner">
              Расчётная дата финиша {finishDate} позже дедлайна.
            </div>
          )}
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodesDraggable={isAdmin}
            nodesConnectable={isAdmin}
            onNodesChange={onNodesChange}
            onNodeDragStop={(_, dragged) => {
              if (dragged.data?.type === 'goal_anchor') {
                const y = taskRowY(
                  nodesRef.current.map((node) => ({
                    type: String(node.data?.type ?? ''),
                    y: node.position.y,
                  })),
                );
                setNodes((current) =>
                  current.map((node) =>
                    node.id === dragged.id ? { ...node, position: { ...node.position, y } } : node,
                  ),
                );
              }
              scheduleSave();
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((change) => change.type === 'remove')) scheduleSave();
            }}
            onBeforeDelete={async ({ nodes: selectedNodes }) => {
              if (!isAdmin) return false;
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
            connectionLineStyle={{ stroke: '#4A4A4A', strokeWidth: 1 }}
            connectionRadius={28}
            fitView
            snapToGrid
            snapGrid={[DAY, 1]}
            deleteKeyCode={isAdmin ? ['Delete', 'Backspace'] : null}
          >
            <TaskLanes />
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="panel" hidden={!selectedNode || (!isAdmin && !showStatusOnly)}>
          {isAdmin && (
          <fieldset>
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
                  {isAdmin && selectedNode.progress === null && (
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
          </fieldset>
          )}
          {showStatusOnly && selectedNode && (
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
        </aside>
      </div>
    </div>
  );
}
