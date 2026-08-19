import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CLIENT_DEPENDENCY_STATUSES, type ClientDependencyStatus } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateClientDependencyDto {
  @ApiProperty({ description: 'What information is being requested from the client.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  requestedInfo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outstandingItems?: string;

  @ApiPropertyOptional({ description: 'HSDG employee chasing this dependency.' })
  @IsOptional()
  @IsUUID()
  responsibleEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsDateString()
  requestDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reminderDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  escalationDate?: string;
}

export class UpdateClientDependencyDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  outstandingItems?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  responsibleEmployeeId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  reminderDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  escalationDate?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ReceiveClientDependencyDto {
  @ApiProperty({ description: 'true = fully received; false = partially received.' })
  @IsBoolean()
  fully!: boolean;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ description: 'Remaining outstanding items (for a partial receipt).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outstandingItems?: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class CloseClientDependencyDto {
  @ApiProperty({ enum: ['waived', 'cancelled'] })
  @IsIn(['waived', 'cancelled'])
  status!: 'waived' | 'cancelled';

  @ApiProperty({ description: 'Why the dependency is being closed (audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ClientDependencyListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CLIENT_DEPENDENCY_STATUSES })
  @IsOptional()
  @IsIn(CLIENT_DEPENDENCY_STATUSES)
  status?: ClientDependencyStatus;

  @ApiPropertyOptional({ description: 'Only open (waiting-for-client) dependencies.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  openOnly?: boolean;
}

export class MyClientDependenciesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only dependencies past their escalation date.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;
}
