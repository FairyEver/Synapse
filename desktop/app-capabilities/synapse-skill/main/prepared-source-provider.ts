import type { PreparedContentInstallSourceProvider } from "../../../electron/services/editor-install-service"
import type { SynapseSkillService } from "./service"

function createSynapseSkillPreparedSourceProvider(
  service: SynapseSkillService,
): PreparedContentInstallSourceProvider {
  return {
    hasPreparedSource(sourceId, contentId) {
      return service.hasPreparedSource(sourceId, contentId)
    },
    async readPreparedRule() {
      throw new Error("Synapse Skill prepared source is not a Rule.")
    },
    readPreparedSkill(sourceId, contentId) {
      return service.readPreparedSkill(sourceId, contentId)
    },
    readPreparedSkillAttachmentText(sourceId, contentId, relativePath) {
      return service.readPreparedSkillAttachmentText(sourceId, contentId, relativePath)
    },
    beginPreparedInstall(sourceId, contentId) {
      return service.beginPreparedInstall(sourceId, contentId)
    },
    endPreparedInstall(sourceId, contentId) {
      return service.endPreparedInstall(sourceId, contentId)
    },
    copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath) {
      return service.copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath)
    },
    markPreparedInstalled(sourceId, contentId) {
      return service.markPreparedInstalled(sourceId, contentId)
    },
  }
}

export { createSynapseSkillPreparedSourceProvider }
