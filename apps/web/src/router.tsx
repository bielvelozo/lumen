import { Routes, Route, Navigate } from 'react-router-dom';
import { PublicOnly, RequireAuth } from './routes/guards';
import { AuthLayout } from './routes/AuthLayout';
import { AppShell } from './routes/AppShell';
import { HomePage } from './routes/HomePage';
import { ConnectDatabasePage } from './routes/connect-db/ConnectDatabasePage';
import { ConnectAiPage } from './routes/connect-ai/ConnectAiPage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

/**
 * Two zones, both gated on the `me` query (the single bootstrap choke point):
 *  - PUBLIC (PublicOnly → AuthLayout): the auth pages; an authed visitor is bounced home.
 *  - PROTECTED (RequireAuth → AppShell): the glass shell + placeholder home; an
 *    unauthenticated visitor is redirected to `/login?from=…`.
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route element={<AuthLayout />}>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/connect/database" element={<ConnectDatabasePage />} />
          <Route path="/connect/ai" element={<ConnectAiPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
