import { randomUUID } from "node:crypto"
import path from "node:path"
import { app, safeStorage } from "electron"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"

const LIVE_CLIENT_NAMESPACE = "core.live-client"

type PersistedLiveClient = Record<string, unknown> & {
  clientInstanceId?: string
  machineFingerprint?: string
  deviceName?: string
}

type LiveClientIdStoreDeps = {
  readonly namespace?: EncryptedJsonNamespace<PersistedLiveClient>
  readonly createId?: () => string
  readonly readMachineFingerprint?: () => Promise<string | null>
}

function createNamespace(): EncryptedJsonNamespace<PersistedLiveClient> {
  return new EncryptedJsonNamespace<PersistedLiveClient>({
    name: LIVE_CLIENT_NAMESPACE,
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(app.getPath("userData"), "data-v1", `${LIVE_CLIENT_NAMESPACE}.bin`),
    safeStorage,
  })
}

export class LiveClientIdStore {
  private readonly namespace: EncryptedJsonNamespace<PersistedLiveClient>
  private readonly createId: () => string
  private readMachineFingerprint: () => Promise<string | null>
  private machineFingerprint: string | null = null
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(deps: LiveClientIdStoreDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.createId = deps.createId ?? randomUUID
    this.readMachineFingerprint = deps.readMachineFingerprint ?? (async () => null)
  }

  setMachineFingerprintReader(reader: () => Promise<string | null>): void {
    this.readMachineFingerprint = reader
  }

  getMachineFingerprint(): string | null {
    return this.machineFingerprint
  }

  getOrCreate(): Promise<string> {
    return this.serialize(async () => {
      const current = await this.namespace.getSingleton()
      const fingerprint = await this.readMachineFingerprint()
      this.machineFingerprint = fingerprint
      const existing = current?.clientInstanceId?.trim()
      const migrated = fingerprint && current?.machineFingerprint && fingerprint !== current.machineFingerprint
      const clientInstanceId = existing && !migrated ? existing : this.createId()
      if (clientInstanceId !== existing || (fingerprint && fingerprint !== current?.machineFingerprint)) {
        await this.namespace.setSingleton({
          ...(current ?? {}), clientInstanceId,
          ...(fingerprint ? { machineFingerprint: fingerprint } : {}),
        })
      }
      return clientInstanceId
    })
  }

  async getDeviceName(): Promise<string | null> {
    await this.mutations
    return (await this.namespace.getSingleton())?.deviceName?.trim() || null
  }

  setDeviceName(name: string): Promise<void> {
    return this.serialize(async () => {
      const current = await this.namespace.getSingleton()
      await this.namespace.setSingleton({ ...(current ?? {}), deviceName: name })
    })
  }

  /**
   * Replaces this installation's id with a fresh one.
   *
   * For the case the id turns out to belong to another machine — the file it is
   * stored in was copied here by a migration or a restored backup — where the
   * server refuses the connection and names this as the reason. Nothing else can
   * be done about it locally: only the cloud sees that two machines are claiming
   * one id, and only this side can pick a new one.
   *
   * Unlike `getOrCreate`, it always writes: the caller asked because the id it
   * already has is unusable, so returning the existing one would be a no-op that
   * loops.
   */
  reissue(): Promise<string> {
    return this.serialize(async () => {
      const current = await this.namespace.getSingleton()
      const clientInstanceId = this.createId()
      await this.namespace.setSingleton({ ...(current ?? {}), clientInstanceId })
      return clientInstanceId
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    // Callers receive the rejection; the queue remains usable for a later retry.
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }
}

// All consumers must share the encrypted namespace cache and mutation queue.
let defaultStore: LiveClientIdStore | undefined
export function getLiveClientIdStore(): LiveClientIdStore {
  return defaultStore ??= new LiveClientIdStore()
}
