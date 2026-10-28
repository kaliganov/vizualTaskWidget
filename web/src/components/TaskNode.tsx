import { Handle, Position, type NodeProps } from '@xyflow/react';
import { statusText } from '../schedule';

export type TaskData = {
  title: string;
  type: string;
  assigneeName?: string;
  estimateLabel?: string;
  critical?: boolean;
  status?: string;
  progress?: number | null;
  dates?: string;
};

export function TaskNode({ data }: NodeProps) {
  const d = data as TaskData;
  const anchor = d.type === 'goal_anchor';
  const statusClass = anchor ? '' : `status-${d.status || 'not_started'}`;
  return (
    <div className={`task-node ${anchor ? 'anchor' : ''} ${statusClass} ${d.critical ? 'critical' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectableStart={false} />
      <div className="disk">{d.title}</div>
      {!anchor && (
        <>
          <div className="meta">
            {d.assigneeName || 'без ответственного'}
            {d.estimateLabel ? ` · ${d.estimateLabel}` : ''}
          </div>
          <div className="meta">{statusText(d.progress, d.status)}</div>
        </>
      )}
      {d.dates && <div className="meta">{d.dates}</div>}
      <Handle type="source" position={Position.Right} isConnectableEnd={false} />
    </div>
  );
}
