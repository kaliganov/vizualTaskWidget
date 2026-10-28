import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Goal } from '../goals/goal.entity';
import type { DurationUnit } from './graph-node.entity';
import { GraphNode } from './graph-node.entity';

@Entity('graph_edges')
export class GraphEdge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  goalId: string;

  @ManyToOne(() => Goal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goalId' })
  goal: Goal;

  @Column()
  sourceNodeId: string;

  @ManyToOne(() => GraphNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourceNodeId' })
  source: GraphNode;

  @Column()
  targetNodeId: string;

  @ManyToOne(() => GraphNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetNodeId' })
  target: GraphNode;

  @Column({ type: 'float' })
  durationValue: number;

  @Column({ type: 'varchar', default: 'day' })
  durationUnit: DurationUnit;

  @Column({ default: '' })
  label: string;
}
