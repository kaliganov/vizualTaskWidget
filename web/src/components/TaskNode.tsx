import type { PointerEvent } from 'react';
import { Handle, Position, useNodeId, useStore, type NodeProps } from '@xyflow/react';

export type TaskData = {
  title: string;
  type: string;
  role?: string;
  assigneeName?: string;
  estimateLabel?: string;
  critical?: boolean;
  status?: string;
  progress?: number | null;
  dates?: string;
  onResize?: (width: number, height: number) => void;
  onResizeEnd?: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function TaskNode({ data, selected }: NodeProps) {
  const d = data as TaskData;
  const anchor = d.type === 'goal_anchor';
  const nodeId = useNodeId();
  const zoom = useStore((state) => state.transform[2]);
  const sized = useStore((state) => {
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    return node?.width != null && node?.height != null;
  });
  const statusClass = anchor ? '' : `status-${d.status || 'not_started'}`;

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    const host = event.currentTarget.closest('.react-flow__node');
    const disk = host?.querySelector('.disk');
    if (!(host instanceof HTMLElement) || !(disk instanceof HTMLElement) || !d.onResize) return;
    const role = host.querySelector('.role');
    const roleBlock = role instanceof HTMLElement ? role.offsetHeight + 6 : 0;
    const startW = disk.offsetWidth;
    const startH = disk.offsetHeight;
    const startX = event.clientX;
    const startY = event.clientY;
    const scale = zoom || 1;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      moved = true;
      if (anchor) {
        const size = clamp(Math.max(startW + dx, startH + dy), 64, 720);
        d.onResize?.(size, size);
        return;
      }
      d.onResize?.(
        clamp(startW + dx, 96, 720),
        clamp(startH + dy, 44, 480) + roleBlock,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) d.onResizeEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className={`task-node ${anchor ? 'anchor' : ''} ${sized ? 'sized' : ''} ${statusClass} ${d.critical ? 'critical' : ''}`}>
      {anchor ? <Handle type="target" position={Position.Left} isConnectableStart={false} className="port" /> : null}
      {!anchor && d.role ? <div className="role">{d.role}</div> : null}
      <div className="disk">
        {d.title}
        {anchor ? null : (
          <>
            <Handle type="target" position={Position.Left} isConnectableStart={false} className="port" />
            <Handle type="source" position={Position.Right} isConnectableEnd={false} className="port" />
          </>
        )}
      </div>
      {anchor ? <Handle type="source" position={Position.Right} isConnectableEnd={false} className="port" /> : null}
      {selected ? (
        <button
          type="button"
          className="node-resize nodrag nopan"
          aria-label="Размер"
          onPointerDown={startResize}
        />
      ) : null}
    </div>
  );
}
