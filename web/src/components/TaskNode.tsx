import { Handle, Position, type NodeProps } from '@xyflow/react';

export type TaskData = {
  title: string;
  type: string;
  assigneeName?: string;
  estimateLabel?: string;
  critical?: boolean;
};

export function TaskNode({ data }: NodeProps) {
  const d = data as TaskData;
  return (
    <div className={`task-node ${d.type === 'goal_anchor' ? 'anchor' : ''} ${d.critical ? 'critical' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="disk">{d.title}</div>
      <div className="meta">
        {d.assigneeName || 'без ответственного'}
        {d.estimateLabel ? ` · ${d.estimateLabel}` : ''}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
