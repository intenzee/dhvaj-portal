import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { CLIENT_KINDS, CLIENT_STATUSES, type ClientKind, type ClientStatus } from '@hsdg/contracts';

/** All fields optional — a partial update. */
export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  shortName?: string | null;

  @ApiPropertyOptional({ enum: CLIENT_KINDS })
  @IsOptional()
  @IsIn(CLIENT_KINDS)
  clientKind?: ClientKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  groupId?: string | null;

  @ApiPropertyOptional({ enum: CLIENT_STATUSES })
  @IsOptional()
  @IsIn(CLIENT_STATUSES)
  status?: ClientStatus;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
