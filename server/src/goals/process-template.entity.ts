import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ProcessStep = {
  title: string;
  description: string;
};

@Entity('process_templates')
export class ProcessTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @Column()
  title: string;

  @Column({ type: 'jsonb', default: [] })
  steps: ProcessStep[];

  @Column({ type: 'uuid', nullable: true })
  goalId: string | null;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
