import type { CloudTableDto, CloudTableSummary, CloudPage, CloudRecordDto, CloudKeyResources } from '@synapse/shared'
import { requestJson } from '@/lib/api-client'
const base = '/api/console/tables'
export const cloudTableApi = {
  list: (trash = false, cursor?: string, signal?: AbortSignal) => requestJson<CloudPage<CloudTableSummary>>(`${base}${trash ? '/trash' : ''}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }),
  get: (id: string, signal?: AbortSignal) => requestJson<CloudTableDto>(`${base}/${encodeURIComponent(id)}`, { signal }),
  send: <T = unknown>(path: string, method: string, body?: unknown, idempotencyKey: string = crypto.randomUUID()) => requestJson<T>(`${base}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { 'Idempotency-Key': idempotencyKey } }),
  query: (id: string, query: unknown, signal?: AbortSignal) => requestJson<CloudPage<CloudRecordDto>>(`${base}/${id}/records/query`, { method: 'POST', body: JSON.stringify(query), signal }),
  trash: (id: string, cursor?: string, signal?: AbortSignal) => requestJson<CloudPage<CloudRecordDto>>(`${base}/${id}/records/trash${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }),
  logs: (id: string, cursor?: string, signal?: AbortSignal) => requestJson<CloudPage<{ id: string; operation: string; status: number; durationMs: number; createdAt: string; requestId: string }>>(`${base}/${id}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }),
  resources: (id: string, tableResources: CloudKeyResources) => requestJson(`/api/console/api-keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ tableResources }) }),
}
