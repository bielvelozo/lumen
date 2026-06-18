import { Link } from 'react-router-dom';
import type { ChatErrorCode } from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';

/**
 * Gating CTA — shown (instead of a doomed input) when a prerequisite connection is missing.
 * Solid surface, calm copy, a link to finish setup. Never blames the user.
 */
export function GatingPanel({ dbActive, aiActive }: { dbActive: boolean; aiActive: boolean }): JSX.Element {
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Falta um passo para começar</h2>
      {!dbActive && (
        <p style={{ color: 'var(--c-text-2)' }}>
          Conecte seu banco de dados para o assistente poder responder sobre seus dados.{' '}
          <Link to="/connect/database">Conectar banco</Link>
        </p>
      )}
      {!aiActive && (
        <p style={{ color: 'var(--c-text-2)' }}>
          Conecte sua chave da IA (Claude) para conversar.{' '}
          <Link to="/connect/ai">Conectar IA</Link>
        </p>
      )}
    </Card>
  );
}

/** A terminal stream error rendered on a SOLID surface — the backend's sanitized message + a
 *  fix-it link for connection-related codes. Never a raw stack trace. */
export function ErrorPanel({ code, message }: { code: ChatErrorCode; message: string }): JSX.Element {
  const link =
    code === 'ai_key_invalid' || code === 'ai_not_connected'
      ? { to: '/connect/ai', label: 'Revisar conexão da IA' }
      : code === 'data_source_unavailable'
        ? { to: '/connect/database', label: 'Revisar conexão do banco' }
        : null;
  return (
    <Card role="alert" style={{ borderColor: 'var(--c-neg)' }}>
      <p style={{ margin: 0, color: 'var(--c-text)' }}>{message}</p>
      {link && (
        <p style={{ margin: '8px 0 0' }}>
          <Link to={link.to}>{link.label}</Link>
        </p>
      )}
    </Card>
  );
}

/** First-run / empty-session invitation on a solid surface. */
export function EmptyConversation({ onExample }: { onExample: (q: string) => void }): JSX.Element {
  const examples = ['Quanto vendi em maio?', 'Quantos pedidos tive no último mês?', 'Qual meu ticket médio?'];
  return (
    <Card>
      <h2 className="ds-display" style={{ marginTop: 0 }}>
        Faça sua primeira pergunta
      </h2>
      <p style={{ color: 'var(--c-text-2)' }}>Pergunte sobre seus dados em linguagem natural. Por exemplo:</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {examples.map((q) => (
          <Button key={q} type="button" variant="ghost" onClick={() => onExample(q)}>
            {q}
          </Button>
        ))}
      </div>
    </Card>
  );
}
