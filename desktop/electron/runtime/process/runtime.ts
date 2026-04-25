/**
 * Phase 0.5 — ProcessRuntime types + main-process direct implementation.
 * SPEC §15.3.
 *
 * Phase 0 lands the interface + a `main` impl that runs everything in-process.
 * `runIn: "utility" | "worker" | "child"` are not implemented in Phase 0;
 * future PRs add them when an Agent CLI consumer needs isolation.
 */

export type ProcessKind = "main" | "utility" | "worker" | "child"

export type ProcessStatus = "starting" | "running" | "stopped" | "crashed"

export interface ProcessHandle {
  readonly kind: ProcessKind
  readonly pid?: number
  readonly status: ProcessStatus
  send<T>(channel: string, payload: T): Promise<void>
  on(channel: string, listener: (payload: unknown) => void): () => void
  kill(signal?: NodeJS.Signals): Promise<void>
}

export interface ProcessDescriptor<Init = unknown> {
  readonly id: string
  readonly kind: ProcessKind
  readonly init: Init
  /** Optional in-process worker function used by the "main" impl. */
  readonly run?: (init: Init, handle: ProcessHandle) => Promise<void> | void
}

export type RestartPolicy = "never" | "always" | "exponential-backoff"

export interface ProcessRuntime {
  spawn<Init>(descriptor: ProcessDescriptor<Init>): Promise<ProcessHandle>
  list(): readonly ProcessHandle[]
  readonly restartPolicy: RestartPolicy
}

interface MainHandleState {
  status: ProcessStatus
  listeners: Map<string, Set<(payload: unknown) => void>>
}

export class MainProcessRuntime implements ProcessRuntime {
  readonly restartPolicy: RestartPolicy
  private readonly handles = new Map<string, ProcessHandle>()

  constructor(options: { restartPolicy?: RestartPolicy } = {}) {
    this.restartPolicy = options.restartPolicy ?? "never"
  }

  async spawn<Init>(descriptor: ProcessDescriptor<Init>): Promise<ProcessHandle> {
    if (descriptor.kind !== "main") {
      throw new Error(
        `MainProcessRuntime only supports kind="main"; got "${descriptor.kind}". ` +
          `Utility/worker/child variants land in a follow-up PR.`,
      )
    }
    if (this.handles.has(descriptor.id)) {
      throw new Error(`Process "${descriptor.id}" already spawned`)
    }

    const state: MainHandleState = {
      status: "starting",
      listeners: new Map(),
    }

    const handle: ProcessHandle = {
      kind: "main",
      pid: process.pid,
      get status() {
        return state.status
      },
      async send(channel, payload) {
        const subs = state.listeners.get(channel)
        if (!subs) return
        for (const listener of [...subs]) {
          try {
            listener(payload)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[process-runtime:${descriptor.id}] listener threw`, err)
          }
        }
      },
      on(channel, listener) {
        const set = state.listeners.get(channel) ?? new Set()
        set.add(listener)
        state.listeners.set(channel, set)
        return () => {
          set.delete(listener)
        }
      },
      async kill() {
        state.status = "stopped"
      },
    }

    this.handles.set(descriptor.id, handle)
    state.status = "running"

    if (descriptor.run) {
      // Fire-and-forget. If `run` throws, mark crashed.
      Promise.resolve(descriptor.run(descriptor.init, handle)).catch((err) => {
        state.status = "crashed"
        // eslint-disable-next-line no-console
        console.error(`[process-runtime:${descriptor.id}] run() threw`, err)
      })
    }

    return handle
  }

  list(): readonly ProcessHandle[] {
    return [...this.handles.values()]
  }
}

export function createMainProcessRuntime(options?: { restartPolicy?: RestartPolicy }): MainProcessRuntime {
  return new MainProcessRuntime(options)
}
