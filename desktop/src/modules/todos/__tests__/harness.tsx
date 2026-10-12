import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, vi } from "vitest"
import type { TodoItemDto } from "@synapse/shared/todo-contracts"

const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setCompleted: vi.fn(), delete: vi.fn(),
  authenticated: true, online: true, id: "user", reset: () => {}, changed: () => {},
}))
export { mocks }
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: mocks.authenticated ? { status: "authenticated", connectivity: mocks.online ? "online" : "offline", profile: { user: { id: mocks.id } } } : { status: "unauthenticated" }, startLogin: vi.fn() }) }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => null }))
vi.mock("@/lib/todos-api", () => ({ todosApi: { ...mocks,
  onReset: (listener: () => void) => { mocks.reset = listener; return () => {} },
  onChanged: (listener: () => void) => { mocks.changed = listener; return () => {} },
} }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
export const item: TodoItemDto = { id: "a", title: "报销", note: null, dueAt: null, reminder: "none", offsetMinutes: null, remindAt: null, reminderGeneration: 0, reminderStatus: "none", completedAt: null, version: 1, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
let root: Root | null = null
export function mount(node: React.ReactNode) { if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container) }; act(() => root!.render(node)) }
export async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
beforeEach(() => { mocks.authenticated = true; mocks.online = true; mocks.id = "user"; for (const fn of [mocks.list, mocks.get, mocks.create, mocks.update, mocks.setCompleted, mocks.delete]) fn.mockReset(); mocks.list.mockResolvedValue({ items: [item], nextOffset: null }); mocks.get.mockResolvedValue(item) })
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.innerHTML = "" })
