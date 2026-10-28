import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Goal } from '../goals/goal.entity';
import { KanbanModule } from '../kanban/kanban.module';
import { User } from '../users/user.entity';
import { GraphController } from './graph.controller';
import { GraphEdge } from './graph-edge.entity';
import { GraphNode } from './graph-node.entity';
import { GraphService } from './graph.service';
import { NodesController } from './nodes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphNode, GraphEdge, Goal, User]),
    KanbanModule,
  ],
  providers: [GraphService],
  controllers: [GraphController, NodesController],
})
export class GraphModule {}
