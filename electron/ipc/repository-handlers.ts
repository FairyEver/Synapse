import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from "electron"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { configStore } from "../services/config-store"
import { repositoryGitService } from "../services/repository-git-service"
import { repositoryStore } from "../services/repository-store"

let handlersRegistered = false

function sendToRenderer<T>(sender: WebContents, channel: string, payload: T): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}

async function resolveRepositoryConfig(repositoryUuid: string): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)

  if (!repository) {
    throw new Error("找不到对应的仓库配置。请先到 Settings 里确认仓库是否仍然存在。")
  }

  return repository
}

function registerRepositoryHandlers() {
  if (handlersRegistered) {
    return
  }

  ipcMain.handle(SYNAPSE_IPC_CHANNELS.repository.getStates, async () => {
    const config = await configStore.load()

    return Promise.all(
      config.repositories.map((repository) => repositoryStore.getRepositoryState(repository)),
    )
  })

  ipcMain.handle(
    SYNAPSE_IPC_CHANNELS.repository.chooseDirectory,
    async (event) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        properties: ["openDirectory"],
      }
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, options)
        : await dialog.showOpenDialog(options)

      return result.canceled ? null : result.filePaths[0] ?? null
    },
  )

  ipcMain.handle(
    SYNAPSE_IPC_CHANNELS.repository.sync,
    async (event, repositoryUuid: string) => {
      const repository = await resolveRepositoryConfig(repositoryUuid)
      const result = await repositoryGitService.syncRepository(repository, (progressEvent) => {
        sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.progress, progressEvent)
      })

      sendToRenderer(event.sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
        repositoryUuid,
        operation: result.operation,
        completedAt: result.completedAt,
      })

      return result
    },
  )

  handlersRegistered = true
}

export { registerRepositoryHandlers }
