import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Board } from './board.entity';

export type ColumnKey = 'todo' | 'in_progress' | 'testing' | 'done';
export type CardPriority = 'low' | 'medium' | 'high' | 'critical';

@Entity('cards')
@Index(['boardId', 'columnKey', 'position'])
export class Card {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  boardId: string;

  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'boardId' })
  board: Board;

  @Column()
  columnKey: ColumnKey;

  @Column({ type: 'int' })
  position: number;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ default: 'medium' })
  priority: CardPriority;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;
}
