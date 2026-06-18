import type { ConnectionErrorCategory } from '@lumen/shared';

/**
 * Map a raw mysql2/network error to a SAFE category (spec 08 hard rule). The raw error is
 * inspected ONLY here, in-process, to pick a category — its text (which may contain
 * hostnames, schema/table names, or data fragments) is NEVER returned, stored, or logged.
 */
export function mapMysqlError(error: unknown): ConnectionErrorCategory {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();

  // TLS/SSL problems first (some surface as generic codes with SSL text).
  if (code.includes('SSL') || code.includes('HANDSHAKE') || message.includes('ssl') || message.includes('certificate')) {
    return 'ssl_error';
  }

  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return 'auth_failed';
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
    case 'ER_COLUMNACCESS_DENIED_ERROR':
    case 'ER_SPECIFIC_ACCESS_DENIED_ERROR':
      return 'access_denied';
    case 'ER_BAD_DB_ERROR':
      return 'database_not_found';
    case 'ECONNREFUSED':
      return 'connection_refused';
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
    case 'PROTOCOL_CONNECTION_LOST':
      return 'timeout';
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EAI_AGAIN':
      return 'host_unreachable';
    default:
      break;
  }

  // mysql2 connect-timeout sometimes surfaces only in the message.
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  return 'unknown';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}
