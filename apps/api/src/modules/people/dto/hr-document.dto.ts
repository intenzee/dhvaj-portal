import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  HR_DOCUMENT_KINDS,
  type HrDocumentKind,
  type UploadHrDocumentInput,
} from '@hsdg/contracts';

export class HrDocumentListQueryDto {
  @ApiPropertyOptional({ description: 'Include archived files.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  archived?: boolean;
}

export class UploadHrDocumentDto implements UploadHrDocumentInput {
  @ApiProperty({ enum: HR_DOCUMENT_KINDS })
  @IsIn(HR_DOCUMENT_KINDS)
  kind!: HrDocumentKind;

  @ApiProperty({ example: 'Appointment letter' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @ApiProperty({ description: 'Original file name.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional({ description: 'MIME type; defaults to application/octet-stream.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
