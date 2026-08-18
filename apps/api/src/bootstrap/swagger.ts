import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_VERSION } from '@hsdg/contracts';

/**
 * Mounts OpenAPI/Swagger at `/<globalPrefix>/docs` with the JSON spec at
 * `/<globalPrefix>/docs-json`. Bearer auth is pre-declared so that, once
 * authentication lands in Phase 1, protected endpoints document it without
 * further wiring.
 */
export function setupSwagger(app: INestApplication, globalPrefix: string): void {
  const config = new DocumentBuilder()
    .setTitle('HSDG Portal API')
    .setDescription(
      'Practice-management and professional-work operating system for HSDG. ' +
        'Modular monolith over PostgreSQL (system of record) with Row Level Security.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
    jsonDocumentUrl: `${globalPrefix}/docs-json`,
    swaggerOptions: { persistAuthorization: true },
  });
}
