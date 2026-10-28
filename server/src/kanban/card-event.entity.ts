import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CardEventType =
  | 'created'
  | 'updated'
  | 'moved'
  | 'comment_added'
  | 'comment_updated'
  | 'comment_deleted'
  | 'checklist_set'
  | 'time_logged'
  | 'timer_started'
  | 'timer_stopped'
  | 'deleted';

/** Без внешнего ключа на карточку: удаление карточки историю не стирает. */
@Entity('card_events')
@Index(['cardId', 'createdAt'])
export class CardEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  cardId: string;

  @Column()
  actorId: string;

  @Column()
  type: CardEventType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
