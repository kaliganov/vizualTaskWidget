export function hasCycle(
  edges: { sourceNodeId: string; targetNodeId: string }[],
): boolean {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.sourceNodeId);
    nodes.add(e.targetNodeId);
    const list = adj.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    adj.set(e.sourceNodeId, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (n: string): boolean => {
    if (visiting.has(n)) return true;
    if (visited.has(n)) return false;
    visiting.add(n);
    for (const m of adj.get(n) ?? []) {
      if (dfs(m)) return true;
    }
    visiting.delete(n);
    visited.add(n);
    return false;
  };
  for (const n of nodes) {
    if (dfs(n)) return true;
  }
  return false;
}

export function toDays(value: number, unit: string): number {
  if (unit === 'hour') return value / 8;
  if (unit === 'week') return value * 7;
  return value;
}

export function criticalPathNodeIds(
  nodes: { id: string }[],
  edges: {
    sourceNodeId: string;
    targetNodeId: string;
    durationValue: number;
    durationUnit: string;
  }[],
): string[] {
  const ids = nodes.map((n) => n.id);
  const incoming = new Map<string, typeof edges>();
  for (const id of ids) incoming.set(id, []);
  for (const e of edges) {
    incoming.get(e.targetNodeId)?.push(e);
  }
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visiting = new Set<string>();
  const rec = (id: string): number => {
    if (dist.has(id)) return dist.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    let bestFrom: string | null = null;
    for (const e of incoming.get(id) ?? []) {
      const d = rec(e.sourceNodeId) + toDays(e.durationValue, e.durationUnit);
      if (d >= best) {
        best = d;
        bestFrom = e.sourceNodeId;
      }
    }
    visiting.delete(id);
    dist.set(id, best);
    prev.set(id, bestFrom);
    return best;
  };
  let end = ids[0];
  let max = -1;
  for (const id of ids) {
    const d = rec(id);
    if (d > max) {
      max = d;
      end = id;
    }
  }
  const path: string[] = [];
  let cur: string | null = end ?? null;
  while (cur) {
    path.push(cur);
    cur = prev.get(cur) ?? null;
  }
  return path.reverse();
}
