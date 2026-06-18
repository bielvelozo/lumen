import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, Button } from '../design-system/ui';
import { FormField } from '../forms/FormField';
import { verifyEmail, resendVerification } from '../lib/api';

/**
 * Consumes the raw `?token=` from the email link exactly once (a query keyed by the token
 * dedupes the call — important because the token is single-use). The token is read from the
 * URL and sent; it is never stored. Renders pending / verified / invalid-or-expired (with a
 * resend affordance).
 */
export function VerifyEmailPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [resendEmail, setResendEmail] = useState('');

  const query = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => verifyEmail({ token }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const resend = useMutation({ mutationFn: resendVerification });

  if (!token) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Link inválido</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Este link de verificação está incompleto.</p>
        <Link to="/login">Ir para o login</Link>
      </Card>
    );
  }

  if (query.isPending) {
    return (
      <Card>
        <p aria-live="polite" style={{ margin: 0 }}>
          Verificando seu e-mail…
        </p>
      </Card>
    );
  }

  const status = query.data?.status;
  if (status === 'verified' || status === 'already_verified') {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>E-mail verificado</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Sua conta está confirmada. Agora você pode entrar.</p>
        <Link to="/login">Ir para o login</Link>
      </Card>
    );
  }

  // status === 'invalid' or the request errored → offer a resend.
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Link inválido ou expirado</h2>
      <p style={{ color: 'var(--c-text-2)' }}>
        Informe seu e-mail para receber um novo link de verificação.
      </p>
      {resend.isSuccess ? (
        <p role="status">Se o endereço precisar de verificação, enviamos um novo link.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField
            label="E-mail"
            name="resend-email"
            type="email"
            value={resendEmail}
            onChange={setResendEmail}
            autoComplete="email"
          />
          <Button
            type="button"
            disabled={resend.isPending}
            onClick={() => resend.mutate({ email: resendEmail })}
          >
            {resend.isPending ? 'Enviando…' : 'Reenviar link'}
          </Button>
        </div>
      )}
    </Card>
  );
}
