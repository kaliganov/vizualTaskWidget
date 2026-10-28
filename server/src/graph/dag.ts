export function hasCycle(
  edges: { sourceNodeId: string; targetNodeId: string }[],
): boolean {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.sourceNodeId);
    nodes.add(edge.targetNodeId);
    const list = adj.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    adj.set(edge.sourceNodeId, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of nodes) {
    if (dfs(id)) return true;
  }
  return false;
}
