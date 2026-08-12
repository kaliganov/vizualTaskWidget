import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class GraphNodeDto {
  @IsString()
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
}

export class GraphEdgeDto {
  @IsString()
  id: string;

  @IsString()
  sourceNodeId: string;

  @IsString()
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
  @IsNumber()
  version: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphNodeDto)
  nodes: GraphNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphEdgeDto)
  edges: GraphEdgeDto[];
}
