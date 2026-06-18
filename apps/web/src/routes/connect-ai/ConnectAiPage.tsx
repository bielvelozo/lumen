import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CLAUDE_MODELS,
  DEFAULT_MODEL,
  type ClaudeModelId,
  type AiConnectErrorCategory,
  type AiConnectResult,
} from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';
import { FormField } from '../../forms/FormField';
import { connectAi } from '../../lib/ai-connection';
import { useAiConnection, AI_CONNECTION_KEY } from '../../lib/ai-connection-queries';

const ERROR_MESSAGES: Record<AiConnectErrorCategory, string> = {
  invalid_key: 'A chave foi rejeitada pela Anthropic. Verifique e tente novamente.',
  model_unavailable: 'O modelo escolhido não está disponível para essa chave. Escolha outro.',
  rate_limited: 'Limite temporário ou cota atingida — a chave pode estar ok. Tente em instantes.',
  network: 'Não foi possível falar com a Anthropic. Tente novamente.',
  unknown: 'Não foi possível validar a chave.',
};

const STATUS_LABELS: Record<string, string> = { active: 'Conectado', pending: 'Pendente', failed: 'Falhou' };

/**
 * Flow 3 — connect Claude (BYO key). The key field is strictly write-only: masked, never
 * pre-filled, never read back (the API never returns it). The model selector is driven by the
 * shared curated list. All data on a solid surface; no `org_id` ever sent (anti-IDOR).
 */
export function ConnectAiPage(): JSX.Element {
  const queryClient = useQueryClient();
  const connection = useAiConnection();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);
  const [keyError, setKeyError] = useState<string | undefined>(undefined);
  const [lastResult, setLastResult] = useState<AiConnectResult | null>(null);
  const [initialised, setInitialised] = useState(false);

  // Seed the selector from the stored default the first time the connection loads.
  if (!initialised && connection.data) {
    if (connection.data.defaultModel) setModel(connection.data.defaultModel);
    setInitialised(true);
  }

  const connect = useMutation({
    mutationFn: connectAi,
    onSuccess: (result) => {
      setLastResult(result);
      setApiKey(''); // never retain the pasted key
      queryClient.invalidateQueries({ queryKey: AI_CONNECTION_KEY });
    },
  });

  if (connection.isPending) {
    return (
      <Card>
        <p aria-busy="true">Carregando…</p>
      </Card>
    );
  }

  const state = connection.data;
  const hasKey = state?.hasKey ?? false;

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setKeyError(undefined);
    setLastResult(null);
    // A first-time connection needs a key; an existing one may re-validate the stored key.
    if (!hasKey && apiKey.trim().length === 0) {
      setKeyError('Cole sua chave da Anthropic (sk-ant-…).');
      return;
    }
    connect.mutate({ apiKey: apiKey.trim() || undefined, model });
  };

  // Prefer the freshest signal: the just-returned category, else the persisted state error.
  const errorCategory: AiConnectErrorCategory | null = lastResult?.error ?? state?.lastError ?? null;
  const isActive = (lastResult?.state.status ?? state?.status) === 'active';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
      <div>
        <h1 className="ds-display" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
          Conectar IA (Claude)
        </h1>
        <p style={{ color: 'var(--c-text-2)', margin: '6px 0 0' }}>
          Use sua própria chave da Anthropic. Ela é validada com uma chamada real, criptografada e
          nunca exibida de volta.
        </p>
      </div>

      <Card>
        {isActive && (
          <p style={{ marginTop: 0 }}>
            <strong>{STATUS_LABELS.active} — Claude</strong>
            {(lastResult?.state.defaultModel ?? state?.defaultModel) && (
              <span style={{ color: 'var(--c-text-2)' }}>
                {' · '}
                {CLAUDE_MODELS.find((m) => m.id === (lastResult?.state.defaultModel ?? state?.defaultModel))
                  ?.label ?? (lastResult?.state.defaultModel ?? state?.defaultModel)}
              </span>
            )}
          </p>
        )}
        {errorCategory && (
          <p role="alert" aria-live="polite" style={{ color: 'var(--c-neg)', marginTop: 0 }}>
            {ERROR_MESSAGES[errorCategory]}
          </p>
        )}

        <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField
            label={hasKey ? 'Nova chave da Anthropic (opcional)' : 'Chave da Anthropic'}
            name="apiKey"
            type="password"
            value={apiKey}
            error={keyError}
            onChange={setApiKey}
            autoComplete="off"
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            <span style={{ color: 'var(--c-text-2)' }}>Modelo padrão</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ClaudeModelId)}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--c-border)',
                background: 'var(--c-surface-2)',
                color: 'var(--c-text)',
              }}
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={connect.isPending}>
            {connect.isPending
              ? 'Validando…'
              : hasKey
                ? 'Validar e salvar'
                : 'Conectar e validar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
