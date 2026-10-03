import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CLAUDE_MODELS,
  DEFAULT_MODEL,
  type ClaudeModelId,
  type AiConnectErrorCategory,
  type AiConnectResult,
} from '@lumen/shared';
import { Card, Button, Badge, PageHeader } from '../../design-system/ui';
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

  if (state?.mode === 'subscription') {
    const modelLabel = CLAUDE_MODELS.find((m) => m.id === state.defaultModel)?.label ?? state.defaultModel;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
        <PageHeader
          title="IA (Claude)"
          lead="Este servidor responde pela assinatura do Claude de quem o opera. Não é preciso colar chave."
        />
        <Card>
          <p style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge tone="pos">{STATUS_LABELS.active} — Claude</Badge>
            <span className="ds-mono" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
              {modelLabel}
            </span>
          </p>
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>
            Você pode trocar o modelo a cada pergunta no seletor do chat.
          </p>
        </Card>
      </div>
    );
  }

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
      <PageHeader
        title="Conectar IA (Claude)"
        lead="Use sua própria chave da Anthropic. Ela é validada com uma chamada real, criptografada e nunca exibida de volta."
      />

      <Card>
        {isActive && (
          <p style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge tone="pos">{STATUS_LABELS.active} — Claude</Badge>
            {(lastResult?.state.defaultModel ?? state?.defaultModel) && (
              <span className="ds-mono" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="field-label">Modelo padrão</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ClaudeModelId)}
              className="input"
              style={{ width: '100%', minHeight: 44, fontSize: 15, background: 'var(--c-surface)', borderColor: 'var(--c-border-strong)' }}
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={connect.isPending} style={{ alignSelf: 'flex-start' }}>
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
