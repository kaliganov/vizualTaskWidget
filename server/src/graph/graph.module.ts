import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from './graph-node.entity';
import { GraphEdge } from './graph-edge.entity';
import { Goal } from '../goals/goal.entity';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';
import { GoalsModule } from '../goals/goals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphNode, GraphEdge, Goal]),
    GoalsModule,
  ],
  providers: [GraphService],
  controllers: [GraphController],
})
export class GraphModule {}
