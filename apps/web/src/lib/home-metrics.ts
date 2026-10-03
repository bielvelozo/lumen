import type { HomeMetricsResponse, SalesMapping, SalesMappingResponse } from '@lumen/shared';
import { apiFetch } from './api-client';

export const getSalesMapping = (): Promise<SalesMappingResponse> => apiFetch('/sales-mapping');

export const saveSalesMapping = (mapping: SalesMapping): Promise<SalesMappingResponse> =>
  apiFetch('/sales-mapping', { method: 'PUT', body: mapping });

export const getHomeMetrics = (): Promise<HomeMetricsResponse> => apiFetch('/home/metrics');
