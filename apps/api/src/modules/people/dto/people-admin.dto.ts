import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { DeactivateInput, DeletePersonInput, MoveWorkInput } from '@hsdg/contracts';

/** POST /people/admin/move-work. */
export class MoveWorkDto implements MoveWorkInput {
  @ApiProperty({ description: 'Whose open work moves.' })
  @IsUUID()
  fromEmployeeId!: string;

  @ApiProperty({ description: 'Who takes it.' })
  @IsUUID()
  toEmployeeId!: string;

  @ApiProperty({ description: 'Why — kept on every task’s assignment history.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** POST /people/employees/:id/deactivate. */
export class DeactivateDto implements DeactivateInput {
  @ApiPropertyOptional({ example: '2026-11-03', description: 'Exit date; today if left out.' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfExit?: string;

  @ApiPropertyOptional({ description: 'Why — kept on the audit entry only.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** DELETE /people/employees/:id. */
export class DeletePersonDto implements DeletePersonInput {
  @ApiProperty({ description: 'Their full name, typed to confirm.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  confirmName!: string;

  @ApiPropertyOptional({ description: 'Why — kept on the audit entry only.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
