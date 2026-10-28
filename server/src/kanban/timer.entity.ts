import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Card } from './card.entity';

@Entity('timers')
@Unique(['cardId', 'userId'])
export class Timer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  cardId: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cardId' })
  card: Card;

  @Column()
  userId: string;

  @Column({ type: 'timestamptz' })
  startedAt: Date;
}
