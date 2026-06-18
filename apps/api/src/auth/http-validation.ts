import type { ZodError } from 'zod';

/** Shape returned to the client on a request-validation failure (`400`). */
export interface ValidationErrorBody {
  error: 'ValidationError';
  /** First message per offending field. */
  fields: Record<string, string>;
  /** Non-field issues (e.g. unknown keys from a `.strict()` schema). */
  formErrors: string[];
}

/**
 * Flatten a {@link ZodError} into the API's standard `400` body — the first message per
 * field plus any form-level errors. Shared by the auth routes so the error shape is
 * consistent. Never includes the raw request values.
 */
export function validationErrorBody(error: ZodError): ValidationErrorBody {
  const flat = error.flatten();
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    const first = messages?.[0];
    if (first) fields[key] = first;
  }
  return { error: 'ValidationError', fields, formErrors: flat.formErrors };
}
