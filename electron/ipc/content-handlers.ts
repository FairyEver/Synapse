import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron"
import path from "node:path"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import type { SynapseCreateRulePayload, SynapseCreateSkillPayload } from "../../src/types/content"
import { contentDownloadService } from "../services/content-download-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { contentService } from "../services/content-service"
import { createMainLogger } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.content")

async function chooseDownloadPath(
  ownerWindow: BrowserWindow | null,
  options: SaveDialogOptions,
): Promise<string | null> {
  const result = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, options)
    : await dialog.showSaveDialog(options)

  return result.canceled ? null : result.filePath ?? null
}

function registerContentHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getRules, async () => {
    logger.debug("Handling content.getRules request.")

    return contentService.getRules()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.createRule,
    async (_event, payload: SynapseCreateRulePayload) => {
      logger.info("Handling content.createRule request.", {
        title: payload.title,
      })

      return contentSubmissionService.createRule(payload)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.createSkill,
    async (_event, payload: SynapseCreateSkillPayload) => {
      logger.info("Handling content.createSkill request.", {
        attachmentCount: payload.files.length,
        title: payload.title,
      })

      return contentSubmissionService.createSkill(payload)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.downloadRule,
    async (event, ruleId: string) => {
      logger.info("Handling content.downloadRule request.", {
        ruleId,
      })

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
      logger.info("Handling content.downloadSkill request.", {
        skillId,
      })

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

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getSkills, async () => {
    logger.debug("Handling content.getSkills request.")

    return contentService.getSkills()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getRuleContent,
    async (_event, ruleId: string) => {
      logger.debug("Handling content.getRuleContent request.", {
        ruleId,
      })

      return contentService.getRuleContent(ruleId)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillContent,
    async (_event, skillId: string) => {
      logger.debug("Handling content.getSkillContent request.", {
        skillId,
      })

      return contentService.getSkillContent(skillId)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.content.getSkillFiles,
    async (_event, skillId: string) => {
      logger.debug("Handling content.getSkillFiles request.", {
        skillId,
      })

      return contentService.getSkillFiles(skillId)
    },
  )

  handlersRegistered = true
}

export { registerContentHandlers }
