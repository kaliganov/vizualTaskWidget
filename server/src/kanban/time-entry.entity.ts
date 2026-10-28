import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Card } from './card.entity';

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  cardId: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cardId' })
  card: Card;

  @Column()
  userId: string;

  @Column({ type: 'int' })
  minutes: number;

  @Column({ type: 'text', default: '' })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
