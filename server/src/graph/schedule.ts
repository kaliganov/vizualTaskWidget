/** Формулы разделов 5 и 6: дни, даты узла, критический путь, дедлайн. */

export function toDays(value: number, unit: string): number {
  if (unit === 'hour') return value / 8;
  if (unit === 'day') return value;
  if (unit === 'week') return value * 7;
  throw new Error(`BAD_ESTIMATE:${unit}`);
}

export function formatEstimate(value: number, unit: string): string {
  const suffix = unit === 'hour' ? 'ч' : unit === 'week' ? 'нед' : 'д';
  return `${value}${suffix}`;
}

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function asDate(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function plannedDates(
  scaleStart: string,
  x: number,
  estimateValue: number,
  estimateUnit: string,
): { plannedStart: string; plannedEnd: string } {
  const dayIndex = Math.round(x / 48);
  const plannedStart = addCalendarDays(scaleStart, dayIndex);
  const offset = toDays(estimateValue, estimateUnit);
  const plannedEnd =
    offset === 0
      ? plannedStart
      : addCalendarDays(plannedStart, Math.ceil(offset));
  return { plannedStart, plannedEnd };
}

/** Полночь UTC даты старта плюс точная длина пути в миллисекундах. */
export function finishDateFrom(start: string, lengthDays: number): string {
  const [year, month, day] = start.slice(0, 10).split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, day);
  return new Date(midnight + lengthDays * 86400000).toISOString().slice(0, 10);
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

export type CriticalPath = {
  criticalNodeIds: string[];
  criticalEdgeIds: string[];
  criticalLengthDays: number;
  deadlineExceeded: boolean;
  finishDate: string | null;
};

const EPS = 1e-9;

/**
 * Вес ребра — оценка источника. Узлы, из которых якорь недостижим, не входят.
 * Подсветка — все задачи и рёбра хотя бы одного маршрута максимальной длины.
 * Якорь и длина 0 не красятся.
 */
export function analyzeGraph(
  nodes: PathNode[],
  edges: PathEdge[],
  deadline: string | null,
): CriticalPath {
  const empty: CriticalPath = {
    criticalNodeIds: [],
    criticalEdgeIds: [],
    criticalLengthDays: 0,
    deadlineExceeded: false,
    finishDate: null,
  };
  const anchor = nodes.find((node) => node.type === 'goal_anchor');
  if (!anchor) return empty;

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
    if (!reaches.has(edge.sourceNodeId) || !reaches.has(edge.targetNodeId)) {
      continue;
    }
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, degree] of indegree) {
    if (degree === 0) queue.push(id);
  }
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
    if (id === anchor.id) {
      longestFrom.set(id, 0);
      continue;
    }
    let best = 0;
    for (const edge of outgoing.get(id) ?? []) {
      if (!reaches.has(edge.targetNodeId)) continue;
      best = Math.max(
        best,
        weightOf(id) + (longestFrom.get(edge.targetNodeId) ?? 0),
      );
    }
    longestFrom.set(id, best);
  }

  const longestTo = new Map<string, number>();
  for (const id of reaches) longestTo.set(id, 0);
  for (const id of topo) {
    for (const edge of outgoing.get(id) ?? []) {
      if (!reaches.has(edge.targetNodeId)) continue;
      const next = (longestTo.get(id) ?? 0) + weightOf(id);
      if (next > (longestTo.get(edge.targetNodeId) ?? 0)) {
        longestTo.set(edge.targetNodeId, next);
      }
    }
  }

  let length = 0;
  for (const id of reaches) {
    if (byId.get(id)!.type !== 'task') continue;
    length = Math.max(length, longestFrom.get(id) ?? 0);
  }
  if (length <= EPS) return empty;

  const criticalNodeIds: string[] = [];
  for (const id of reaches) {
    const node = byId.get(id)!;
    if (node.type !== 'task') continue;
    const through = (longestTo.get(id) ?? 0) + (longestFrom.get(id) ?? 0);
    if (Math.abs(through - length) < EPS) criticalNodeIds.push(id);
  }
  criticalNodeIds.sort();

  const criticalEdgeIds: string[] = [];
  for (const edge of edges) {
    if (!reaches.has(edge.sourceNodeId) || !reaches.has(edge.targetNodeId)) {
      continue;
    }
    const through =
      (longestTo.get(edge.sourceNodeId) ?? 0) +
      weightOf(edge.sourceNodeId) +
      (longestFrom.get(edge.targetNodeId) ?? 0);
    if (Math.abs(through - length) < EPS) criticalEdgeIds.push(edge.id);
  }
  criticalEdgeIds.sort();

  const tasks = criticalNodeIds.map((id) => byId.get(id)!);
  const starts = tasks
    .map((task) => task.plannedStart)
    .filter((date): date is string => !!date);
  let deadlineExceeded = false;
  let finishDate: string | null = null;
  if (deadline && tasks.length > 0 && starts.length === tasks.length) {
    const start = [...starts].sort()[0];
    finishDate = finishDateFrom(start, length);
    deadlineExceeded = finishDate > deadline;
  }

  return {
    criticalNodeIds,
    criticalEdgeIds,
    criticalLengthDays: length,
    deadlineExceeded,
    finishDate,
  };
}
