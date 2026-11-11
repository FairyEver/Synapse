import type { TunnelOperation, TunnelRepositoryPort, TunnelRow, TunnelStore } from "./tunnel.repository"

/** Test-only in-memory transaction fixture. Never registered in application modules. */
export function memoryTunnelRepository(): TunnelRepositoryPort {
  const rows = new Map<string, TunnelRow>(), operations = new Map<string, TunnelOperation>(), credentials = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()
  const filtered = (userId: string, device?: string) => [...rows.values()].filter(row => row.userId === userId && !row.deletedAt && (!device || row.clientInstanceId === device))
  const store: TunnelStore = {
    async get(userId, id) { const row = rows.get(id); return row?.userId === userId ? { ...row } : null },
    async operation(userId, id) { return operations.get(userId + ":" + id) ?? null },
    async count(userId, device) { return filtered(userId, device).length },
    async list(userId, offset, limit, device) { return filtered(userId, device).slice(offset, offset + limit).map(row => ({ ...row })) },
    async create(input) {
      if ([...rows.values()].some(row => row.label === input.label)) throw Object.assign(new Error("collision"), { code: "P2002", meta: { target: ["label"] } })
      const row: TunnelRow = { ...input, id: "m" + (rows.size + 1), revision: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }
      rows.set(row.id, row); return { ...row }
    },
    async update(id, change) { const row = rows.get(id)!; Object.assign(row, change, { revision: row.revision + 1, updatedAt: new Date() }); return { ...row } },
    async saveOperation(input) { operations.set(input.userId + ":" + input.requestId, input) },
    async credential(userId, device) { return credentials.get(userId + ":" + device) ?? null },
    async saveCredential(userId, device, hash) { credentials.set(userId + ":" + device, hash) },
    async names(_userId, ids) { return new Map(ids.map(id => [id, "Test device"])) },
  }
  return {
    async read(work) { await queue; return work(store) },
    withUserLock(_userId, work) { const next = queue.then(() => work(store)); queue = next.then(() => undefined, () => undefined); return next },
    async findPublic(label) { return [...rows.values()].find(row => row.label === label) ?? null },
  }
}
