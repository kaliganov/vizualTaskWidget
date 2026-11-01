import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DealTypesService } from './deal-types.service';

@Controller('deal-types')
export class DealTypesController {
  constructor(private readonly types: DealTypesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.types.list(user.companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body('title') title: string) {
    return this.types.create(user, title ?? '');
  }
}
