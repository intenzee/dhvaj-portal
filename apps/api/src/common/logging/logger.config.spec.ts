import { loggableUrl } from './logger.config';

describe('loggableUrl', () => {
  it('masks the token in a client upload link', () => {
    expect(loggableUrl('/api/v1/client-upload/abc.DEF-123')).toBe(
      '/api/v1/client-upload/[redacted]',
    );
  });

  it('keeps query parameter names but never their values', () => {
    expect(loggableUrl('/api/v1/entities/lookup?pan=ABCDE1234F&legalName=Acme')).toBe(
      '/api/v1/entities/lookup?pan=[redacted]&legalName=[redacted]',
    );
    expect(loggableUrl('/api/v1/client-upload/tok?x=1')).toBe(
      '/api/v1/client-upload/[redacted]?x=[redacted]',
    );
  });

  it('leaves ordinary paths alone', () => {
    expect(loggableUrl('/api/v1/health/ready')).toBe('/api/v1/health/ready');
    expect(loggableUrl('/api/v1/health/ready?')).toBe('/api/v1/health/ready');
    expect(loggableUrl(undefined)).toBe('');
  });
});
