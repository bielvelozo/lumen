import type { AiConnectErrorCategory, ChatErrorCode } from '@lumen/shared';

/**
 * Reduce tool params to NAMES + value TYPES only — NEVER the values. A column/table/filter value
 * (schema name or possibly user-derived data) and any figure are replaced with a type tag, so
 * `function_call_logs.params` can never carry raw customer data. Keys + nesting are preserved for
 * audit ("which function, what shape"); the function name is logged separately.
 */
export function sanitizeParams(raw: unknown): Record<string, unknown> {
  const out = sanitizeValue(raw);
  return typeof out === 'object' && out !== null && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : { value: out };
}

function sanitizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  switch (typeof value) {
    case 'object':
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)]),
      );
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return typeof value;
  }
}

/** Map a sanitized model-provider category (spec 11) to a user-facing chat error code. */
export function chatErrorFromCategory(category: AiConnectErrorCategory): ChatErrorCode {
  switch (category) {
    case 'invalid_key':
    case 'model_unavailable':
      return 'ai_key_invalid';
    case 'rate_limited':
      return 'ai_rate_limited';
    case 'network':
      return 'ai_unavailable';
    default:
      return 'unknown';
  }
}

/** Deterministic, user-readable copy for each sanitized chat error code (pt-BR). */
export const CHAT_ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  ai_not_connected: 'Conecte sua chave da Anthropic para usar o assistente.',
  ai_key_invalid: 'Sua chave de IA parece inválida — reconecte-a.',
  ai_rate_limited: 'Limite de uso da IA atingido. Tente novamente em instantes.',
  ai_unavailable: 'Não foi possível falar com a IA agora. Tente novamente.',
  model_refused: 'Não consigo ajudar com esse pedido.',
  data_source_unavailable: 'Não consegui acessar seu banco de dados agora.',
  step_limit: 'Não consegui concluir a resposta. Tente reformular a pergunta.',
  unknown: 'Algo deu errado ao responder. Tente novamente.',
};
