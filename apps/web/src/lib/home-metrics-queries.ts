import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { HomeMetricsResponse, SalesMappingResponse } from '@lumen/shared';
import { getHomeMetrics, getSalesMapping } from './home-metrics';

export const HOME_METRICS_KEYS = {
  mapping: ['sales-mapping'] as const,
  metrics: ['home', 'metrics'] as const,
};

export function useSalesMapping(enabled = true): UseQueryResult<SalesMappingResponse> {
  return useQuery({ queryKey: HOME_METRICS_KEYS.mapping, queryFn: getSalesMapping, enabled });
}

export function useHomeMetrics(): UseQueryResult<HomeMetricsResponse> {
  return useQuery({ queryKey: HOME_METRICS_KEYS.metrics, queryFn: getHomeMetrics });
}
