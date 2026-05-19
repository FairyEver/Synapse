import path from "node:path"

import type {
  ConversationEntryV1,
  ConnectorEntryV1,
  DataNamespace,
  DataRepository,
  SecretEntryV1,
  WorkspaceBindingEntryV1,
} from "../runtime/data-repo"
import type { StructuredLogger } from "../runtime/service-registry"
import type { SynapseConfig } from "../../src/types/config"
import { normalizePathForCompare } from "../../src/lib/path-compare"
import { feishuSecretId } from "../services/connectors"
import { bindingId } from "../services/workspaces"

let migrationPromise: Promise<void> | null = null

export function migrateRepositoryScopedConnectorData(
  dataRepository: DataRepository,
  config: SynapseConfig,
  logger: StructuredLogger,
): Promise<void> {
  migrationPromise ??= runMigration(dataRepository, config, logger)
  return migrationPromise
}

async function runMigration(
  dataRepository: DataRepository,
  config: SynapseConfig,
  logger: StructuredLogger,
): Promise<void> {
  const projectIdByRepositoryId = resolveRepositoryProjectMap(config)

  if (projectIdByRepositoryId.size === 0) {
    return
  }

  const connectors = dataRepository.namespace<ConnectorEntryV1>("connectors")
  const workspaceBindings = dataRepository.namespace<WorkspaceBindingEntryV1>("workspace.bindings")
  const conversations = dataRepository.namespace<ConversationEntryV1>("conversations")

  await migrateConnectors(dataRepository, connectors, projectIdByRepositoryId, logger)
  await migrateConversations(conversations, projectIdByRepositoryId)
  await migrateWorkspaceBindings(workspaceBindings, projectIdByRepositoryId)

  logger.info("Project-scoped connector data migration checked.", {
    mappedRepositoryCount: projectIdByRepositoryId.size,
  })
}

function resolveRepositoryProjectMap(config: SynapseConfig): Map<string, string> {
  const projectIds = new Set(config.global.projects.map((project) => project.id))
  const projectIdByPath = new Map<string, string>()

  for (const project of config.global.projects) {
    const normalizedPath = normalizePathForMatch(project.path)
    if (!projectIdByPath.has(normalizedPath)) {
      projectIdByPath.set(normalizedPath, project.id)
    }
  }

  const result = new Map<string, string>()

  for (const repository of config.repositories) {
    if (projectIds.has(repository.uuid)) {
      continue
    }
    const projectId = projectIdByPath.get(normalizePathForMatch(repository.localPath))
    if (projectId) {
      result.set(repository.uuid, projectId)
    }
  }

  return result
}

async function migrateConnectors(
  dataRepository: DataRepository,
  connectors: DataNamespace<ConnectorEntryV1>,
  projectIdByRepositoryId: ReadonlyMap<string, string>,
  logger: StructuredLogger,
): Promise<void> {
  const entries = await connectors.list()

  for (const connector of entries) {
    const nextProjectId = projectIdByRepositoryId.get(connector.projectId)
    if (!nextProjectId || connector.platform !== "feishu") {
      continue
    }

    const nextConnectorId = `feishu:${nextProjectId}`
    const nextSecretRef = rewriteFeishuSecretRef(connector.secretRef, connector.projectId, nextProjectId)
    if (!await connectors.get(backupId("connectors", connector.id))) {
      await connectors.upsert({
        ...connector,
        id: backupId("connectors", connector.id),
        metadata: {
          ...recordValue(connector.metadata),
          migrationBackupOf: connector.id,
          migratedToProjectId: nextProjectId,
        },
      })
    }

    if (connector.secretRef !== nextSecretRef) {
      const copied = await copySecret(dataRepository, connector.projectId, nextProjectId, logger)
      if (!copied) {
        continue
      }
    }

    if (!await connectors.get(nextConnectorId)) {
      await connectors.upsert({
        ...connector,
        id: nextConnectorId,
        projectId: nextProjectId,
        secretRef: nextSecretRef,
        metadata: {
          ...recordValue(connector.metadata),
          migratedFromProjectId: connector.projectId,
          migratedFromConnectorId: connector.id,
        },
      })
    }
  }
}

async function migrateConversations(
  conversations: DataNamespace<ConversationEntryV1>,
  projectIdByRepositoryId: ReadonlyMap<string, string>,
): Promise<void> {
  const entries = await conversations.list()

  for (const conversation of entries) {
    const nextProjectId = projectIdByRepositoryId.get(conversation.projectId)
    if (!nextProjectId) {
      continue
    }
    await conversations.upsert({
      ...conversation,
      projectId: nextProjectId,
    })
  }
}

async function copySecret(
  dataRepository: DataRepository,
  previousProjectId: string,
  nextProjectId: string,
  logger: StructuredLogger,
): Promise<boolean> {
  const secrets = dataRepository.namespace<SecretEntryV1>("secrets")
  const previousSecretId = feishuSecretId(previousProjectId)
  const nextSecretId = feishuSecretId(nextProjectId)

  try {
    const [previousSecret, nextSecret] = await Promise.all([
      secrets.get(previousSecretId),
      secrets.get(nextSecretId),
    ])

    if (nextSecret) {
      return true
    }

    if (!previousSecret) {
      logger.warn("Skipped Feishu connector migration because source secret is missing.", {
        previousProjectId,
        nextProjectId,
      })
      return false
    }

    await secrets.upsert({
      ...previousSecret,
      id: nextSecretId,
      description: previousSecret.description ?? `Feishu credentials for ${nextProjectId}`,
    })
    return true
  } catch (error) {
    logger.warn("Failed to copy Feishu secret during project migration.", {
      error,
      previousProjectId,
      nextProjectId,
    })
    return false
  }
}

async function migrateWorkspaceBindings(
  workspaceBindings: DataNamespace<WorkspaceBindingEntryV1>,
  projectIdByRepositoryId: ReadonlyMap<string, string>,
): Promise<void> {
  const entries = await workspaceBindings.list()

  for (const binding of entries) {
    if (binding.scope !== "project" || !binding.projectId) {
      continue
    }
    const nextProjectId = projectIdByRepositoryId.get(binding.projectId)
    if (!nextProjectId) {
      continue
    }
    const nextId = bindingId("project", binding.channelKey, nextProjectId)
    if (!await workspaceBindings.get(nextId)) {
      await workspaceBindings.upsert({
        ...binding,
        id: nextId,
        projectId: nextProjectId,
      })
    }
  }
}

function rewriteFeishuSecretRef(
  secretRef: string | undefined,
  previousProjectId: string,
  nextProjectId: string,
): string | undefined {
  return secretRef === feishuSecretId(previousProjectId) ? feishuSecretId(nextProjectId) : secretRef
}

function normalizePathForMatch(value: string): string {
  return normalizePathForCompare(value, {
    platform: process.platform,
    resolvePath: path.resolve,
  })
}

function backupId(namespace: string, id: string): string {
  return `migration-backup:${namespace}:${Buffer.from(id).toString("base64url")}`
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
