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
}
