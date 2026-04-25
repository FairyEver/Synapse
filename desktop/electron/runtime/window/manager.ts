/**
 * Phase 0.3 — WindowManager.
 * SPEC §6.
 *
 * Centralizes BrowserWindow creation, broadcast, and shutdown so:
 *  - EventBus (Phase 0.4) can broadcast through a single dispatcher.
 *  - Phase 0.4 hard rule "禁止裸 webContents.send" has exactly one allowed
 *    home — this file.
 *  - Future "headless" mode (SPEC §15.3) can swap WindowManager for a no-op
 *    implementation without touching consumers.
 *
 * Test ergonomics: BrowserWindow is injected as a factory so vitest can run
 * the manager against in-memory fakes.
 */

export type WindowRole = "main" | "detail" | "overlay"

export interface ManagedWindow {
  readonly id: number
  readonly role: WindowRole
  readonly isDestroyed: () => boolean
  readonly isVisible: () => boolean
  readonly isMinimized: () => boolean
  readonly show: () => void
  readonly focus: () => void
  readonly restore: () => void
  /** Pushes a payload through the underlying webContents. EventBus uses this. */
  readonly send: (channel: string, payload: unknown) => void
  readonly close: () => void
}

export interface WindowFactoryContext {
  readonly id: string
  readonly payload?: unknown
}

export interface WindowDescriptor {
  readonly id: string
  readonly role: WindowRole
  /** Constructs the underlying ManagedWindow on open(). */
  readonly create: (ctx: WindowFactoryContext) => ManagedWindow
  /**
   * Optional reuse predicate. When open(id) is called and an existing window
   * with this id is alive, the manager calls shouldReuse(existing, payload).
   * Default: true (reuse + focus).
   */
  readonly shouldReuse?: (existing: ManagedWindow, openRequest: unknown) => boolean
}

export interface WindowManager {
  register(descriptor: WindowDescriptor): void
  /**
   * Open the window registered under `id`. `payload` is opaque — each
   * descriptor's `create` callback owns the schema; the manager passes it
   * through unchanged. Descriptors that need a strict shape should validate
   * inside their own `create` (e.g. via zod) rather than relying on a
   * manager-level check, since payload shapes differ per window role.
   */
  open(id: string, payload?: unknown): ManagedWindow
  close(id: string): void
  list(): ReadonlyArray<{ id: string; role: WindowRole; webContentsId: number }>
  /**
   * Get all alive windows managed by this manager.
   * Used for operations that need to iterate over all windows (e.g., notification click handling).
   */
  getAllWindows(): ReadonlyArray<ManagedWindow>
  /**
   * Broadcast a payload on a channel to all alive windows that pass the
   * filter. EventBus (Phase 0.4) calls into this; Phase 0.3 only publishes
   * the API.
   */
  broadcast(
    channel: string,
    payload: unknown,
    filter?: (window: ManagedWindow) => boolean,
  ): number
}

interface InternalWindow {
  readonly descriptor: WindowDescriptor
  handle: ManagedWindow | null
}

export class WindowManagerImpl implements WindowManager {
  private readonly windows = new Map<string, InternalWindow>()

  register(descriptor: WindowDescriptor): void {
    if (this.windows.has(descriptor.id)) {
      throw new Error(`Window descriptor "${descriptor.id}" already registered`)
    }
    this.windows.set(descriptor.id, { descriptor, handle: null })
  }

  open(id: string, payload?: unknown): ManagedWindow {
    const entry = this.windows.get(id)
    if (!entry) {
      throw new Error(`Unknown window id "${id}"`)
    }
    const existing = entry.handle
    if (existing && !existing.isDestroyed()) {
      const reuse = entry.descriptor.shouldReuse
        ? entry.descriptor.shouldReuse(existing, payload)
        : true
      if (reuse) {
        if (!existing.isVisible()) existing.show()
        existing.focus()
        return existing
      }
      // Caller wants a fresh instance — close and re-create.
      existing.close()
    }
    const handle = entry.descriptor.create({ id, payload })
    entry.handle = handle
    return handle
  }

  close(id: string): void {
    const entry = this.windows.get(id)
    if (!entry || !entry.handle) return
    if (!entry.handle.isDestroyed()) {
      entry.handle.close()
    }
    entry.handle = null
  }

  list(): ReadonlyArray<{ id: string; role: WindowRole; webContentsId: number }> {
    const result: Array<{ id: string; role: WindowRole; webContentsId: number }> = []
    for (const [id, entry] of this.windows) {
      const handle = entry.handle
      if (!handle || handle.isDestroyed()) continue
      result.push({ id, role: entry.descriptor.role, webContentsId: handle.id })
    }
    return result
  }

  getAllWindows(): ReadonlyArray<ManagedWindow> {
    const result: Array<ManagedWindow> = []
    for (const entry of this.windows.values()) {
      const handle = entry.handle
      if (!handle || handle.isDestroyed()) continue
      result.push(handle)
    }
    return result
  }

  broadcast(
    channel: string,
    payload: unknown,
    filter?: (window: ManagedWindow) => boolean,
  ): number {
    let sent = 0
    for (const entry of this.windows.values()) {
      const handle = entry.handle
      if (!handle || handle.isDestroyed()) continue
      if (filter && !filter(handle)) continue
      handle.send(channel, payload)
      sent++
    }
    return sent
  }
}

export function createWindowManager(): WindowManagerImpl {
  return new WindowManagerImpl()
}
