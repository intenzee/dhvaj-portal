import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { NoticeIntakeRequest } from '@hsdg/contracts';

/** POST /notices/intake. */
export class NoticeIntakeDto implements NoticeIntakeRequest {
  @ApiProperty({ description: 'An uploaded notice PDF (document_type notice).' })
  @IsUUID()
  documentId!: string;
}
