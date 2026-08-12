import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type ApiError } from '../api';
import { useAuth } from '../auth';
import { TaskNode, type TaskData } from '../components/TaskNode';

type User = { id: string; name: string };
type GraphNode = {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  assigneeId: string | null;
  estimateValue: number;
  estimateUnit: string;
  status: string;
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
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalPathNodeIds: string[];
};

const nodeTypes = { task: TaskNode };
const DAY = 48;

function labelOf(value: number, unit: string) {
  const u = unit === 'hour' ? 'ч' : unit === 'week' ? 'нед' : 'д';
  return `${value}${u}`;
}

function hasCycle(edges: { source: string; target: string }[]) {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (n: string): boolean => {
    if (visiting.has(n)) return true;
    if (visited.has(n)) return false;
    visiting.add(n);
    for (const m of adj.get(n) ?? []) if (dfs(m)) return true;
    visiting.delete(n);
    visited.add(n);
    return false;
  };
  return [...new Set(edges.flatMap((e) => [e.source, e.target]))].some(dfs);
}

export function CanvasPage() {
  const { goalId } = useParams();
  const { logout, user } = useAuth();
  const nav = useNavigate();
  const [goalTitle, setGoalTitle] = useState('Схема');
  const [version, setVersion] = useState(1);
  const [users, setUsers] = useState<User[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState('загрузка…');
  const [error, setError] = useState('');
  const extra = useRef<Map<string, GraphNode>>(new Map());
  const saveTimer = useRef<number>(0);
  const versionRef = useRef(1);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  async function load() {
    const [g, goal, list] = await Promise.all([
      api<Graph>(`/visual-paths/goals/${goalId}/graph`),
      api<{ title: string }>(`/visual-paths/goals/${goalId}`),
      api<User[]>('/users'),
    ]);
    setUsers(list);
    setGoalTitle(goal.title);
    setVersion(g.version);
    versionRef.current = g.version;
    extra.current = new Map(g.nodes.map((n) => [n.id, n]));
    const crit = new Set(g.criticalPathNodeIds);
    setNodes(
      g.nodes.map((n) => ({
        id: n.id,
        type: 'task',
        position: { x: n.x, y: n.y },
        data: {
          title: n.title,
          type: n.type,
          assigneeName: n.assigneeId ? list.find((u) => u.id === n.assigneeId)?.name : undefined,
          estimateLabel: n.type === 'goal_anchor' ? '' : labelOf(n.estimateValue, n.estimateUnit),
          critical: crit.has(n.id),
        },
      })),
    );
    setEdges(
      g.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.label || labelOf(e.durationValue, e.durationUnit),
        data: { durationValue: e.durationValue, durationUnit: e.durationUnit },
      })),
    );
    setHint('сохранено');
  }

  useEffect(() => {
    load().catch((e) => setError((e as ApiError).message || 'Ошибка загрузки'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const persist = useCallback(async () => {
    setHint('сохранение…');
    setError('');
    const body = {
      version: versionRef.current,
      nodes: nodesRef.current.map((n) => {
        const prev = extra.current.get(n.id);
        return {
          id: n.id,
          type: prev?.type ?? n.data.type,
          title: n.data.title,
          x: n.position.x,
          y: n.position.y,
          assigneeId: prev?.assigneeId ?? null,
          estimateValue: prev?.estimateValue ?? 1,
          estimateUnit: prev?.estimateUnit ?? 'day',
          status: prev?.status ?? 'not_started',
        };
      }),
      edges: edgesRef.current.map((e) => {
        const src = extra.current.get(e.source);
        const durationValue = (e.data?.durationValue as number) ?? src?.estimateValue ?? 1;
        const durationUnit = (e.data?.durationUnit as string) ?? src?.estimateUnit ?? 'day';
        return {
          id: e.id,
          sourceNodeId: e.source,
          targetNodeId: e.target,
          durationValue,
          durationUnit,
          label: String(e.label || labelOf(durationValue, durationUnit)),
        };
      }),
    };
    try {
      const g = await api<Graph>(`/visual-paths/goals/${goalId}/graph`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setVersion(g.version);
      versionRef.current = g.version;
      extra.current = new Map(g.nodes.map((n) => [n.id, n]));
      setHint('сохранено');
    } catch (err) {
      const e = err as ApiError;
      setError(e.message || 'Ошибка сохранения');
      setHint('ошибка');
      if (e.alertCode === 'GRAPH_VERSION_CONFLICT') {
        await load();
      }
    }
  }, [goalId]);

  function scheduleSave() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist();
    }, 900);
    setHint('есть изменения');
  }

  const onConnect = useCallback(
    (c: Connection) => {
      const next = addEdge(
        {
          ...c,
          id: crypto.randomUUID(),
          label: (() => {
            const src = extra.current.get(c.source!);
            return labelOf(src?.estimateValue ?? 1, src?.estimateUnit ?? 'day');
          })(),
          data: (() => {
            const src = extra.current.get(c.source!);
            return {
              durationValue: src?.estimateValue ?? 1,
              durationUnit: src?.estimateUnit ?? 'day',
            };
          })(),
        },
        edges,
      );
      if (hasCycle(next.map((e) => ({ source: e.source, target: e.target })))) {
        setError('Нельзя создать цикл в зависимостях');
        return;
      }
      setEdges(next);
      scheduleSave();
    },
    [edges, setEdges],
  );

  function addTask() {
    const id = crypto.randomUUID();
    const node: GraphNode = {
      id,
      type: 'task',
      title: 'Новая задача',
      x: 120 + nodes.length * 24,
      y: 160 + (nodes.length % 4) * 40,
      assigneeId: null,
      estimateValue: 3,
      estimateUnit: 'day',
      status: 'not_started',
    };
    extra.current.set(id, node);
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: 'task',
        position: { x: node.x, y: node.y },
        data: { title: node.title, type: 'task', estimateLabel: '3д' },
      },
    ]);
    scheduleSave();
  }

  const selectedNode = selected ? extra.current.get(selected) : undefined;
  const selectedFlow = nodes.find((n) => n.id === selected);

  function patchSelected(patch: Partial<GraphNode>) {
    if (!selected || !selectedNode) return;
    const next = { ...selectedNode, ...patch };
    extra.current.set(selected, next);
    setNodes((ns) =>
      ns.map((n) =>
        n.id !== selected
          ? n
          : {
              ...n,
              data: {
                ...n.data,
                title: next.title,
                assigneeName: next.assigneeId ? userMap.get(next.assigneeId) : undefined,
                estimateLabel:
                  next.type === 'goal_anchor' ? '' : labelOf(next.estimateValue, next.estimateUnit),
              },
            },
      ),
    );
    if (patch.estimateValue != null || patch.estimateUnit) {
      setEdges((es) =>
        es.map((e) =>
          e.source !== selected
            ? e
            : {
                ...e,
                label: labelOf(next.estimateValue, next.estimateUnit),
                data: { durationValue: next.estimateValue, durationUnit: next.estimateUnit },
              },
        ),
      );
    }
    scheduleSave();
  }

  function removeSelected() {
    if (!selected || selectedNode?.type === 'goal_anchor') return;
    extra.current.delete(selected);
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
    scheduleSave();
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
            <button className="btn secondary" onClick={() => void persist()}>Сохранить</button>
          </div>
          <div className="save-hint">{hint}</div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => scheduleSave()}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.some((x) => x.type === 'remove')) scheduleSave();
            }}
            onBeforeDelete={async ({ nodes: ns }) =>
              !ns.some((n) => extra.current.get(n.id)?.type === 'goal_anchor')
            }
            onConnect={onConnect}
            onSelectionChange={({ nodes: ns }) => setSelected(ns[0]?.id ?? null)}
            onNodeDoubleClick={(_, n) => {
              if (extra.current.get(n.id)?.type === 'goal_anchor') return;
              nav(`/goals/${goalId}/nodes/${n.id}/board`);
            }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[DAY / 2, 20]}
            deleteKeyCode={['Delete', 'Backspace']}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="panel">
          <strong>Свойства</strong>
          {error && <div className="error">{error}</div>}
          {!selectedFlow && <p className="muted">Выберите узел. Двойной клик — канбан.</p>}
          {selectedFlow && selectedNode && (
            <>
              <label className="muted">Название</label>
              <input
                value={selectedNode.title}
                onChange={(e) => patchSelected({ title: e.target.value })}
              />
              {selectedNode.type !== 'goal_anchor' && (
                <>
                  <label className="muted">Ответственный</label>
                  <select
                    value={selectedNode.assigneeId ?? ''}
                    onChange={(e) => patchSelected({ assigneeId: e.target.value || null })}
                  >
                    <option value="">— не назначен —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <label className="muted">Оценка времени</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      value={selectedNode.estimateValue}
                      onChange={(e) => patchSelected({ estimateValue: Number(e.target.value) })}
                    />
                    <select
                      value={selectedNode.estimateUnit}
                      onChange={(e) => patchSelected({ estimateUnit: e.target.value })}
                    >
                      <option value="hour">часы</option>
                      <option value="day">дни</option>
                      <option value="week">недели</option>
                    </select>
                  </div>
                  <p className="muted">На исходящей стрелке — время этой задачи.</p>
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
