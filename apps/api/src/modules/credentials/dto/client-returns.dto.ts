import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ClientReturnsQueryDto {
  @ApiPropertyOptional({ description: 'Only this client' })
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
