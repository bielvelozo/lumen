import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AiConnectState } from '@lumen/shared';
import { getAiConnection } from './ai-connection';

export const AI_CONNECTION_KEY = ['ai-connection'] as const;

export function useAiConnection(): UseQueryResult<AiConnectState> {
  return useQuery({ queryKey: AI_CONNECTION_KEY, queryFn: getAiConnection });
}
