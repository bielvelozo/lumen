import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { signupRequestSchema, type SignupRequest } from '@lumen/shared';
import { Card, Button } from '../design-system/ui';
import { FormField } from '../forms/FormField';
import { useZodForm } from '../forms/useZodForm';
import { signup } from '../lib/api';
import { ApiError, asValidationBody } from '../lib/api-client';

export function SignupPage(): JSX.Element {
  const form = useZodForm<SignupRequest>(signupRequestSchema, {
    email: '',
    password: '',
    organizationName: '',
  });
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: () => setDone(true),
    onError: (error) => {
      const body = error instanceof ApiError ? asValidationBody(error.body) : null;
      if (body?.fields) form.setErrors(body.fields);
    },
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = form.validate();
    if (parsed) mutation.mutate(parsed);
  };

  if (done) {
    // Non-enumerating: identical confirmation whether or not the email already existed.
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Confira seu e-mail</h2>
        <p style={{ color: 'var(--c-text-2)' }}>
          Se o endereço for válido, enviamos um link para confirmar sua conta. Abra-o para continuar.
        </p>
        <Link to="/login">Voltar para o login</Link>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormField
          label="Nome da empresa"
          name="organizationName"
          value={form.values.organizationName ?? ''}
          error={form.errors.organizationName}
          onChange={(v) => form.setValue('organizationName', v)}
          autoComplete="organization"
        />
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
          autoComplete="new-password"
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Criando…' : 'Criar conta'}
        </Button>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-2)' }}>
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </form>
    </Card>
  );
}
