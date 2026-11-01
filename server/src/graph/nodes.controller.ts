import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { GraphService } from './graph.service';
import { ManualStatusDto, TakenDto } from './graph.dto';

@Controller('visual-paths/goals/:goalId/nodes')
export class NodesController {
  constructor(private readonly graph: GraphService) {}

  @Patch(':nodeId/manual-status')
  manual(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: ManualStatusDto,
  ) {
    return this.graph.setManualStatus(user, goalId, nodeId, dto.status);
  }

  @Patch(':nodeId/taken')
  taken(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: TakenDto,
  ) {
    return this.graph.setTaken(user, goalId, nodeId, dto.taken);
  }
}
