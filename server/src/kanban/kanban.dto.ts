import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CardPriority, ColumnKey } from './card.entity';

const COLUMNS: ColumnKey[] = ['todo', 'in_progress', 'testing', 'done'];
const PRIORITIES: CardPriority[] = ['low', 'medium', 'high', 'critical'];

export class CreateCardDto {
  @IsString({ message: 'Название карточки не может быть пустым' })
  title: string;
}

export class UpdateCardDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PRIORITIES, { message: 'Неизвестный приоритет' })
  priority?: CardPriority;

  @IsOptional()
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  assigneeIds?: string[];
}

export class MoveCardDto {
  @IsIn(COLUMNS, { message: 'Неизвестная колонка' })
  columnKey: ColumnKey;

  @IsInt()
  @Min(0)
  position: number;
}

export class ChecklistItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  text: string;

  @IsBoolean()
  done: boolean;
}

export class PutChecklistDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  items: ChecklistItemDto[];
}

export class CommentDto {
  @IsString({ message: 'Комментарий не может быть пустым' })
  text: string;
}

export class TimeEntryDto {
  @IsInt({ message: 'Минуты — целое число от 1' })
  @Min(1, { message: 'Минуты — целое число от 1' })
  minutes: number;

  @IsOptional()
  @IsString()
  note?: string;
}
