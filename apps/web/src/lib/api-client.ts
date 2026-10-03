/**
 * The single fetch wrapper every request goes through. It always sends the auth cookie
 * (`credentials: 'include'`) and JSON headers, reads the API base from `VITE_API_URL`, and
 * surfaces a non-2xx as an {@link ApiError}. It NEVER attaches an `org_id`/tenant id — the
 * server derives the tenant from the httpOnly JWT cookie (anti-IDOR); the client only ever
 * sends the explicit body it is given.
 */
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

/** Absolute URL for an API path — used by the streaming client (a raw fetch, not `apiFetch`). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`API request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildInit(options: ApiRequestOptions): RequestInit {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
  };
  // A JSON content-type with an empty body is rejected by the API's parser (400), so the
  // header travels only with an actual body.
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;
  return init;
}

// These answer 401 on their own merits (bad credentials, a spent refresh cookie); retrying
// them after a refresh would be meaningless, and refreshing `/auth/refresh` itself a loop.
const NO_REFRESH_PATHS = ['/auth/login', '/auth/logout', '/auth/refresh', '/auth/signup'];

/** Whether a 401 on this path is worth one refresh-and-retry. */
export function isRefreshable(path: string): boolean {
  return !NO_REFRESH_PATHS.some((p) => path === p || path.startsWith(p + '?'));
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Trade the refresh cookie for a fresh access cookie. Single-flight on purpose: the app fires
 * several requests at once and `/auth/refresh` ROTATES the refresh token, so parallel calls
 * would each present a token a sibling had already spent — logging the owner out instead of
 * renewing the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let response = await fetch(`${API_BASE}${path}`, buildInit(options));
  // The access token expires long before the session does; renew it once, transparently, and
  // let the 401 through only when the refresh cookie is gone too (then it IS a logged-out state).
  if (response.status === 401 && isRefreshable(path) && (await refreshSession())) {
    response = await fetch(`${API_BASE}${path}`, buildInit(options));
  }
  const data = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, data);
  }
  return data as T;
}

/** Field-level validation errors returned by the API's `400` envelope. */
export interface ApiValidationBody {
  error: 'ValidationError';
  fields?: Record<string, string>;
  formErrors?: string[];
}

/** Narrow an {@link ApiError} body to the validation envelope, if it is one. */
export function asValidationBody(body: unknown): ApiValidationBody | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body as { error?: unknown }).error === 'ValidationError'
  ) {
    return body as ApiValidationBody;
  }
  return null;
}
