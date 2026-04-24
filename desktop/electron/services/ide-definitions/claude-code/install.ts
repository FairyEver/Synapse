import type { EditorInstallStrategy } from "../types"
import { serializeClaudeCodeFrontmatter } from "../../editor-adapters/claude-code-frontmatter"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, ruleBody }) {
    const frontmatterPrefix = payload.claudeCodeFrontmatter
      ? serializeClaudeCodeFrontmatter(payload.claudeCodeFrontmatter)
      : ""
    return frontmatterPrefix + ruleBody
  },
}
