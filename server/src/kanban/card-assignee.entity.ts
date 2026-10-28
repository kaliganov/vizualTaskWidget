import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Card } from './card.entity';

@Entity('card_assignees')
export class CardAssignee {
  @PrimaryColumn()
  cardId: string;

  @PrimaryColumn()
  userId: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cardId' })
  card: Card;
}
