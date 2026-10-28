import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Goal } from '../goals/goal.entity';
import { GraphNode } from '../graph/graph-node.entity';
import { User } from '../users/user.entity';
import { Board } from './board.entity';
import { CardAssignee } from './card-assignee.entity';
import { CardEvent } from './card-event.entity';
import { Card } from './card.entity';
import { ChecklistItem } from './checklist-item.entity';
import { Comment } from './comment.entity';
import { KanbanController } from './kanban.controller';
import { KanbanService } from './kanban.service';
import { TimeEntry } from './time-entry.entity';
import { Timer } from './timer.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Board,
      Card,
      CardAssignee,
      ChecklistItem,
      Comment,
      TimeEntry,
      Timer,
      CardEvent,
      GraphNode,
      Goal,
      User,
    ]),
  ],
  controllers: [KanbanController],
  providers: [KanbanService],
  exports: [KanbanService],
})
export class KanbanModule {}
