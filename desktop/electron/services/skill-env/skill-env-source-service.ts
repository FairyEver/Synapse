import { SKILL_ENV_EXAMPLE_PATH } from "../../../src/lib/content-attachments"
import { detectPlaceholders } from "../../../src/lib/variable-substitution"
import type {
  SynapseSkillEnvInspectionResult,
  SynapseSkillInstallerSource,
} from "../../../src/types/installers"
import { parseDotenvDocument } from "./dotenv-document"

export type SkillEnvSourceReader = {
  readMainContent(source: SynapseSkillInstallerSource): Promise<string>
  readTextAttachment(
    source: SynapseSkillInstallerSource,
    relativePath: string,
  ): Promise<string | null>
}

export class SkillEnvSourceService {
  constructor(private readonly reader: SkillEnvSourceReader) {}

  async inspect(source: SynapseSkillInstallerSource): Promise<SynapseSkillEnvInspectionResult> {
    const [mainContent, example] = await Promise.all([
      this.reader.readMainContent(source),
      this.reader.readTextAttachment(source, SKILL_ENV_EXAMPLE_PATH),
    ])
    const legacyPlaceholders = detectPlaceholders(mainContent, { includeCodeBlocks: true })
    const declarations = example === null
      ? []
      : parseDotenvDocument(example).entries.map(({ name, value }) => ({ name, defaultValue: value }))

    return { declarations, legacyPlaceholders }
  }
}
