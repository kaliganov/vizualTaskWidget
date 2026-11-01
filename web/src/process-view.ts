export type ProcessTask = {
  id: string;
  title: string;
  role: string;
  assigneeId: string | null;
  status: string;
  taken: boolean;
};

export function statusLabel(status: string) {
  if (status === 'in_progress') return 'В работе';
  if (status === 'done') return 'Готово';
  return 'Не начата';
}

export function buildChain(
  nodes: {
    id: string;
    type: string;
    title: string;
    description: string;
    x: number;
    assigneeId: string | null;
    status: string;
    takenAt?: string | null;
  }[],
): ProcessTask[] {
  return nodes
    .filter((node) => node.type === 'task')
    .sort((a, b) => a.x - b.x)
    .map((node) => ({
      id: node.id,
      title: node.title,
      role: node.description.trim(),
      assigneeId: node.assigneeId,
      status: node.status,
      taken: Boolean(node.takenAt),
    }));
}

export function currentOf(tasks: ProcessTask[]) {
  return (
    tasks.find((task) => task.status === 'in_progress') ??
    tasks.find((task) => task.status !== 'done') ??
    null
  );
}

export function mine(
  task: ProcessTask,
  person: { id: string; position: string },
) {
  if (task.assigneeId && task.assigneeId === person.id) return true;
  const role = task.role.toLowerCase();
  const position = person.position.trim().toLowerCase();
  if (!role || !position) return false;
  return role.includes(position) || position.includes(role);
}
