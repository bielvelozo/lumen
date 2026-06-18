import type { EmailMessage } from './email-sender';

/**
 * Build the verification email (subject + HTML + plain text) for a given verify link.
 * Portuguese-first (the product audience is Brazilian SMB owners), "Lumen" identity. The
 * `link` already contains the raw token — it is delivered here and must never be logged.
 * The token portion of the link is base64url (URL-safe), so it needs no HTML escaping; the
 * base URL comes from trusted env.
 */
export function buildVerificationEmail(to: string, link: string): EmailMessage {
  const subject = 'Confirme seu e-mail — Lumen';

  const text = [
    'Bem-vindo ao Lumen!',
    '',
    'Confirme seu endereço de e-mail abrindo o link abaixo:',
    link,
    '',
    'O link expira em 24 horas. Se você não criou uma conta, ignore esta mensagem.',
  ].join('\n');

  const html = [
    '<div style="font-family: system-ui, sans-serif; line-height: 1.5;">',
    '  <h1 style="font-size: 20px;">Bem-vindo ao Lumen</h1>',
    '  <p>Confirme seu endereço de e-mail para ativar sua conta:</p>',
    `  <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Confirmar e-mail</a></p>`,
    '  <p style="color:#6b7280;font-size:13px;">O link expira em 24 horas. Se você não criou uma conta, ignore esta mensagem.</p>',
    `  <p style="color:#6b7280;font-size:13px;">Ou copie e cole este endereço no navegador:<br>${link}</p>`,
    '</div>',
  ].join('\n');

  return { to, subject, html, text };
}
