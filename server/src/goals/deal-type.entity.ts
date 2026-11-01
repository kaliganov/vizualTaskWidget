import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('deal_types')
export class DealType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @Column()
  title: string;

  @Column({ default: 0 })
  sort: number;
}
