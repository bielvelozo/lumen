import { type InputHTMLAttributes } from 'react';

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  name: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

/**
 * An accessible, labeled input on a SOLID surface (never glass): real `<label>`,
 * `aria-invalid`/`aria-describedby` wiring, and an `role="alert"` error message. Reading
 * text and inputs stay off glass (glass-only-on-chrome).
 */
export function FormField({ label, name, value, error, onChange, ...rest }: FormFieldProps): JSX.Element {
  const errorId = `${name}-error`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="input"
        {...rest}
      />
      {error && (
        <span id={errorId} role="alert" style={{ color: 'var(--c-neg)', fontSize: 12.5 }}>
          {error}
        </span>
      )}
    </div>
  );
}
