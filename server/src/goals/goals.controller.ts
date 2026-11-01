import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GoalsService } from './goals.service';
import { CreateGoalDto, UpdateGoalDto } from './goals.dto';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';

@Controller('visual-paths/goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('number') number?: string,
    @Query('status') status?: string,
    @Query('position') position?: string,
  ) {
    return this.goals.list(user, q, number, status, position);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGoalDto) {
    return this.goals.create(user, dto);
  }

  @Get(':goalId')
  get(@CurrentUser() user: AuthUser, @Param('goalId') goalId: string) {
    return this.goals.get(user, goalId);
  }

  @Patch(':goalId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.update(user, goalId, dto);
  }

  @Delete(':goalId')
  remove(@CurrentUser() user: AuthUser, @Param('goalId') goalId: string) {
    return this.goals.remove(user, goalId);
  }
}
