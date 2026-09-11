import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import {
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
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
}
