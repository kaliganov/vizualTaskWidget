import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GoalStatus = 'draft' | 'active' | 'completed' | 'archived';

@Entity('goals')
export class Goal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'date', nullable: true })
  deadline: string | null;

  @Column({ type: 'date' })
  scaleStart: string;

  @Column({ default: 'active' })
  status: GoalStatus;

  @Column({ default: 'predecessor_duration' })
  edgeDurationMeans: string;

  @Column({ default: false })
  enforceDependencies: boolean;

  @Column({ default: 1 })
  graphVersion: number;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
