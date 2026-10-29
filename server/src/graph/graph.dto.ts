import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GraphNodeDto {
  @IsUUID()
  id: string;

  @IsString()
  type: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsOptional()
  @IsString()
  plannedStart?: string | null;

  @IsOptional()
  @IsString()
  plannedEnd?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsNumber()
  estimateValue?: number;

  @IsOptional()
  @IsString()
  estimateUnit?: string;

  @IsOptional()
  @IsNumber()
  @Min(32)
  @Max(2000)
  width?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(32)
  @Max(2000)
  height?: number | null;
}

export class GraphEdgeDto {
  @IsUUID()
  id: string;

  @IsUUID()
  sourceNodeId: string;

  @IsUUID()
  targetNodeId: string;

  @IsOptional()
  @IsNumber()
  durationValue?: number;

  @IsOptional()
  @IsString()
  durationUnit?: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class PutGraphDto {
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphNodeDto)
  nodes: GraphNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphEdgeDto)
  edges: GraphEdgeDto[];
}

export class ManualStatusDto {
  @IsIn(['not_started', 'in_progress', 'done'], {
    message: 'Неизвестный статус',
  })
  status: 'not_started' | 'in_progress' | 'done';
}
