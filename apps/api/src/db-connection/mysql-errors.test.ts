import { describe, it, expect } from 'vitest';
import { mapMysqlError } from './mysql-errors';

describe('mapMysqlError', () => {
  it.each([
    ['ER_ACCESS_DENIED_ERROR', 'auth_failed'],
    ['ER_NOT_SUPPORTED_AUTH_MODE', 'auth_failed'],
    ['ER_DBACCESS_DENIED_ERROR', 'access_denied'],
    ['ER_TABLEACCESS_DENIED_ERROR', 'access_denied'],
    ['ER_BAD_DB_ERROR', 'database_not_found'],
    ['ECONNREFUSED', 'connection_refused'],
    ['ETIMEDOUT', 'timeout'],
    ['PROTOCOL_SEQUENCE_TIMEOUT', 'timeout'],
    ['ENOTFOUND', 'host_unreachable'],
    ['EHOSTUNREACH', 'host_unreachable'],
  ] as const)('%s -> %s', (code, category) => {
    expect(mapMysqlError({ code })).toBe(category);
  });

  it('maps SSL/handshake failures to ssl_error', () => {
    expect(mapMysqlError({ code: 'HANDSHAKE_SSL_ERROR' })).toBe('ssl_error');
    expect(mapMysqlError(new Error('unable to verify the first certificate'))).toBe('ssl_error');
  });

  it('falls back to timeout on a timeout message, else unknown', () => {
    expect(mapMysqlError(new Error('connect ETIMEDOUT: timed out'))).toBe('timeout');
    expect(mapMysqlError(new Error('something weird'))).toBe('unknown');
    expect(mapMysqlError(undefined)).toBe('unknown');
  });

  it('NEVER returns the raw error text (only a category)', () => {
    const category = mapMysqlError(new Error("Access denied for user 'root'@'10.0.0.5' to db 'secrets'"));
    expect(category).not.toContain('root');
    expect(category).not.toContain('secrets');
  });
});
