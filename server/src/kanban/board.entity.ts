import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GraphNode } from '../graph/graph-node.entity';

@Entity('boards')
export class Board {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  nodeId: string;

  @OneToOne(() => GraphNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nodeId' })
  node: GraphNode;
}
