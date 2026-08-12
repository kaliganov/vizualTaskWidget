import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GraphService } from './graph.service';
import { PutGraphDto } from './graph.dto';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';

@Controller('visual-paths/goals/:goalId/graph')
@UseGuards(AuthGuard('jwt'))
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('goalId') goalId: string) {
    return this.graph.get(user, goalId);
  }

  @Put()
  put(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Body() dto: PutGraphDto,
  ) {
    return this.graph.put(user, goalId, dto);
  }
}
