import { app, BrowserWindow, dialog, type SaveDialogOptions, type WebContents } from "electron"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type {
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseInstallToEditorPayload,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configStore } from "../services/config-store"
import { contentDownloadService } from "../services/content-download-service"
import { contentInstallService } from "../services/content-install-service"
import { contentService } from "../services/content-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { editorAdapterService } from "../services/editor-adapter-service"
import { createMainLogger } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.content")
const backgroundPushStates = new Map<string, { rerunRequested: boolean }>()

function sendToRenderer<T>(sender: WebContents, channel: string, payload: T): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}

async function chooseDownloadPath(
  ownerWindow: BrowserWindow | null,
  options: SaveDialogOptions,
): Promise<string | null> {
  const result = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, options)
    : await dialog.showSaveDialog(options)

  return result.canceled ? null : result.filePath ?? null
}

async function resolveActiveRepository(): Promise<SynapseRepositoryConfig | null> {
  const config = await configStore.load()

  return getActiveRepositoryConfig(config)
}

function sendPendingPushesUpdated(
  sender: WebContents,
  repositoryUuid: string,
  pendingPushes: Awaited<ReturnType<typeof contentSubmissionService.readPendingPushState>>,
): void {
  sendToRenderer(sender, SYNAPSE_IPC_CHANNELS.repository.pendingPushesUpdated, {
    repositoryUuid,
    pendingPushes,
  })
}

function sendBackgroundPushUpdated(
  sender: WebContents,
  repositoryUuid: string,
  payload: {
    error?: string
    message?: string
  } = {},
): void {
  sendToRenderer(sender, SYNAPSE_IPC_CHANNELS.repository.updated, {
    repositoryUuid,
    operation: "push",
    completedAt: new Date().toISOString(),
    error: payload.error,
    message: payload.message,
  })
}

async function notifyPendingPushesUpdated(
  sender: WebContents,
  repository: SynapseRepositoryConfig | null = null,
): Promise<void> {
  const resolvedRepository = repository ?? await resolveActiveRepository()

  if (!resolvedRepository) {
    return
  }

  const pendingPushes = await contentSubmissionService.readPendingPushState(resolvedRepository)
  sendPendingPushesUpdated(sender, resolvedRepository.uuid, pendingPushes)
}

