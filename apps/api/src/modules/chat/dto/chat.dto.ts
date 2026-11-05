import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CHAT_ATTACHMENT_KINDS,
  CHAT_MESSAGE_MAX,
  CHAT_VOICE_MAX_MS,
  type ChatAttachmentInput,
  type ChatAttachmentKind,
  type ChatDeliveredInput,
  type OpenChatInput,
  type SendChatMessageInput,
} from '@hsdg/contracts';

export class OpenChatDto implements OpenChatInput {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}

export class ChatAttachmentDto implements ChatAttachmentInput {
  @ApiProperty({ enum: CHAT_ATTACHMENT_KINDS })
  @IsIn(CHAT_ATTACHMENT_KINDS)
  kind!: ChatAttachmentKind;

  @ApiProperty({ example: 'Form 16.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contentType!: string;

  @ApiProperty({ description: 'The file, base64.' })
  @IsString()
  @IsNotEmpty()
  contentBase64!: string;

  @ApiPropertyOptional({ description: 'Voice notes: the length in ms.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAT_VOICE_MAX_MS)
  durationMs?: number;
}

export class SendChatMessageDto implements SendChatMessageInput {
  @ApiPropertyOptional({ maxLength: CHAT_MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_MESSAGE_MAX)
  body?: string;

  @ApiPropertyOptional({ type: ChatAttachmentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatAttachmentDto)
  attachment?: ChatAttachmentDto;

  @ApiPropertyOptional({ description: 'A uuid the sender makes, so a retry is not stored twice.' })
  @IsOptional()
  @IsUUID()
  clientRef?: string;
}

export class ChatDeliveredDto implements ChatDeliveredInput {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  messageIds!: string[];
}

export class ChatMessagesQueryDto {
  @ApiPropertyOptional({ description: 'Page back from this message.' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
