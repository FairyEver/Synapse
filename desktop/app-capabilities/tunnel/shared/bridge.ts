import type { TunnelDeleteInput, TunnelEnableInput, TunnelListInput, TunnelMappingDto, TunnelPageDto, TunnelUpdateInput } from "@synapse/shared/tunnel-contracts"
export interface TunnelBridge {
  mapping: {
    list(input?: TunnelListInput): Promise<TunnelPageDto & { currentClientInstanceId: string }>
    get(id: string): Promise<TunnelMappingDto>
    create(input: { port: number; requestId?: string }): Promise<TunnelMappingDto>
    update(id: string, input: TunnelUpdateInput): Promise<TunnelMappingDto>
    setEnabled(id: string, input: TunnelEnableInput): Promise<TunnelMappingDto>
    delete(id: string, input: TunnelDeleteInput): Promise<{ id: string; deleted: true }>
    onChanged(listener: (event: { id: string }) => void): () => void
    onReset(listener: () => void): () => void
  }
}
export type TunnelIpcResult<T> = { ok: true; data: T } | { ok: false; failure: { status: number; code: string; message: string } }
export function unwrapTunnelResult<T>(result: TunnelIpcResult<T>): T {
  if (!result.ok) throw Object.assign(new Error(result.failure.message), { status: result.failure.status, code: result.failure.code })
  return result.data
}
