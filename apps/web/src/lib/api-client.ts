/**
 * The single fetch wrapper every request goes through. It always sends the auth cookie
 * (`credentials: 'include'`) and JSON headers, reads the API base from `VITE_API_URL`, and
 * surfaces a non-2xx as an {@link ApiError}. It NEVER attaches an `org_id`/tenant id — the
 * server derives the tenant from the httpOnly JWT cookie (anti-IDOR); the client only ever
 * sends the explicit body it is given.
 */
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  const response = await fetch(`${API_BASE}${path}`, init);
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
