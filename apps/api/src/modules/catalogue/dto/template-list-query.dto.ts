import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { TEMPLATE_TYPES, type TemplateType } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Pagination + filters for GET /catalogue-templates (all params whitelisted). */
export class TemplateListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TEMPLATE_TYPES, description: 'Template type filter.' })
  @IsOptional()
  @IsIn(TEMPLATE_TYPES)
  templateType?: TemplateType;

  @ApiPropertyOptional({ description: 'Active flag filter.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Free-text search over name / code.' })
  @IsOptional()
  @IsString()
  search?: string;
}
