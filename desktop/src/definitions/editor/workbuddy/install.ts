import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent() {
    throw new Error("WorkBuddy 暂不支持 Rule 安装。")
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}
