import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ChatConversation,
  ChatMessage,
  ChatMessagesPage,
  ChatPerson,
  ChatUnread,
} from '@hsdg/contracts';
import { CurrentPrincipal } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ChatService } from './chat.service';
import {
  ChatDeliveredDto,
  ChatMessagesQueryDto,
  OpenChatDto,
  SendChatMessageDto,
} from './dto/chat.dto';

/**
 * Chat: direct messages between two people in the firm. Anyone signed in with
 * an employee record; Row Level Security keeps each chat to its two people.
 */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('people')
  @ApiOperation({ summary: 'Who you can message, with online / last seen' })
  people(@CurrentPrincipal() p: Principal): Promise<ChatPerson[]> {
    return this.chat.people(rlsContextFromPrincipal(p));
  }

  @Get('unread')
  @ApiOperation({ summary: 'Unread messages, for the sidebar badge' })
  unread(@CurrentPrincipal() p: Principal): Promise<ChatUnread> {
    return this.chat.unread(rlsContextFromPrincipal(p));
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Your chats, newest first' })
  conversations(@CurrentPrincipal() p: Principal): Promise<ChatConversation[]> {
    return this.chat.conversations(rlsContextFromPrincipal(p));
  }

  @Post('conversations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open the chat with someone (or the one already open)' })
  open(@CurrentPrincipal() p: Principal, @Body() dto: OpenChatDto): Promise<ChatConversation> {
    return this.chat.open(rlsContextFromPrincipal(p), dto.employeeId);
  }

  @Get('conversations/:id')
  conversation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ChatConversation> {
    return this.chat.conversation(rlsContextFromPrincipal(p), id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'A page of messages, oldest first' })
  messages(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: ChatMessagesQueryDto,
  ): Promise<ChatMessagesPage> {
    return this.chat.messages(rlsContextFromPrincipal(p), id, q.before, q.limit);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send text, a photo, a voice note or a document' })
  send(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatMessage> {
    return this.chat.send(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'You read everything in the chat (blue ticks for the sender)' })
  read(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ read: number }> {
    return this.chat.read(rlsContextFromPrincipal(p), id);
  }

  @Post('conversations/:id/typing')
  @HttpCode(204)
  @ApiOperation({ summary: 'You are typing (a live event to the other person)' })
  typing(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.chat.typing(rlsContextFromPrincipal(p), id);
  }

  @Post('delivered')
  @HttpCode(200)
  @ApiOperation({ summary: 'Your portal received these messages (two grey ticks)' })
  delivered(
    @CurrentPrincipal() p: Principal,
    @Body() dto: ChatDeliveredDto,
  ): Promise<{ delivered: number }> {
    return this.chat.delivered(rlsContextFromPrincipal(p), dto.messageIds);
  }

  @Get('messages/:id/file')
  @ApiOperation({
    summary: 'An attachment (photos and voice notes inline, documents as a download)',
  })
  async file(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    const f = await this.chat.file(rlsContextFromPrincipal(p), id);
    const safe = f.fileName.replace(/["\r\n]/g, '_');
    return new StreamableFile(f.buffer, {
      type: f.contentType,
      disposition: `${f.kind === 'document' ? 'attachment' : 'inline'}; filename="${safe}"`,
      length: f.sizeBytes,
    });
  }
}
