import type { PreparedContentInstallSourceProvider } from "../../../electron/services/editor-install-service"
import { synapseSkillService } from "./service"

const synapseSkillPreparedSourceProvider: PreparedContentInstallSourceProvider = {
  hasPreparedSource(sourceId, contentId) {
    return synapseSkillService.hasPreparedSource(sourceId, contentId)
  },
  async readPreparedRule() {
    throw new Error("Synapse Skill prepared source is not a Rule.")
  },
  readPreparedSkill(sourceId, contentId) {
    return synapseSkillService.readPreparedSkill(sourceId, contentId)
  },
  readPreparedSkillAttachmentText(sourceId, contentId, relativePath) {
    return synapseSkillService.readPreparedSkillAttachmentText(sourceId, contentId, relativePath)
  },
  beginPreparedInstall(sourceId, contentId) {
    return synapseSkillService.beginPreparedInstall(sourceId, contentId)
  },
  endPreparedInstall(sourceId, contentId) {
    return synapseSkillService.endPreparedInstall(sourceId, contentId)
  },
  copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath) {
    return synapseSkillService.copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath)
  },
  markPreparedInstalled(sourceId, contentId) {
    return synapseSkillService.markPreparedInstalled(sourceId, contentId)
  },
}

export { synapseSkillPreparedSourceProvider }
