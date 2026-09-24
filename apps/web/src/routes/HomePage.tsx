import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CLAUDE_MODELS } from '@lumen/shared';
import { Badge, MetricCard } from '../design-system/ui';
import { ChatIcon, DatabaseIcon, KeyIcon, SendIcon } from '../design-system/icons';
import { useSessions, useChatReadiness } from '../lib/chat-queries';
import { useConnectionState } from '../lib/connect-db-queries';
import { formatDateTime } from '../lib/format';

const EXAMPLES = ['Quanto vendi em maio?', 'Quantos pedidos tive no último mês?', 'Qual meu ticket médio?'];

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Bom dia.';
  if (h < 18) return 'Boa tarde.';
  return 'Boa noite.';
}

function todayLabel(now: Date): string {
  const s = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Home behind the protected shell: the question box (hands off to the chat), a STATIC
 * illustration of the answers (the `MetricCard`s — no client-DB queries here), the latest
 * conversations and the connection status. Everything sits on solid surfaces, never on glass.
 */
export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const now = new Date();

  const ask = (text: string): void => {
    const q = text.trim();
    if (q) navigate('/chat', { state: { ask: q } });
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    ask(question);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1080 }}>
      <div className="page-head">
        <span className="eyebrow">{todayLabel(now)}</span>
        <h1 className="page-title" style={{ fontSize: 'var(--text-hero)' }}>
          {greeting(now)}
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="card"
        style={{ boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 24px' }}
      >
        <label htmlFor="home-question" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--c-text-2)' }}>
          Pergunte ao seu negócio
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            id="home-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pergunte sobre seus dados…"
            style={{
              flex: 1,
              minWidth: 0,
              height: 48,
              border: 0,
              outline: 'none',
              background: 'transparent',
              font: 'inherit',
              fontSize: 22,
              color: 'var(--c-text)',
            }}
          />
          <button type="submit" className="btn btn--primary btn--icon" aria-label="Perguntar" style={{ width: 48, height: 48 }}>
            <SendIcon size={20} />
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
      </form>

      <section aria-labelledby="home-example" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span id="home-example" className="eyebrow">
          Exemplo do que o Lumen responde
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          <MetricCard label="Vendas em maio" value="R$ 128.000" delta="+12% vs abril" trend="up" />
          <MetricCard label="Pedidos" value="342" delta="+8% vs abril" trend="up" />
          <MetricCard label="Ticket médio" value="R$ 374" delta="-3% vs abril" trend="down" />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        <RecentConversations />
        <Connections />
      </div>
    </div>
  );
}

function RecentConversations(): JSX.Element {
  const sessions = useSessions();
  const recent = Array.isArray(sessions.data) ? sessions.data.slice(0, 4) : [];

  return (
    <div className="card" style={{ paddingBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Conversas recentes</h2>
        <Link to="/chat" style={{ fontSize: 13.5, fontWeight: 500 }}>
          Ver todas
        </Link>
      </div>
      {recent.length === 0 && (
        <p style={{ margin: '0 0 12px', color: 'var(--c-text-2)', fontSize: 14 }}>
          Nenhuma conversa ainda. Faça sua primeira pergunta acima.
        </p>
      )}
      {recent.map((s) => (
        <Link
          key={s.id}
          to={`/chat/${s.id}`}
          style={{
            minHeight: 50,
            borderTop: '1px solid var(--c-divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            color: 'var(--c-text)',
          }}
        >
          <ChatIcon size={17} style={{ color: 'var(--c-text-3)', flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.title ?? 'Nova conversa'}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Connections(): JSX.Element {
  const readiness = useChatReadiness();
  const connection = useConnectionState();
  const config = connection.data?.config;
  const modelLabel = CLAUDE_MODELS.find((m) => m.id === readiness.aiDefaultModel)?.label;

  const dbDetail = config
    ? [`MySQL · ${config.databaseName}`, connection.data?.lastTestedAt && `testado em ${formatDateTime(connection.data.lastTestedAt)}`]
        .filter(Boolean)
        .join(' · ')
    : 'Nenhum banco conectado';

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Conexões</h2>
      <ConnectionRow
        icon={<DatabaseIcon size={19} />}
        name="Banco de dados"
        detail={dbDetail}
        active={readiness.dbActive}
        pending={readiness.isPending}
        to="/connect/database"
      />
      <div style={{ height: 1, background: 'var(--c-divider)' }} />
      <ConnectionRow
        icon={<KeyIcon size={19} />}
        name="IA"
        detail={modelLabel ? `Claude · ${modelLabel}` : 'Nenhuma chave conectada'}
        active={readiness.aiActive}
        pending={readiness.isPending}
        to="/connect/ai"
      />
    </div>
  );
}

function ConnectionRow({
  icon,
  name,
  detail,
  active,
  pending,
  to,
}: {
  icon: JSX.Element;
  name: string;
  detail: string;
  active: boolean;
  pending: boolean;
  to: string;
}): JSX.Element {
  return (
    <Link to={to} style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'var(--c-text)' }}>
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: 'var(--c-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{name}</span>
        <span className="ds-mono" style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
          {detail}
        </span>
      </span>
      {!pending && (active ? <Badge tone="pos">Conectado</Badge> : <Badge tone="wait">Pendente</Badge>)}
    </Link>
  );
}
