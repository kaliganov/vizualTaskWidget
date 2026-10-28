import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Goal } from '../goals/goal.entity';

export type NodeType = 'task' | 'goal_anchor';
export type NodeStatus = 'not_started' | 'in_progress' | 'done';
export type DurationUnit = 'hour' | 'day' | 'week';

@Entity('graph_nodes')
export class GraphNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  goalId: string;

  @ManyToOne(() => Goal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goalId' })
  goal: Goal;

  @Column({ default: 'task' })
  type: NodeType;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'float' })
  x: number;

  @Column({ type: 'float' })
  y: number;

  @Column({ type: 'date', nullable: true })
  plannedStart: string | null;

  @Column({ type: 'date', nullable: true })
  plannedEnd: string | null;

  @Column({ default: 'not_started' })
  status: NodeStatus;

  /** Доля карточек в «Готово». null — карточек нет, статус ручной. */
  @Column({ type: 'int', nullable: true })
  progress: number | null;

  @Column({ type: 'float', default: 0 })
  progressCached: number;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ type: 'float', default: 1 })
  estimateValue: number;

  @Column({ default: 'day' })
  estimateUnit: DurationUnit;
}
