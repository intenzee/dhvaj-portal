import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CLIENT_KINDS, CLIENT_STATUSES, type ClientKind, type ClientStatus } from '@hsdg/contracts';

export class CreateClientDto {
  @ApiProperty({ example: 'Shubham Group' })
  @IsString()
  @MaxLength(300)
  name!: string;

  @ApiPropertyOptional({ description: 'Internal short name.' })
  @IsOptional()
  @IsString()
  shortName?: string;

  @ApiPropertyOptional({ enum: CLIENT_KINDS, default: 'legal_entity' })
  @IsOptional()
  @IsIn(CLIENT_KINDS)
  clientKind?: ClientKind;

  @ApiProperty({ example: 'NORTH', description: 'Home office code.' })
  @IsString()
  officeCode!: string;

  @ApiPropertyOptional({ description: 'Owning group id (§2).' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ enum: CLIENT_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(CLIENT_STATUSES)
  status?: ClientStatus;
}
