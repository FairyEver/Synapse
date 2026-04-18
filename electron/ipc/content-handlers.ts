import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { contentService } from "../services/content-service"
import { createMainLogger } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.content")

function registerContentHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.content.getRules, async () => {
    logger.debug("Handling content.getRules request.")

    return contentService.getRules()
  })

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
