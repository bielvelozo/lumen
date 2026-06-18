import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginRequestSchema, type LoginRequest, type SessionResponse } from '@lumen/shared';
import { Card, Button } from '../design-system/ui';
import { FormField } from '../forms/FormField';
import { useZodForm } from '../forms/useZodForm';
import { login, resendVerification } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { ME_QUERY_KEY } from '../lib/query-client';
import { safeFrom } from '../routes/guards';

export function LoginPage(): JSX.Element {
  const form = useZodForm<LoginRequest>(loginRequestSchema, { email: '', password: '' });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (session: SessionResponse) => {
      // Seed the session so the guard admits immediately, then route to the deep link.
      queryClient.setQueryData(ME_QUERY_KEY, session);
      navigate(safeFrom(params.get('from')), { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setUnverified(true);
        setError('Seu e-mail ainda não foi verificado.');
        return;
      }
      // Wrong password or unknown email — one generic, non-enumerating message.
      setError('E-mail ou senha inválidos.');
    },
  });

  const resend = useMutation({ mutationFn: resendVerification });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    const parsed = form.validate();
    if (parsed) mutation.mutate(parsed);
  };

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
        <FormField
          label="Senha"
          name="password"
          type="password"
          value={form.values.password ?? ''}
          error={form.errors.password}
          onChange={(v) => form.setValue('password', v)}
          autoComplete="current-password"
        />
        {error && (
          <p role="alert" style={{ color: 'var(--c-neg)', fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}
        {unverified && (
          <Button
            type="button"
            variant="ghost"
            disabled={resend.isPending || resend.isSuccess}
            onClick={() => resend.mutate({ email: form.values.email ?? '' })}
          >
            {resend.isSuccess ? 'Link reenviado' : 'Reenviar link de verificação'}
          </Button>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Entrando…' : 'Entrar'}
        </Button>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-2)' }}>
          <Link to="/forgot-password">Esqueci minha senha</Link>
          {' · '}
          <Link to="/signup">Criar conta</Link>
        </p>
      </form>
    </Card>
  );
}
