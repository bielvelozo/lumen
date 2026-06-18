import { useCallback, useState } from 'react';
import type { ZodType } from 'zod';

export interface ZodForm<Output> {
  values: Record<string, string>;
  errors: Record<string, string>;
  setValue: (key: string, value: string) => void;
  /** Replace errors (e.g. mapping a server `400` field map onto inputs). */
  setErrors: (errors: Record<string, string>) => void;
  /** Validate `values` against the schema; returns parsed output or `null` (sets errors). */
  validate: () => Output | null;
}

/**
 * A tiny controlled-form hook. Client validation uses the SAME shared Zod schema the server
 * uses — it is UX only, never the security boundary; field-level server `400`s are mapped
 * back via {@link ZodForm.setErrors}.
 */
export function useZodForm<Output>(
  schema: ZodType<Output>,
  initial: Record<string, string>,
): ZodForm<Output> {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): Output | null => {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '_');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    setErrors(fieldErrors);
    return null;
  }, [schema, values]);

  return { values, errors, setValue, setErrors, validate };
}
