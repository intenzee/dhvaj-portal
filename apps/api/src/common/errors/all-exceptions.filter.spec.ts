import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { CORRELATION_ID_HEADER } from '../logging/logger.config';

function mockHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = {
    status,
    getHeader: () => 'corr-123',
  };
  const request = {
    url: '/api/v1/thing',
    method: 'GET',
    headers: { [CORRELATION_ID_HEADER]: 'corr-123' },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter (uniform error envelope)', () => {
  const filter = new AllExceptionsFilter();

  it('maps a business ForbiddenException to a 403 envelope with the correlation id', () => {
    const { host, status, json } = mockHost();

    filter.catch(new ForbiddenException('EP sign-off not permitted'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 403,
      error: 'FORBIDDEN',
      message: 'EP sign-off not permitted',
      path: '/api/v1/thing',
      correlationId: 'corr-123',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('flattens validation errors into details[]', () => {
    const { host, json } = mockHost();

    filter.catch(new BadRequestException(['name must not be empty', 'pan is invalid']), host);

    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual(['name must not be empty', 'pan is invalid']);
  });

  it('does NOT leak internals for unexpected errors (fail-closed)', () => {
    const { host, status, json } = mockHost();

    filter.catch(new Error('secret stack detail: db password xyz'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.error).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('secret stack detail');
  });
});
