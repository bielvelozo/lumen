import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { renderRoutes } from '../test-utils';

interface MockReply {
  status: number;
  body: unknown;
}
type Handler = (url: string, init: RequestInit) => MockReply;

function mockApi(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const { status, body } = handler(String(url), init ?? {});
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function type(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignupPage', () => {
  it('submits valid input and shows the non-enumerating "check your email" state', async () => {
    mockApi(() => ({ status: 201, body: { message: 'ok' } }));
    renderRoutes({ initialEntries: ['/signup'], session: null });

    type('Nome da empresa', 'Acme');
    type('E-mail', 'owner@example.com');
    type('Senha', 'a-strong-pass-9');
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Confira seu e-mail')).toBeInTheDocument();
  });

  it('shows client validation errors and does not call the API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderRoutes({ initialEntries: ['/signup'], session: null });

    type('E-mail', 'not-an-email');
    type('Senha', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('LoginPage', () => {
  it('logs in and lands on the protected home', async () => {
    mockApi((url) => {
      if (url.includes('/auth/login')) {
        return {
          status: 200,
          body: { userId: 'u', orgId: 'o', email: 'owner@example.com' },
        };
      }
      return { status: 200, body: {} };
    });
    renderRoutes({ initialEntries: ['/login'], session: null });

    type('E-mail', 'owner@example.com');
    type('Senha', 'a-strong-pass-9');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Pergunte ao seu negócio')).toBeInTheDocument();
  });

  it('shows one generic error on invalid credentials (no enumeration)', async () => {
    mockApi(() => ({ status: 401, body: { error: 'InvalidCredentials' } }));
    renderRoutes({ initialEntries: ['/login'], session: null });

    type('E-mail', 'owner@example.com');
    type('Senha', 'wrong-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('E-mail ou senha inválidos.')).toBeInTheDocument();
  });

  it('offers a resend action when the account is unverified (403)', async () => {
    mockApi(() => ({ status: 403, body: { error: 'EmailNotVerified' } }));
    renderRoutes({ initialEntries: ['/login'], session: null });

    type('E-mail', 'owner@example.com');
    type('Senha', 'a-strong-pass-9');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(
      await screen.findByRole('button', { name: 'Reenviar link de verificação' }),
    ).toBeInTheDocument();
  });
});

describe('VerifyEmailPage', () => {
  it('consumes the token and shows verified', async () => {
    mockApi(() => ({ status: 200, body: { status: 'verified' } }));
    renderRoutes({ initialEntries: ['/verify-email?token=abc'], session: null });
    expect(await screen.findByText('E-mail verificado')).toBeInTheDocument();
  });

  it('shows invalid + a resend affordance for a bad/expired token', async () => {
    mockApi(() => ({ status: 200, body: { status: 'invalid' } }));
    renderRoutes({ initialEntries: ['/verify-email?token=bad'], session: null });
    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar link' })).toBeInTheDocument();
  });

  it('handles a missing token', async () => {
    renderRoutes({ initialEntries: ['/verify-email'], session: null });
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
  });
});

describe('ForgotPasswordPage', () => {
  it('always shows the uniform non-enumerating message', async () => {
    mockApi(() => ({ status: 200, body: { message: 'ok' } }));
    renderRoutes({ initialEntries: ['/forgot-password'], session: null });
    type('E-mail', 'owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de redefinição' }));
    expect(await screen.findByText('Verifique seu e-mail')).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('rejects a missing token', async () => {
    renderRoutes({ initialEntries: ['/reset-password'], session: null });
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
  });

  it('resets the password and points to login', async () => {
    mockApi(() => ({ status: 200, body: { ok: true } }));
    renderRoutes({ initialEntries: ['/reset-password?token=xyz'], session: null });
    type('Nova senha', 'a-strong-pass-9');
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(await screen.findByText('Senha redefinida')).toBeInTheDocument();
  });
});
