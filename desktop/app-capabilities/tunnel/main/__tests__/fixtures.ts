import { vi } from "vitest"
import type { SynapseAccountState } from "../../../../src/types/account"
export function memoryNamespace() {
  const rows = new Map<string, any>()
  return { rows, async get(id: string) { return rows.get(id) ?? null }, async upsert(row: { id: string }) { rows.set(row.id, structuredClone(row)) },
    async remove(id: string) { rows.delete(id) }, async listWindow(input: { filter?: object; limit: number }) {
      return [...rows.values()].filter(row => Object.entries(input.filter ?? {}).every(([k, v]) => row[k] === v)).slice(0, input.limit).map(value => ({ value: structuredClone(value) }))
    } }
}
export function fakeAccount() {
  let owner = "u1"
  const before = new Set<() => void | Promise<void>>(), changed = new Set<(state: SynapseAccountState) => void>()
  const account = {
    getState: () => ({ status: "authenticated", connectivity: "online", profile: { user: { id: owner } } } as SynapseAccountState),
    captureAccountRequestScope: () => ({ accountId: owner, authRevision: 1 }),
    getApiBaseUrlForLive: () => "https://synapse.test/api", getAccessTokenForLive: () => "fake-token",
    refreshFromStorage: vi.fn(async () => account.getState()),
    fetchAuthenticated: vi.fn(async (..._args: unknown[]) => new Response("{}")),
    onBeforeIdentityChange(listener: () => void | Promise<void>) { before.add(listener); return () => { before.delete(listener) } },
    onStateChanged(listener: (state: SynapseAccountState) => void) { changed.add(listener); return () => { changed.delete(listener) } },
    async changeOwner(next: string) { for (const listener of before) await listener(); owner = next; for (const listener of changed) listener(account.getState()) },
  }
  return account
}
