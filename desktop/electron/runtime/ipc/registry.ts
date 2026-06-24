/**
 * Phase 0.3 — IpcRegistry runtime.
 *
 * Hooks each module's methods into a transport-agnostic dispatcher. The
 * Electron-specific `ipcMain.handle` adapter lives separately (Phase 0.3 will
 * provide it as a thin wrapper). This separation keeps the runtime testable
 * without booting Electron and gives Phase 0.5 ProcessRuntime a clean point
 * to swap in cross-process transports.
 */

import {
  IpcChannelNotFoundError,
  IpcModuleAlreadyRegisteredError,
  IpcRuntimeError,
} from "./errors"
import type {
  IpcHandlerContext,
  IpcInvocationContext,
  IpcMethodDescriptor,
  IpcModule,
  IpcRegisterResult,
  IpcRegistry,
} from "./types"
import { tryValidateResponse, validateRequest } from "./validation"
import { makeIdempotentDisposer } from "../lib"

/**
 * Transport callback: the IpcRegistry calls this once per registered method
 * to install the handler on whatever transport we are using (ipcMain.handle
 * in production, an in-memory map in tests).
 */
export type IpcTransportInstall = (
  channel: string,
  invoker: (request: unknown, invocation?: IpcInvocationContext) => Promise<unknown>,
) => () => void

export interface IpcRegistryDeps {
  readonly install: IpcTransportInstall
}

interface ModuleEntry {
  readonly moduleId: string
  readonly channels: string[]
  readonly disposers: Array<() => void>
}

export class IpcRegistryImpl implements IpcRegistry {
  private readonly install: IpcTransportInstall
  private readonly modules = new Map<string, ModuleEntry>()
  /** Channel → moduleId, to detect cross-module collisions. */
  private readonly channelOwner = new Map<string, string>()

  constructor(deps: IpcRegistryDeps) {
    this.install = deps.install
  }

  register(module: IpcModule, ctx: IpcHandlerContext): IpcRegisterResult {
    if (this.modules.has(module.id)) {
      throw new IpcModuleAlreadyRegisteredError(module.id)
    }
    const entry: ModuleEntry = {
      moduleId: module.id,
      channels: [],
      disposers: [],
    }

    try {
      for (const [methodName, descriptor] of Object.entries(module.methods)) {
        const channel = descriptor.channel
        if (this.channelOwner.has(channel)) {
          // Roll back partial install before rethrowing. The error's details
          // record how many handlers were rolled back so consumers can
          // distinguish "first method conflicted" from "later method
          // conflicted, several already installed".
          const rolledBack = entry.disposers.length
          throw new IpcRuntimeError(
            "ipc/channel-collision",
            `Channel "${channel}" is already owned by module "${this.channelOwner.get(channel)}" — cannot register for "${module.id}.${methodName}"`,
            {
              details: {
                channel,
                ownerModuleId: this.channelOwner.get(channel),
                rolledBackCount: rolledBack,
              },
            },
          )
        }
        const dispose = this.installMethod(channel, descriptor, ctx)
        this.channelOwner.set(channel, module.id)
        entry.channels.push(channel)
        entry.disposers.push(() => {
          dispose()
          this.channelOwner.delete(channel)
        })
      }
    } catch (error) {
      for (const dispose of entry.disposers) dispose()
      throw error
    }

    // Events are not "installed" on a transport — they're emitted via EventBus
    // (Phase 0.4). We only record their channels for diagnostics.
    for (const [, descriptor] of Object.entries(module.events)) {
      entry.channels.push(descriptor.channel)
    }

    this.modules.set(module.id, entry)

    return {
      moduleId: module.id,
      unregister: makeIdempotentDisposer(() => {
        const current = this.modules.get(module.id)
        if (!current) return
        for (const dispose of current.disposers) dispose()
        this.modules.delete(module.id)
      }),
    }
  }

  list(): readonly { moduleId: string; channels: readonly string[] }[] {
    return [...this.modules.values()].map((m) => ({
      moduleId: m.moduleId,
      channels: m.channels.slice(),
    }))
  }

  private installMethod(
    channel: string,
    descriptor: IpcMethodDescriptor,
    ctx: IpcHandlerContext,
  ): () => void {
    const invoker = async (raw: unknown, invocation: IpcInvocationContext = {}): Promise<unknown> => {
      const validated = validateRequest(channel, descriptor.request, raw)
      if (!validated.ok) {
        // Throw — the transport adapter converts this to a structured error.
        throw validated.error
      }
      const result = await Promise.resolve(descriptor.handler({
        ...ctx,
        senderWebContentsId: invocation.senderWebContentsId,
      }, validated.value))
      return tryValidateResponse(channel, descriptor.response, result)
    }
    return this.install(channel, invoker)
  }
}

/**
 * Test/in-memory transport for the registry. Returns the registry plus an
 * `invoke(channel, request)` function consumers can call as if they were the
 * renderer.
 */
export interface InMemoryIpcHarness {
  readonly registry: IpcRegistryImpl
  invoke(channel: string, request: unknown, invocation?: IpcInvocationContext): Promise<unknown>
}

export function createInMemoryHarness(): InMemoryIpcHarness {
  const handlers = new Map<string, (request: unknown, invocation?: IpcInvocationContext) => Promise<unknown>>()
  const registry = new IpcRegistryImpl({
    install(channel, invoker) {
      handlers.set(channel, invoker)
      return () => handlers.delete(channel)
    },
  })
  return {
    registry,
    async invoke(channel, request, invocation) {
      const handler = handlers.get(channel)
      if (!handler) throw new IpcChannelNotFoundError(channel)
      return handler(request, invocation)
    },
  }
}
