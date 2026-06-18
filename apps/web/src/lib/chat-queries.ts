import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ChatSessionSummary, ChatMessageDTO, ClaudeModelId } from '@lumen/shared';
import { listSessions, getMessages } from './chat';
import { useConnectionState } from './connect-db-queries';
import { useAiConnection } from './ai-connection-queries';

export const CHAT_KEYS = {
  sessions: ['chat', 'sessions'] as const,
  messages: (sessionId: string) => ['chat', 'messages', sessionId] as const,
};

export function useSessions(): UseQueryResult<ChatSessionSummary[]> {
  return useQuery({ queryKey: CHAT_KEYS.sessions, queryFn: listSessions });
}

export function useMessages(sessionId: string | undefined): UseQueryResult<ChatMessageDTO[]> {
  return useQuery({
    queryKey: CHAT_KEYS.messages(sessionId ?? ''),
    queryFn: () => getMessages(sessionId as string),
    enabled: !!sessionId,
  });
}

export interface ChatReadiness {
  isPending: boolean;
  dbActive: boolean;
  aiActive: boolean;
  ready: boolean;
  aiDefaultModel: ClaudeModelId | null;
}

/**
 * Gating: the chat is usable only with BOTH an active DB connection and an active AI connection.
 * Derived from the existing connection queries (specs 08/11) — no new endpoint. Also surfaces the
 * org's `default_model` so the switcher can default to it.
 */
export function useChatReadiness(): ChatReadiness {
  const conn = useConnectionState();
  const ai = useAiConnection();
  const dbActive = conn.data?.status === 'active';
  const aiActive = ai.data?.status === 'active';
  return {
    isPending: conn.isPending || ai.isPending,
    dbActive,
    aiActive,
    ready: dbActive && aiActive,
    aiDefaultModel: ai.data?.defaultModel ?? null,
  };
}
