import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { slugifySkillName } from "../../src/definitions/editor/shared-skill-frontmatter"
import { normalizeContentNameInput, validateContentNameInput } from "../../src/lib/content-name-input"
import { normalizeSkillNameInput, validateSkillNameInput } from "../../src/lib/skill-name-input"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "../../src/types/installers"
import {
  readSkillDraftFromDirectory,
  resolveRootSkillMainFile,
  type ContentSkillSourceDraft,
} from "./content-skill-source-service"
import {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
} from "./installer-source-identity"

type StoredLocalSkillSource = {
  draft: ContentSkillSourceDraft
  source: SynapseSkillInstallerSource
}

type StoredInlineRuleSource = {
  source: SynapseRuleInstallerSource
}

class InstallerSourceService {
  private readonly inlineRules = new Map<string, StoredInlineRuleSource>()
  private readonly localSkills = new Map<string, StoredLocalSkillSource>()

  async prepareLocalSkillSource(
    payload: SynapsePrepareLocalSkillSourcePayload,
  ): Promise<SynapseSkillInstallerSource> {
    const rootMainFile = await resolveRootSkillMainFile(payload.sourceDirectoryPath)
    if (!rootMainFile || path.basename(rootMainFile) !== "SKILL.md") {
      throw new Error("Skill 安装器需要根目录 SKILL.md。")
    }

    const draft = await readSkillDraftFromDirectory(payload.sourceDirectoryPath)
    const realSourceDirectoryPath = await realpath(draft.sourceDirectoryPath)
    const fallbackName = slugifySkillName(path.basename(realSourceDirectoryPath), "synapse-skill")
    const metadataName = normalizeSkillNameInput(draft.metadata.name ?? "")
    const name = validateSkillNameInput(metadataName) === null
      ? metadataName
      : fallbackName
    const nameError = validateSkillNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const localSourceId = randomUUID()
    const source: SynapseSkillInstallerSource = {
      kind: "skill",
      origin: "local-directory",
      sourceIdentity: createLocalSkillSourceIdentity(realSourceDirectoryPath),
      localSourceId,
      name,
      title: draft.metadata.title?.trim() || name,
      description: draft.metadata.description?.trim() ?? "",
      mainContent: draft.content,
    }

    this.localSkills.set(localSourceId, { draft, source })
    return source
  }

  async prepareInlineRuleSource(
    payload: SynapsePrepareInlineRuleSourcePayload,
  ): Promise<SynapseRuleInstallerSource> {
    const name = normalizeContentNameInput(payload.name)
    const nameError = validateContentNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const body = payload.body.trim()
    if (!body) {
      throw new Error("Rule 正文不能为空。")
    }

    const inlineSourceId = randomUUID()
    const source: SynapseRuleInstallerSource = {
      kind: "rule",
      origin: "inline",
      sourceIdentity: createInlineRuleSourceIdentity(name, body),
      inlineSourceId,
      name,
      title: name,
      description: "",
      body,
    }

    this.inlineRules.set(inlineSourceId, { source })
    return source
  }

  getInlineRule(inlineSourceId: string): StoredInlineRuleSource {
    const stored = this.inlineRules.get(inlineSourceId)
    if (!stored) {
      throw new Error("Rule 安装源不可用。")
    }
    return stored
  }

  getLocalSkill(localSourceId: string): StoredLocalSkillSource {
    const stored = this.localSkills.get(localSourceId)
    if (!stored) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    return stored
  }
}

const installerSourceService = new InstallerSourceService()

export {
  InstallerSourceService,
  installerSourceService,
}
