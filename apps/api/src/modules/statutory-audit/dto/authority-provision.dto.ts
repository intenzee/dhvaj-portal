import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { SupersedeAuthorityProvisionInput } from '@hsdg/contracts';

/** Supersede the current version of a provision (02.2 §20). */
export class SupersedeAuthorityProvisionDto implements SupersedeAuthorityProvisionInput {
  @ApiProperty({ example: '2025-04-01', description: 'First day the new version is in force.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Blank keeps the current number.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  provisionNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Blank keeps the current title.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  title?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Blank keeps the current summary.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  summary?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'https:// link; blank keeps the current one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^(https:\/\/.*)?$/, { message: 'The source link must start with https://' })
  sourceUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Citation, e.g. the amending notification.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  sourceReference?: string | null;

  @ApiProperty({ description: 'What changed and why — kept in the version history.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  changeNote!: string;
}
