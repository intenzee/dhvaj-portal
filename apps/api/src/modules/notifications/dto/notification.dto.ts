import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import {
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  type NotificationDelivery,
  type NotificationStatus,
  type NotificationType,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class NotificationListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: NotificationStatus;

  @ApiPropertyOptional({ description: 'Only unread notifications.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES, description: 'Filter by notification type.' })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

  @ApiPropertyOptional({
    enum: ['bell', 'all'],
    description:
      'WF-305: `bell` (the default once actionable notifications are on) leaves out what goes ' +
      'to the daily digest; `all` lists everything. A `type` filter always lists that type.',
  })
  @IsOptional()
  @IsIn(['bell', 'all'])
  scope?: 'bell' | 'all';
}

export class NotificationDigestQueryDto {
  @ApiPropertyOptional({ description: 'IST day, yyyy-mm-dd (default today).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: NOTIFICATION_TYPES })
  @IsIn(NOTIFICATION_TYPES)
  type!: NotificationType;

  @ApiProperty({ enum: NOTIFICATION_DELIVERIES })
  @IsIn(NOTIFICATION_DELIVERIES)
  delivery!: NotificationDelivery;
}

export class NotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  items!: NotificationPreferenceItemDto[];
}
