import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Add an additional service line to a multi-service engagement (§9–§10). */
export class AddServiceDto {
  @ApiProperty({ description: 'Service id (from the catalogue) to add to the engagement.' })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    description: 'Servicing office code for this service (defaults to the engagement’s office).',
  })
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ description: 'Per-service lead employee id.' })
  @IsOptional()
  @IsUUID()
  leadEmployeeId?: string;
}
