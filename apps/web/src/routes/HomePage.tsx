import { Card, MetricCard } from '../design-system/ui';
import { useSession } from '../lib/session';

/**
 * Placeholder home behind the protected shell. The real chat lands in spec 14; here the
 * `MetricCard`s are a STATIC illustration of the data surface — and, importantly, they sit
 * on solid surfaces, never on glass (glass-only-on-chrome). No live data / no client-DB
 * queries here.
 */
export function HomePage(): JSX.Element {
  const { data: session } = useSession();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
      <Card>
        <h2 className="ds-display" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
          Bem-vindo ao Lumen
        </h2>
        <p style={{ color: 'var(--c-text-2)', margin: '8px 0 0' }}>
          Conecte seu banco de dados e sua IA para perguntar sobre seus dados em linguagem natural.
          {session ? ` Você está conectado como ${session.email}.` : ''}
        </p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MetricCard label="Vendas em maio" value="R$ 128.000" delta="+12% vs abril" trend="up" />
        <MetricCard label="Pedidos" value="342" delta="+8% vs abril" trend="up" />
        <MetricCard label="Ticket médio" value="R$ 374" delta="-3% vs abril" trend="down" />
      </div>
    </div>
  );
}
