/** Те же формулы §5 и §6, что на сервере: подпись оценки и дата финиша. */

export function formatEstimate(value: number, unit: string) {
  const suffix = unit === 'hour' ? 'ч' : unit === 'week' ? 'нед' : 'д';
  return `${value}${suffix}`;
}

function toDays(value: number, unit: string) {
  if (unit === 'hour') return value / 8;
  if (unit === 'day') return value;
  if (unit === 'week') return value * 7;
  return value;
}

export type PathNode = {
  id: string;
  type: string;
  estimateValue: number;
  estimateUnit: string;
  plannedStart: string | null;
};

export type PathEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
};

const EPS = 1e-9;

export function analyzeGraph(
  nodes: PathNode[],
  edges: PathEdge[],
  deadline: string | null,
): { finishDate: string | null; deadlineExceeded: boolean } {
  const anchor = nodes.find((node) => node.type === 'goal_anchor');
  if (!anchor) return { finishDate: null, deadlineExceeded: false };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, PathEdge[]>();
  const incoming = new Map<string, PathEdge[]>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) continue;
    outgoing.get(edge.sourceNodeId)!.push(edge);
    incoming.get(edge.targetNodeId)!.push(edge);
  }
  const reaches = new Set<string>([anchor.id]);
  const stack = [anchor.id];
  while (stack.length) {
    const id = stack.pop()!;
    for (const edge of incoming.get(id) ?? []) {
      if (reaches.has(edge.sourceNodeId)) continue;
      reaches.add(edge.sourceNodeId);
      stack.push(edge.sourceNodeId);
    }
  }
  const indegree = new Map<string, number>();
  for (const id of reaches) indegree.set(id, 0);
  for (const edge of edges) {
    if (!reaches.has(edge.sourceNodeId) || !reaches.has(edge.targetNodeId)) continue;
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) queue.push(id);
  const topo: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    topo.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!reaches.has(edge.targetNodeId)) continue;
      const next = (indegree.get(edge.targetNodeId) ?? 0) - 1;
      indegree.set(edge.targetNodeId, next);
      if (next === 0) queue.push(edge.targetNodeId);
    }
  }
  const weightOf = (sourceId: string) => {
    const node = byId.get(sourceId)!;
    return toDays(node.estimateValue, node.estimateUnit);
  };
  const longestFrom = new Map<string, number>();
  for (const id of reaches) longestFrom.set(id, 0);
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    if (id === anchor.id) continue;
    let best = 0;
    for (const edge of outgoing.get(id) ?? []) {
      if (!reaches.has(edge.targetNodeId)) continue;
      best = Math.max(best, weightOf(id) + (longestFrom.get(edge.targetNodeId) ?? 0));
    }
    longestFrom.set(id, best);
  }
  const longestTo = new Map<string, number>();
  for (const id of reaches) longestTo.set(id, 0);
  for (const id of topo) {
    for (const edge of outgoing.get(id) ?? []) {
      if (!reaches.has(edge.targetNodeId)) continue;
      const next = (longestTo.get(id) ?? 0) + weightOf(id);
      if (next > (longestTo.get(edge.targetNodeId) ?? 0)) longestTo.set(edge.targetNodeId, next);
    }
  }
  let length = 0;
  for (const id of reaches) {
    if (byId.get(id)!.type !== 'task') continue;
    length = Math.max(length, longestFrom.get(id) ?? 0);
  }
  if (length <= EPS) return { finishDate: null, deadlineExceeded: false };
  const critical = [...reaches].filter((id) => {
    const node = byId.get(id)!;
    if (node.type !== 'task') return false;
    const through = (longestTo.get(id) ?? 0) + (longestFrom.get(id) ?? 0);
    return Math.abs(through - length) < EPS;
  });
  const starts = critical
    .map((id) => byId.get(id)!.plannedStart)
    .filter((date): date is string => !!date);
  if (!deadline || starts.length !== critical.length || critical.length === 0) {
    return { finishDate: null, deadlineExceeded: false };
  }
  const start = [...starts].sort()[0];
  const [year, month, day] = start.split('-').map(Number);
  const finishDate = new Date(Date.UTC(year, month - 1, day) + length * 86400000)
    .toISOString()
    .slice(0, 10);
  return { finishDate, deadlineExceeded: finishDate > deadline };
}

/** Календарный сдвиг по UTC, как addCalendarDays на сервере. */
export function addCalendarDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

/** Сколько календарных дней от scaleStart до даты. */
export function dayIndexFrom(scaleStart: string, iso: string) {
  const [y1, m1, d1] = scaleStart.split('-').map(Number);
  const [y2, m2, d2] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function statusText(progress: number | null | undefined, status?: string) {
  if (progress === null || progress === undefined) {
    if (status === 'in_progress') return 'В работе';
    if (status === 'done') return 'Готово';
    return 'Не начата';
  }
  return `${progress}%`;
}
