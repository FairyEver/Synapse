import type { SynapseEditorInstallFormValues } from "../../types/editor"
import type { EditorInstallStrategy } from "../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import { applyRuleSection } from "../shared-rule-section"
import {
  parseWindsurfRuleFrontmatter,
  serializeWindsurfRuleFrontmatter,
  type WindsurfRuleFrontmatter,
  type WindsurfRuleTrigger,
} from "./frontmatter"

function readFrontmatterValues(
  values: SynapseEditorInstallFormValues | undefined,
): WindsurfRuleFrontmatter {
  const trigger = typeof values?.trigger === "string"
    ? values.trigger
    : "model_decision"

  return {
    trigger: isWindsurfRuleTrigger(trigger) ? trigger : "model_decision",
    description: typeof values?.description === "string" ? values.description : "",
    globs: typeof values?.globs === "string" ? values.globs : "",
  }
}

function isWindsurfRuleTrigger(value: string): value is WindsurfRuleTrigger {
  return value === "always_on"
    || value === "model_decision"
    || value === "glob"
    || value === "manual"
}

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    if (payload.scope === "global") {
      const existing = await readExistingTextFile(targetPath)
      return applyRuleSection(existing, payload.contentId, ruleBody)
    }

    const frontmatter = readFrontmatterValues(payload.installFormValues)
    return serializeWindsurfRuleFrontmatter(frontmatter) + ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
  async readRuleProjectFormValues({ targetPath, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return parseWindsurfRuleFrontmatter(existing)
  },
}
