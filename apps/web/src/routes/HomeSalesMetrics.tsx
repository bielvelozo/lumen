import { Link } from 'react-router-dom';
import type { HomeMetricsUnavailableReason, MonthSales } from '@lumen/shared';
import { Card, MetricCard } from '../design-system/ui';
import { useHomeMetrics } from '../lib/home-metrics-queries';
import { formatChange, formatCurrency, formatInteger, formatMonth, formatMonthYear } from '../lib/format';

const UNAVAILABLE: Record<HomeMetricsUnavailableReason | 'request_failed', { text: string; fix?: string }> = {
  mapping_invalid: {
    text: 'A tabela ou coluna de vendas escolhida não está mais liberada para o Lumen.',
    fix: 'Revisar tabela de vendas',
  },
  connection_unavailable: {
    text: 'Seu banco de dados está desconectado, então não dá para calcular as vendas agora.',
    fix: 'Revisar conexão',
  },
  query_failed: { text: 'Não foi possível consultar seu banco agora. Tente de novo em instantes.' },
  request_failed: { text: 'Não foi possível carregar os números agora. Tente de novo em instantes.' },
};

function comparison(current: number, previous: number, previousMonth: string): { delta: string; trend: 'up' | 'down' } {
  const change = formatChange(current, previous);
  if (change === null) return { delta: `sem vendas em ${previousMonth} para comparar`, trend: 'up' };
  return { delta: `${change} vs ${previousMonth}`, trend: current >= previous ? 'up' : 'down' };
}

function Figures({ current, previous }: { current: MonthSales; previous: MonthSales }): JSX.Element {
  const month = formatMonth(current.month);
  const previousMonth = formatMonth(previous.month);
  const ticket = current.averageTicket;
  const previousTicket = previous.averageTicket;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
      <MetricCard
        label={`Vendas em ${month}`}
        value={formatCurrency(current.total)}
        {...comparison(Number(current.total), Number(previous.total), previousMonth)}
      />
      <MetricCard
        label={`Pedidos em ${month}`}
        value={formatInteger(current.orders)}
        {...comparison(current.orders, previous.orders, previousMonth)}
      />
      <MetricCard
        label={`Ticket médio em ${month}`}
        value={ticket === null ? '—' : formatCurrency(ticket)}
        {...(ticket === null
          ? { delta: `sem pedidos em ${month}` }
          : comparison(Number(ticket), previousTicket === null ? 0 : Number(previousTicket), previousMonth))}
      />
    </div>
  );
}

/**
 * The Home's real figures (spec 17): the last closed month against the one before, computed by the
 * owner's database through the query registry. Never a placeholder number — when the figures can't
 * be had, the owner gets the reason and where to fix it.
 */
export function HomeSalesMetrics(): JSX.Element {
  const metrics = useHomeMetrics();
  const data = metrics.data;

  let body: JSX.Element;
  let caption = 'Último mês fechado';
  if (metrics.isPending) {
    body = (
      <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        {['Vendas', 'Pedidos', 'Ticket médio'].map((label) => (
          <MetricCard key={label} label={label} value="…" />
        ))}
      </div>
    );
  } else if (data?.status === 'ok') {
    caption = `${formatMonthYear(data.current.month)} · último mês fechado`;
    body = <Figures current={data.current} previous={data.previous} />;
  } else if (data?.status === 'not_configured') {
    body = (
      <Card>
        <h2>Veja suas vendas aqui</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--c-text-2)' }}>
          Diga ao Lumen qual tabela guarda suas vendas e esta tela passa a mostrar o faturamento, os pedidos e o ticket
          médio do último mês, calculados direto no seu banco.
        </p>
        <Link to="/connect/database">Escolher tabela de vendas</Link>
      </Card>
    );
  } else {
    const reason = data?.status === 'unavailable' ? UNAVAILABLE[data.reason] : UNAVAILABLE.request_failed;
    body = (
      <Card role="status">
        <p style={{ margin: 0, color: 'var(--c-text-2)' }}>{reason.text}</p>
        {reason.fix && (
          <p style={{ margin: '10px 0 0' }}>
            <Link to="/connect/database">{reason.fix}</Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <section aria-labelledby="home-sales" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span id="home-sales" className="eyebrow">
        {caption}
      </span>
      {body}
    </section>
  );
}
