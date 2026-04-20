import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from "electron"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseCreateLocalRepositoryPayload } from "../../src/types/repository"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configStore } from "../services/config-store"
import { contentIndexService } from "../services/content-index-service"
import { repositoryMaintenanceService } from "../services/repository-maintenance-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { repositoryGitService } from "../services/repository-git-service"
import { createMainLogger } from "../services/log-store"
import { repositoryStore } from "../services/repository-store"
import { repositoryStructureService } from "../services/repository-structure-service"
import type { SynapseRepositoryValidationResult } from "../../src/types/repository"

let handlersRegistered = false
const logger = createMainLogger("ipc.repository")

function sendToRenderer<T>(sender: WebContents, channel: string, payload: T): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}

async function resolveRepositoryConfig(repositoryUuid: string): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)

  if (!repository) {
    logger.warn("Repository config lookup failed.", { repositoryUuid })
    throw new Error("找不到对应的仓库配置。请先到 Settings 里确认仓库是否仍然存在。")
  }

  return repository
}

function registerRepositoryHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.repository.getStates, async () => {
    logger.debug("Handling repository.getStates request.")
    const config = await configStore.load()
    const states = await Promise.all(
      config.repositories.map((repository) => repositoryStore.getRepositoryState(repository)),
    )

    logger.debug("Repository states resolved for renderer.", {
      repositoryCount: config.repositories.length,
    })

    return states
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.checkInitializationPreview,
    async (_event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)
      return repositoryStructureService.checkInitializationPreview(repository)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.createLocalRepository,
    async (_event, payload: SynapseCreateLocalRepositoryPayload) => {
      logger.info("Handling repository.createLocalRepository request.", {
        name: payload.name,
        parentPath: payload.parentPath,
      })

      return repositoryStructureService.createLocalRepository(payload)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.getPendingPushes,
    async (_event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)
      return contentSubmissionService.readPendingPushState(repository)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.initializeStructure,
    async (event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)

      sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
        repositoryUuid,
        operation: "initialize",
        statusText: "正在初始化仓库...",
        percent: 0,
      })

      const result = await repositoryStructureService.initializeStructure(repository)
      const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

      sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
        repositoryUuid,
        operation: "initialize",
        completedAt: result.initializedAt,
        message: result.message,
      })
      sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.pendingPushesUpdated, {
        repositoryUuid,
        pendingPushes,
      })

      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.chooseDirectory,
    async (event) => {
      logger.info("Opening native directory picker.")
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        properties: ["openDirectory"],
      }
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, options)
        : await dialog.showOpenDialog(options)

      const selectedPath = result.canceled ? null : result.filePaths[0] ?? null

      logger.info("Native directory picker closed.", {
        canceled: result.canceled,
        selectedPath,
      })

      return selectedPath
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.validateDirectory,
    async (_event, targetPath: string): Promise<SynapseRepositoryValidationResult> => {
      logger.info("Validating directory structure.", { targetPath })
      await repositoryStructureService.ensureContentDirectories(targetPath)
      return repositoryStructureService.validateDirectoryStructure(targetPath)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.sync,
    async (event, repositoryUuid: string) => {
      logger.info("Handling repository.sync request.", { repositoryUuid })
      const repository = await resolveRepositoryConfig(repositoryUuid)

      try {
        const result = await repositoryGitService.syncRepository(repository, (progressEvent) => {
          sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, progressEvent)
        })
        await contentIndexService.syncIndex(repository)
        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
          repositoryUuid,
          operation: result.operation,
          completedAt: result.completedAt,
        })
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.pendingPushesUpdated, {
          repositoryUuid,
          pendingPushes,
        })

        logger.info("repository.sync request completed.", {
          repositoryUuid,
          completedAt: result.completedAt,
        })

        return result
      } catch (error) {
        logger.error("repository.sync request failed.", {
          repositoryUuid,
          error,
        })
        throw error
      }
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.runMaintenance,
    async (event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)

      try {
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
          repositoryUuid,
          operation: "maintenance",
          statusText: "正在准备整理...",
          percent: 0,
        })
        const maintenanceResult = await repositoryMaintenanceService.runManualMaintenance(
          repository,
          (statusText) => {
            sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
              repositoryUuid,
              operation: "maintenance",
              statusText,
              percent: null,
            })
          },
        )
        const repositoryState = await repositoryStore.getRepositoryState(repository)
        const completedAt = new Date().toISOString()
        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
          repositoryUuid,
          operation: "maintenance",
          completedAt,
        })
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.pendingPushesUpdated, {
          repositoryUuid,
          pendingPushes,
        })

        return {
          operation: "maintenance" as const,
          repository: repositoryState,
          completedAt,
          message: maintenanceResult.message,
          pendingPushCount: maintenanceResult.pendingPushCount,
        }
      } catch (error) {
        logger.error("repository.runMaintenance request failed.", {
          repositoryUuid,
          error,
        })
        throw error
      }
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.repository.flushPendingPushes,
    async (event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)

      try {
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
          repositoryUuid,
          operation: "push",
          statusText: "正在准备推送...",
          percent: 0,
        })
        await contentSubmissionService.flushPendingPushes(repository, (statusText) => {
          sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
            repositoryUuid,
            operation: "push",
            statusText,
            percent: null,
          })
        })
        const repositoryState = await repositoryStore.getRepositoryState(repository)
        const completedAt = new Date().toISOString()
        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
          repositoryUuid,
          operation: "push",
          completedAt,
        })
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.pendingPushesUpdated, {
          repositoryUuid,
          pendingPushes,
        })

        return {
          operation: "push" as const,
          repository: repositoryState,
          completedAt,
        }
      } catch (error) {
        logger.error("repository.flushPendingPushes request failed.", {
          repositoryUuid,
          error,
        })
        throw error
      }
    },
  )

  handlersRegistered = true
}

export { registerRepositoryHandlers }
