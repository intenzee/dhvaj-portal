import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateNoteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional({ description: 'Scope the note to a service line (§27).' })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string | null;

  @ApiPropertyOptional({ description: 'Scope the note to a component (§28).' })
  @IsOptional()
  @IsUUID()
  engagementComponentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPinned?: boolean;
}

export class UpdateNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class NoteListQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a service line’s notes.' })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiPropertyOptional({ description: 'Filter to a component’s notes.' })
  @IsOptional()
  @IsUUID()
  engagementComponentId?: string;
}
