import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { GraphService } from './graph.service';
import { ManualStatusDto } from './graph.dto';

@Controller('visual-paths/goals/:goalId/nodes')
@UseGuards(AuthGuard('jwt'))
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
}
