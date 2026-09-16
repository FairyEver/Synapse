import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent() {
    throw new Error("WorkBuddy 仅支持 Skill 安装。")
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}