function scheduleBackgroundPush(sender: WebContents, repository: SynapseRepositoryConfig): void {
  const activeState = backgroundPushStates.get(repository.uuid)

  if (activeState) {
    activeState.rerunRequested = true
    return
  }

  const nextState = {
    rerunRequested: false,
  }

  backgroundPushStates.set(repository.uuid, nextState)

  void (async () => {
    try {
      while (true) {
        nextState.rerunRequested = false
        sendToRenderer(sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
          repositoryUuid: repository.uuid,
          operation: "push",
          statusText: "正在同步...",
          percent: 0,
        })

        try {
          await contentSubmissionService.flushPendingPushes(repository, (statusText) => {
            sendToRenderer(sender, SYNAPSE_IPC_CHANNELS.repository.progress, {
              repositoryUuid: repository.uuid,
              operation: "push",
              statusText,
              percent: null,
            })
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "推送到仓库失败。"

          await notifyPendingPushesUpdated(sender, repository)
          sendBackgroundPushUpdated(sender, repository.uuid, {
            error: message,
            message,
          })
          return
        }

        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        sendPendingPushesUpdated(sender, repository.uuid, pendingPushes)

        if (nextState.rerunRequested || pendingPushes.count > 0) {
          continue
        }

        sendBackgroundPushUpdated(sender, repository.uuid, {
          message: "同步完成。",
        })
        return
      }
    } finally {
      backgroundPushStates.delete(repository.uuid)
    }
  })()
}

function registerContentHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getRules, async () => {
    return contentService.getRules()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getSkills, async () => {
    return contentService.getSkills()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getEditorAdapters, async () => {
    return editorAdapterService.listAdapters()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.createRule,
    async (event, payload: SynapseCreateRulePayload) => {
      logger.info("Handling content.createRule request.", {
        title: payload.title,
      })

      const result = await contentSubmissionService.createRule(payload)
      const repository = await resolveActiveRepository()

      await notifyPendingPushesUpdated(event.sender, repository)

      if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
        scheduleBackgroundPush(event.sender, repository)
      }

      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.createSkill,
    async (event, payload: SynapseCreateSkillPayload) => {
      logger.info("Handling content.createSkill request.", {
        attachmentCount: payload.files.length,
        title: payload.title,
      })

      const result = await contentSubmissionService.createSkill(payload)
      const repository = await resolveActiveRepository()

      await notifyPendingPushesUpdated(event.sender, repository)

      if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
        scheduleBackgroundPush(event.sender, repository)
      }

      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.updateRule,
    async (event, payload: SynapseUpdateRulePayload) => {
      const result = await contentSubmissionService.updateRule(payload)
      const repository = await resolveActiveRepository()

      await notifyPendingPushesUpdated(event.sender, repository)

      if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
        scheduleBackgroundPush(event.sender, repository)
      }

      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.updateSkill,
    async (event, payload: SynapseUpdateSkillPayload) => {
      const result = await contentSubmissionService.updateSkill(payload)
      const repository = await resolveActiveRepository()

      await notifyPendingPushesUpdated(event.sender, repository)

      if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
        scheduleBackgroundPush(event.sender, repository)
      }

      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.deleteContent,
    async (event, payload: SynapseDeleteContentPayload) => {
      const result = await contentSubmissionService.deleteContent(payload)
      await notifyPendingPushesUpdated(event.sender)
      return result
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.downloadRule,
    async (event, ruleId: string) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const filePath = await chooseDownloadPath(ownerWindow, {
        buttonLabel: "下载",
        defaultPath: path.join(app.getPath("downloads"), `${ruleId}.md`),
        filters: [
          { extensions: ["md"], name: "Markdown" },
        ],
      })

      if (!filePath) {
        return {
          canceled: true,
          filePath: null,
        }
      }

      await contentDownloadService.downloadRule(ruleId, filePath)

      return {
        canceled: false,
        filePath,
      }
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.downloadSkill,
    async (event, skillId: string) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const filePath = await chooseDownloadPath(ownerWindow, {
        buttonLabel: "下载",
        defaultPath: path.join(app.getPath("downloads"), `${skillId}.zip`),
        filters: [
          { extensions: ["zip"], name: "Zip Archive" },
        ],
      })

      if (!filePath) {
        return {
          canceled: true,
          filePath: null,
        }
      }

      await contentDownloadService.downloadSkill(skillId, filePath)

      return {
        canceled: false,
        filePath,
      }
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getRuleContent,
    async (_event, ruleId: string) => contentService.getRuleContent(ruleId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillContent,
    async (_event, skillId: string) => contentService.getSkillContent(skillId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getRuleDetail,
    async (_event, ruleId: string) => contentService.getRuleDetail(ruleId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillDetail,
    async (_event, skillId: string) => contentService.getSkillDetail(skillId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getRuleHistory,
    async (_event, ruleId: string) => contentService.getRuleHistory(ruleId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillHistory,
    async (_event, skillId: string) => contentService.getSkillHistory(skillId),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getRuleHistoryVersion,
    async (_event, ruleId: string, historyDirname: string) =>
      contentService.getRuleHistoryVersion(ruleId, historyDirname),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillHistoryVersion,
    async (_event, skillId: string, historyDirname: string) =>
      contentService.getSkillHistoryVersion(skillId, historyDirname),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.resolveEditorInstallTarget,
    async (_event, payload: SynapseResolveEditorTargetPayload) => {
      return editorAdapterService.resolveTarget(payload)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.installToEditor,
    async (_event, payload: SynapseInstallToEditorPayload) => {
      return contentInstallService.installToEditor(payload)
    },
  )

  handlersRegistered = true
}

export { registerContentHandlers }
