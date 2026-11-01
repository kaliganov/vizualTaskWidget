import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphEdge } from '../graph/graph-edge.entity';
import { Goal } from './goal.entity';
import { GraphNode } from '../graph/graph-node.entity';
import { DealType } from './deal-type.entity';
import { OrderDocument } from './order-document.entity';
import { ProcessTemplate } from './process-template.entity';
import { DealTypesService } from './deal-types.service';
import { GoalsService } from './goals.service';
import { ProcessTemplatesService } from './process-templates.service';
import { GoalsController } from './goals.controller';
import { DealTypesController } from './deal-types.controller';
import { DocumentsController } from './documents.controller';
import { ProcessTemplatesController } from './process-templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Goal, GraphNode, GraphEdge, DealType, OrderDocument, ProcessTemplate])],
  providers: [GoalsService, DealTypesService, ProcessTemplatesService],
  controllers: [GoalsController, DealTypesController, DocumentsController, ProcessTemplatesController],
  exports: [GoalsService, DealTypesService],
})
export class GoalsModule {}
