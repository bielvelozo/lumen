import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button } from '../../design-system/ui';
import { getConsentTerms, acceptConsent } from '../../lib/connect-db';
import { CONNECT_DB_KEYS } from '../../lib/connect-db-queries';

/**
 * Step 1 — Consent. Renders spec-07's plain-language terms + the four scope points on a SOLID
 * card. Accept is enabled only after the owner explicitly acknowledges (the scope points are
 * visible). Posting records the acceptance server-side (org + user from the JWT; no org id in
 * the body) and invalidates the consent query, advancing the wizard. A newer `consent_version`
 * surfaces as `accepted: false`, so this step re-shows the (current) terms and re-requires it.
 */
export function ConsentStep(): JSX.Element {
  const queryClient = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const terms = useQuery({ queryKey: ['db-connection', 'consent-terms'], queryFn: getConsentTerms });

  const accept = useMutation({
    mutationFn: () => acceptConsent(terms.data?.version ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECT_DB_KEYS.consent }),
  });

  if (terms.isPending) {
    return (
      <Card>
        <p aria-busy="true">Carregando termos…</p>
      </Card>
    );
  }
  if (terms.isError || !terms.data) {
    return (
      <Card>
        <p style={{ color: 'var(--c-text-2)' }}>Não foi possível carregar os termos.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Termos de conexão</h2>
      <ul style={{ color: 'var(--c-text)', lineHeight: 1.6, paddingLeft: 20 }}>
        {terms.data.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        Li e aceito os termos acima.
      </label>
      {accept.isError && (
        <p role="alert" style={{ color: 'var(--c-neg)', fontSize: 13 }}>
          Não foi possível registrar o aceite. Tente novamente.
        </p>
      )}
      <Button
        type="button"
        disabled={!acknowledged || accept.isPending}
        onClick={() => accept.mutate()}
      >
        {accept.isPending ? 'Registrando…' : 'Aceitar e continuar'}
      </Button>
    </Card>
  );
}
