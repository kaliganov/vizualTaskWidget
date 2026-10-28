import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import {
  CommentDto,
  CreateCardDto,
  MoveCardDto,
  PutChecklistDto,
  TimeEntryDto,
  UpdateCardDto,
} from './kanban.dto';
import { KanbanService } from './kanban.service';

@Controller('visual-paths')
@UseGuards(AuthGuard('jwt'))
export class KanbanController {
  constructor(private readonly kanban: KanbanService) {}

  @Get('nodes/:nodeId/board')
  board(@CurrentUser() user: AuthUser, @Param('nodeId') nodeId: string) {
    return this.kanban.getBoard(user, nodeId);
  }

  @Post('nodes/:nodeId/cards')
  createCard(
    @CurrentUser() user: AuthUser,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateCardDto,
  ) {
    return this.kanban.createCard(user, nodeId, dto);
  }

  @Get('cards/:cardId')
  card(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    return this.kanban.getCard(user, cardId);
  }

  @Patch('cards/:cardId')
  updateCard(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() dto: UpdateCardDto,
  ) {
    return this.kanban.updateCard(user, cardId, dto);
  }

  @Post('cards/:cardId/move')
  move(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() dto: MoveCardDto,
  ) {
    return this.kanban.moveCard(user, cardId, dto);
  }

  @Delete('cards/:cardId')
  remove(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    return this.kanban.deleteCard(user, cardId);
  }

  @Put('cards/:cardId/checklist')
  checklist(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() dto: PutChecklistDto,
  ) {
    return this.kanban.setChecklist(user, cardId, dto);
  }

  @Post('cards/:cardId/comments')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() dto: CommentDto,
  ) {
    return this.kanban.addComment(user, cardId, dto.text);
  }

  @Patch('cards/:cardId/comments/:commentId')
  updateComment(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Param('commentId') commentId: string,
    @Body() dto: CommentDto,
  ) {
    return this.kanban.updateComment(user, cardId, commentId, dto.text);
  }

  @Delete('cards/:cardId/comments/:commentId')
  deleteComment(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.kanban.deleteComment(user, cardId, commentId);
  }

  @Post('cards/:cardId/time-entries')
  time(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() dto: TimeEntryDto,
  ) {
    return this.kanban.addTime(user, cardId, dto);
  }

  @Post('cards/:cardId/timer/start')
  startTimer(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    return this.kanban.startTimer(user, cardId);
  }

  @Post('cards/:cardId/timer/stop')
  stopTimer(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    return this.kanban.stopTimer(user, cardId);
  }

  @Get('cards/:cardId/history')
  history(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    return this.kanban.history(user, cardId);
  }
}
