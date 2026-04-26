import path from "node:path"

import type {
  ConnectorEntryV1,
  DataNamespace,
  DataRepository,
  HeartbeatEntryV1,
  ScheduledJobEntryV1,
  SecretEntryV1,
  WorkspaceBindingEntryV1,
} from "../runtime/data-repo"
import type { StructuredLogger } from "../runtime/service-registry"
import type { SynapseConfig } from "../../src/types/config"
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
  const scheduledJobs = dataRepository.namespace<ScheduledJobEntryV1>("scheduled.jobs")
  const heartbeats = dataRepository.namespace<HeartbeatEntryV1>("scheduled.heartbeat")

  await migrateConnectors(dataRepository, connectors, projectIdByRepositoryId, logger)
  await migrateWorkspaceBindings(workspaceBindings, projectIdByRepositoryId)
  await migrateScheduledJobs(scheduledJobs, projectIdByRepositoryId)
  await migrateHeartbeats(heartbeats, projectIdByRepositoryId)

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

    if (!await connectors.get(nextConnectorId)) {
      await connectors.upsert({
        ...connector,
        id: nextConnectorId,
        projectId: nextProjectId,
        secretRef: rewriteFeishuSecretRef(connector.secretRef, connector.projectId, nextProjectId),
        metadata: {
          ...recordValue(connector.metadata),
          migratedFromProjectId: connector.projectId,
          migratedFromConnectorId: connector.id,
        },
      })
    }

    await copySecret(dataRepository, connector.projectId, nextProjectId, logger)
  }
}

async function copySecret(
  dataRepository: DataRepository,
  previousProjectId: string,
  nextProjectId: string,
  logger: StructuredLogger,
): Promise<void> {
  const secrets = dataRepository.namespace<SecretEntryV1>("secrets")
  const previousSecretId = feishuSecretId(previousProjectId)
  const nextSecretId = feishuSecretId(nextProjectId)

  try {
    const [previousSecret, nextSecret] = await Promise.all([
      secrets.get(previousSecretId),
      secrets.get(nextSecretId),
    ])

    if (previousSecret && !nextSecret) {
      await secrets.upsert({
        ...previousSecret,
        id: nextSecretId,
        description: previousSecret.description ?? `Feishu credentials for ${nextProjectId}`,
      })
    }
  } catch (error) {
    logger.warn("Failed to copy Feishu secret during project migration.", {
      error,
      previousProjectId,
      nextProjectId,
    })
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

async function migrateScheduledJobs(
  scheduledJobs: DataNamespace<ScheduledJobEntryV1>,
  projectIdByRepositoryId: ReadonlyMap<string, string>,
): Promise<void> {
  const entries = await scheduledJobs.list()

  for (const job of entries) {
    const nextProjectId = projectIdByRepositoryId.get(job.projectId)
    if (!nextProjectId) {
      continue
    }
    const backupJobId = backupId("scheduled.jobs", job.id)
    if (!await scheduledJobs.get(backupJobId)) {
      await scheduledJobs.upsert({
        ...job,
        id: backupJobId,
        enabled: false,
        metadata: {
          ...recordValue(job.metadata),
          migrationBackupOf: job.id,
          migratedToProjectId: nextProjectId,
        },
      })
    }
    await scheduledJobs.upsert({
      ...job,
      projectId: nextProjectId,
      connectorId: rewriteFeishuConnectorId(job.connectorId, job.projectId, nextProjectId),
      updatedAt: new Date().toISOString(),
    })
  }
}

async function migrateHeartbeats(
  heartbeats: DataNamespace<HeartbeatEntryV1>,
  projectIdByRepositoryId: ReadonlyMap<string, string>,
): Promise<void> {
  const entries = await heartbeats.list()

  for (const heartbeat of entries) {
    const nextProjectId = projectIdByRepositoryId.get(heartbeat.projectId)
    if (!nextProjectId) {
      continue
    }
    const backupHeartbeatId = backupId("scheduled.heartbeat", heartbeat.id)
    if (!await heartbeats.get(backupHeartbeatId)) {
      await heartbeats.upsert({
        ...heartbeat,
        id: backupHeartbeatId,
        enabled: false,
        paused: true,
        metadata: {
          ...recordValue(heartbeat.metadata),
          migrationBackupOf: heartbeat.id,
          migratedToProjectId: nextProjectId,
        },
      })
    }
    await heartbeats.upsert({
      ...heartbeat,
      projectId: nextProjectId,
      connectorId: rewriteFeishuConnectorId(heartbeat.connectorId, heartbeat.projectId, nextProjectId),
      updatedAt: new Date().toISOString(),
    })
  }
}

function rewriteFeishuConnectorId(
  connectorId: string,
  previousProjectId: string,
  nextProjectId: string,
): string {
  return connectorId === `feishu:${previousProjectId}` ? `feishu:${nextProjectId}` : connectorId
}

function rewriteFeishuSecretRef(
  secretRef: string | undefined,
  previousProjectId: string,
  nextProjectId: string,
): string | undefined {
  return secretRef === feishuSecretId(previousProjectId) ? feishuSecretId(nextProjectId) : secretRef
}

function normalizePathForMatch(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, "")
}

function backupId(namespace: string, id: string): string {
  return `migration-backup:${namespace}:${Buffer.from(id).toString("base64url")}`
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
