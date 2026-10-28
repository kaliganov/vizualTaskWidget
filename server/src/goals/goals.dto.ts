import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateGoalDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите название' })
  @MaxLength(200, { message: 'Название не длиннее 200 символов' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Дедлайн в формате ГГГГ-ММ-ДД' })
  deadline?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Начало шкалы в формате ГГГГ-ММ-ДД' })
  scaleStart?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Укажите название' })
  @MaxLength(200, { message: 'Название не длиннее 200 символов' })
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Дедлайн в формате ГГГГ-ММ-ДД' })
  deadline?: string | null;

  @IsOptional()
  @Matches(DATE, { message: 'Начало шкалы в формате ГГГГ-ММ-ДД' })
  scaleStart?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'completed', 'archived'], {
    message: 'Неизвестный статус цели',
  })
  status?: 'draft' | 'active' | 'completed' | 'archived';

  @IsOptional()
  @IsString()
  companyId?: string;
}
