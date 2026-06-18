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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={name} style={{ fontSize: 13, color: 'var(--c-text-2)', fontWeight: 500 }}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        style={{
          padding: '9px 12px',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${error ? 'var(--c-neg)' : 'var(--c-border-strong)'}`,
          background: 'var(--c-surface)',
          color: 'var(--c-text)',
          font: 'inherit',
          fontSize: 'var(--text-base)',
          width: '100%',
        }}
        {...rest}
      />
      {error && (
        <span id={errorId} role="alert" style={{ color: 'var(--c-neg)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}
