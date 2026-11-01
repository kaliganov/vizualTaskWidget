import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { GoalsService } from './goals.service';
import { ProcessTemplatesService } from './process-templates.service';

@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(
    private readonly templates: ProcessTemplatesService,
    private readonly goals: GoalsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: { title?: string }) {
    return this.goals.createProcessTemplate(user, body.title ?? '');
  }
}
