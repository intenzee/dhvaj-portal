import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PBC_STATUS, type PbcStatus } from '@hsdg/contracts';

/** Create a PBC master tracker item (§16). */
export class CreatePbcItemDto {
  @ApiProperty({ description: 'The information requested from the client.' })
  @IsString()
  @MaxLength(1000)
  requirement!: string;

  @ApiPropertyOptional({ description: 'Client-side owner, e.g. "Finance".' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientOwner?: string;

  @ApiPropertyOptional({ description: 'The work area this request supports (§16 LINKED WORK).' })
  @IsOptional()
  @IsUUID()
  workAreaId?: string;

  @ApiPropertyOptional({ enum: Object.values(PBC_STATUS) })
  @IsOptional()
  @IsIn(Object.values(PBC_STATUS))
  status?: PbcStatus;

  @ApiPropertyOptional({ description: 'Required when status is "rejected" (§16).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rejectionReason?: string;

  @ApiPropertyOptional({ description: 'When the request was issued (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  requestedDate?: string;

  @ApiPropertyOptional({ description: 'Agreed due date (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'When the client supplied the information (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ description: 'The received DHVAJ document on the same engagement.' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

/** Update a PBC item — all fields optional; version required (PATCH semantics). */
export class UpdatePbcItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requirement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientOwner?: string | null;

  @ApiPropertyOptional({ description: 'Work area id, or null to unlink.' })
  @IsOptional()
  @IsUUID()
  workAreaId?: string | null;

  @ApiPropertyOptional({ enum: Object.values(PBC_STATUS) })
  @IsOptional()
  @IsIn(Object.values(PBC_STATUS))
  status?: PbcStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rejectionReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  requestedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ description: 'Document id, or null to detach.' })
  @IsOptional()
  @IsUUID()
  documentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Transition a PBC item's status (§16). */
export class SetPbcStatusDto {
  @ApiProperty({ enum: Object.values(PBC_STATUS) })
  @IsIn(Object.values(PBC_STATUS))
  status!: PbcStatus;

  @ApiPropertyOptional({ description: 'Required when status is "rejected" (§16).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rejectionReason?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
