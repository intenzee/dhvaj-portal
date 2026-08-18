import { ApiProperty } from '@nestjs/swagger';

/**
 * The single error envelope returned by every endpoint. A stable, documented
 * shape means clients (and the future web portal) handle failures uniformly.
 */
export class ErrorResponse {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    example: 'BAD_REQUEST',
    description: 'Stable, machine-readable error code (never localised).',
  })
  error!: string;

  @ApiProperty({
    example: 'Validation failed',
    description: 'Human-readable summary. Safe to surface to end users.',
  })
  message!: string;

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Field-level details, when applicable.',
  })
  details?: string[];

  @ApiProperty({ example: '/api/v1/health' })
  path!: string;

  @ApiProperty({ example: '2026-08-18T09:30:00.000Z' })
  timestamp!: string;

  @ApiProperty({
    example: 'a1b2c3d4-....',
    description: 'Correlation id — matches the x-correlation-id response header.',
  })
  correlationId!: string;
}
