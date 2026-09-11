import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { resendVerificationRequestSchema, type ResendVerificationRequest } from '@lumen/shared';
import { Card, Button } from '../design-system/ui';
import { FormField } from '../forms/FormField';
import { useZodForm } from '../forms/useZodForm';
import { forgotPassword } from '../lib/api';

/**
 * Forgot-password. Always renders the SAME "if an account exists, we sent a link" message
 * — for any email, existing or not (non-enumerating, matching the backend posture), which
 * is why it settles rather than branching on success.
 */
export function ForgotPasswordPage(): JSX.Element {
  // Reuses the `{ email }` shape/normalization of the resend contract.
  const form = useZodForm<ResendVerificationRequest>(resendVerificationRequestSchema, { email: '' });
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: forgotPassword,
    onSettled: () => setSent(true),
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = form.validate();
    if (parsed) mutation.mutate({ email: parsed.email });
  };

  if (sent) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Verifique seu e-mail</h2>
        <p style={{ color: 'var(--c-text-2)' }}>
          Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.
        </p>
        <Link to="/login">Voltar para o login</Link>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormField
          label="E-mail"
          name="email"
          type="email"
          value={form.values.email ?? ''}
          error={form.errors.email}
          onChange={(v) => form.setValue('email', v)}
          autoComplete="email"
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Enviando…' : 'Enviar link de redefinição'}
        </Button>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-2)' }}>
          <Link to="/login">Voltar para o login</Link>
        </p>
      </form>
    </Card>
  );
}
