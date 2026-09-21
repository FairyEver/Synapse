import { randomUUID } from "node:crypto"
import path from "node:path"
import { app, safeStorage } from "electron"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"

const LIVE_CLIENT_NAMESPACE = "core.live-client"

type PersistedLiveClient = Record<string, unknown> & {
  clientInstanceId?: string
}

type LiveClientIdStoreDeps = {
  readonly namespace?: EncryptedJsonNamespace<PersistedLiveClient>
  readonly createId?: () => string
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

  constructor(deps: LiveClientIdStoreDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.createId = deps.createId ?? randomUUID
  }

  async getOrCreate(): Promise<string> {
    const current = await this.namespace.getSingleton()
    const existing = current?.clientInstanceId?.trim()
    if (existing) {
      return existing
    }

    const clientInstanceId = this.createId()
    await this.namespace.setSingleton({ ...(current ?? {}), clientInstanceId })
    return clientInstanceId
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
  async reissue(): Promise<string> {
    const current = await this.namespace.getSingleton()
    const clientInstanceId = this.createId()
    await this.namespace.setSingleton({ ...(current ?? {}), clientInstanceId })
    return clientInstanceId
  }
}
