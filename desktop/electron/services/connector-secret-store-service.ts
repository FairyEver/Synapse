import { app, safeStorage } from "electron"
import path from "node:path"
import type { SynapseConnectorSecretDraft } from "../../src/types/connector"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import type { SecretEntryV1 } from "../runtime/data-repo/schemas"
import type { AuditSink, PermissionGuard } from "../runtime/security"

type ConnectorSecretEntry = SecretEntryV1 & {
  value: string
  updatedAt: string
}

type ConnectorSecretStoreOptions = {
  namespace?: EncryptedJsonNamespace<ConnectorSecretEntry>
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  now?: () => Date
}

function createSecretsNamespace(): EncryptedJsonNamespace<ConnectorSecretEntry> {
  const userDataPath = app.getPath("userData")
  const dataV1Path = path.join(userDataPath, "data-v1")
  const filePath = path.join(dataV1Path, "secrets.bin")

  return new EncryptedJsonNamespace<ConnectorSecretEntry>({
    name: "secrets",
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath,
    safeStorage,
    validate: (value): value is ConnectorSecretEntry =>
      typeof value === "object" &&
      value !== null &&
      (value as ConnectorSecretEntry).schemaVersion === 1 &&
      typeof (value as ConnectorSecretEntry).id === "string" &&
      typeof (value as ConnectorSecretEntry).kind === "string" &&
      typeof (value as ConnectorSecretEntry).value === "string",
  })
}

export class ConnectorSecretStoreService {
  private readonly namespace: EncryptedJsonNamespace<ConnectorSecretEntry>
  private readonly permissionGuard: PermissionGuard
  private readonly auditSink: AuditSink
  private readonly now: () => Date

  constructor(options: ConnectorSecretStoreOptions) {
    this.namespace = options.namespace ?? createSecretsNamespace()
    this.permissionGuard = options.permissionGuard
    this.auditSink = options.auditSink
    this.now = options.now ?? (() => new Date())
  }

  async writeConnectorSecrets(secrets: readonly SynapseConnectorSecretDraft[]): Promise<void> {
    for (const secret of secrets) {
      const permission = await this.permissionGuard.check({
        action: "secret.write",
        actor: { kind: "user" },
        resource: secret.id,
        context: {
          source: "connectors",
          description: secret.description,
        },
      })

      if (!permission.allowed) {
        this.auditSink.record({
          action: "secret.write",
          actor: { kind: "user" },
          resource: secret.id,
          outcome: "denied",
          metadata: { reason: permission.reason },
        })
        throw new Error("密钥写入未授权。")
      }

      try {
        await this.namespace.upsert({
          id: secret.id,
          schemaVersion: 1,
          kind: secret.kind,
          description: secret.description,
          value: secret.value,
          updatedAt: this.now().toISOString(),
        })
        this.auditSink.record({
          action: "secret.write",
          actor: { kind: "user" },
          resource: secret.id,
          outcome: "allowed",
          metadata: { source: "connectors" },
        })
      } catch (error) {
        this.auditSink.record({
          action: "secret.write",
          actor: { kind: "user" },
          resource: secret.id,
          outcome: "failed",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        })
        throw error
      }
    }
  }

  async readConnectorSecretValue(id: string): Promise<string | null> {
    const permission = await this.permissionGuard.check({
      action: "secret.read",
      actor: { kind: "user" },
      resource: id,
      context: {
        source: "connectors",
      },
    })

    if (!permission.allowed) {
      this.auditSink.record({
        action: "secret.read",
        actor: { kind: "user" },
        resource: id,
        outcome: "denied",
        metadata: { reason: permission.reason },
      })
      throw new Error("密钥读取未授权。")
    }

    try {
      const entry = await this.namespace.get(id)
      this.auditSink.record({
        action: "secret.read",
        actor: { kind: "user" },
        resource: id,
        outcome: "allowed",
        metadata: { source: "connectors" },
      })
      return entry?.value ?? null
    } catch (error) {
      this.auditSink.record({
        action: "secret.read",
        actor: { kind: "user" },
        resource: id,
        outcome: "failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }
}
