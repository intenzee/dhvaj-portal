import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module';
import { StorageModule } from '../documents/storage/storage.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Chat: WhatsApp-style direct messages between people in the firm. */
@Module({
  imports: [LiveModule, StorageModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
