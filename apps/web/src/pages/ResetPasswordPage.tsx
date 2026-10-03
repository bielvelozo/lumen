import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { resetPasswordFormSchema, type ResetPasswordForm } from '@lumen/shared';
import { Card, Button } from '../design-system/ui';
import { FormField } from '../forms/FormField';
import { useZodForm } from '../forms/useZodForm';
import { resetPassword } from '../lib/api';

/**
 * Reset-password. Reads the raw `?token=` from the URL (never stored), collects a new
 * password validated against the SHARED password policy, and posts both. On success →
 * `/login`; an unusable link (unknown / expired / already spent) comes back as a 400 and
 * shows the "ask for a new link" message.
 */
export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useZodForm<ResetPasswordForm>(resetPasswordFormSchema, { password: '' });
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => setDone(true),
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = form.validate();
    if (parsed) mutation.mutate({ token, password: parsed.password });
  };

  if (!token) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Link inválido</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Este link de redefinição está incompleto.</p>
        <Link to="/forgot-password">Solicitar um novo link</Link>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Senha redefinida</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Sua senha foi atualizada. Agora você pode entrar.</p>
        <Link to="/login">Ir para o login</Link>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormField
          label="Nova senha"
          name="password"
          type="password"
          value={form.values.password ?? ''}
          error={form.errors.password}
          onChange={(v) => form.setValue('password', v)}
          autoComplete="new-password"
        />
        {mutation.isError && (
          <p role="alert" style={{ color: 'var(--c-neg)', fontSize: 13, margin: 0 }}>
            Não foi possível redefinir a senha. O link pode ter expirado.
          </p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Salvando…' : 'Redefinir senha'}
        </Button>
      </form>
    </Card>
  );
}
