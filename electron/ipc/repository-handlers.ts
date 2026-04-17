import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from "electron"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configStore } from "../services/config-store"
import { repositoryGitService } from "../services/repository-git-service"
import { createMainLogger } from "../services/log-store"
import { repositoryStore } from "../services/repository-store"

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
    SYNAPSE_IPC_CHANNELS.repository.sync,
    async (event, repositoryUuid: string) => {
      logger.info("Handling repository.sync request.", { repositoryUuid })
      const repository = await resolveRepositoryConfig(repositoryUuid)

      try {
        const result = await repositoryGitService.syncRepository(repository, (progressEvent) => {
          sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, progressEvent)
        })

        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
          repositoryUuid,
          operation: result.operation,
          completedAt: result.completedAt,
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

  handlersRegistered = true
}

export { registerRepositoryHandlers }
