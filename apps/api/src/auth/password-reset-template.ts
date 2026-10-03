import type { EmailMessage } from './email-sender';

/**
 * Build the password-reset email (subject + HTML + plain text). Portuguese-first, "Lumen"
 * identity, same shape as the verification email. The `link` already contains the raw token —
 * it is delivered here and must never be logged. The token portion is base64url (URL-safe),
 * so it needs no HTML escaping; the base URL comes from trusted env.
 */
export function buildPasswordResetEmail(to: string, link: string): EmailMessage {
  const subject = 'Redefinir sua senha — Lumen';

  const text = [
    'Recebemos um pedido para redefinir a senha da sua conta no Lumen.',
    '',
    'Escolha uma nova senha abrindo o link abaixo:',
    link,
    '',
    'O link expira em 1 hora e só pode ser usado uma vez.',
    'Se você não pediu isso, ignore esta mensagem — sua senha continua a mesma.',
  ].join('\n');

  const html = [
    '<div style="font-family: system-ui, sans-serif; line-height: 1.5;">',
    '  <h1 style="font-size: 20px;">Redefinir sua senha</h1>',
    '  <p>Recebemos um pedido para redefinir a senha da sua conta no Lumen.</p>',
    `  <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Escolher nova senha</a></p>`,
    '  <p style="color:#6b7280;font-size:13px;">O link expira em 1 hora e só pode ser usado uma vez. Se você não pediu isso, ignore esta mensagem — sua senha continua a mesma.</p>',
    `  <p style="color:#6b7280;font-size:13px;">Ou copie e cole este endereço no navegador:<br>${link}</p>`,
    '</div>',
  ].join('\n');

  return { to, subject, html, text };
}
