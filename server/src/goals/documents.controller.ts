import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { GoalsService } from './goals.service';

@Controller('visual-paths/goals/:goalId/documents')
export class DocumentsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('goalId') goalId: string) {
    return this.goals.listDocuments(user, goalId);
  }

  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Body('title') title: string,
    @Body('body') body: string,
  ) {
    return this.goals.addDocument(user, goalId, title ?? '', body ?? '');
  }

  @Delete(':documentId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('goalId') goalId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.goals.removeDocument(user, goalId, documentId);
  }
}
