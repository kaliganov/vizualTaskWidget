import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('order_documents')
export class OrderDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @Column()
  goalId: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}
