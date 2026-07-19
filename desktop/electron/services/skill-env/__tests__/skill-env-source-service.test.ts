import { describe, expect, it, vi } from "vitest"

import { SKILL_ENV_MAX_VARIABLES } from "../../../../config"
import type { SynapseSkillInstallerSource } from "../../../../src/types/installers"
import { SkillEnvSourceService } from "../skill-env-source-service"
import { SKILL_RUNTIME_ENV_MAX_BYTES } from "../file-policy"

const source: SynapseSkillInstallerSource = {
  kind: "skill",
  origin: "local-directory",
  sourceIdentity: "local-skill:test",
  localSourceId: "local-1",
  name: "test-skill",
}

describe("SkillEnvSourceService", () => {
  it("inspects dotenv declarations and legacy placeholders including code blocks", async () => {
    const reader = {
      readMainContent: vi.fn().mockResolvedValue([
        "Token: ${{ LEGACY_TOKEN }}",
        "```env",
        "OTHER=${{ CODE_TOKEN }}",
        "```",
      ].join("\n")),
      readTextAttachment: vi.fn().mockResolvedValue("# defaults\nTOKEN=default\nURL='https://example.com'\n"),
    }

    await expect(new SkillEnvSourceService(reader).inspect(source)).resolves.toEqual({
      declarations: [
        { name: "TOKEN", defaultValue: "default" },
        { name: "URL", defaultValue: "https://example.com" },
      ],
      legacyPlaceholders: ["LEGACY_TOKEN", "CODE_TOKEN"],
    })
    expect(reader.readTextAttachment).toHaveBeenCalledWith(source, ".env.example")
  })

  it("returns no declarations when the source has no .env.example", async () => {
    const reader = {
      readMainContent: vi.fn().mockResolvedValue("# Skill\n"),
      readTextAttachment: vi.fn().mockResolvedValue(null),
    }

    await expect(new SkillEnvSourceService(reader).inspect(source)).resolves.toEqual({
      declarations: [],
      legacyPlaceholders: [],
    })
  })

  it("rejects an oversized .env.example before parsing declarations", async () => {
    const reader = {
      readMainContent: vi.fn().mockResolvedValue("# Skill\n"),
      readTextAttachment: vi.fn().mockResolvedValue(
        "x".repeat(Number(SKILL_RUNTIME_ENV_MAX_BYTES) + 1),
      ),
    }

    await expect(new SkillEnvSourceService(reader).inspect(source))
      .rejects.toThrow("Skill .env 不能超过 1 MiB。")
  })

  it("rejects .env.example files with too many declarations", async () => {
    const reader = {
      readMainContent: vi.fn().mockResolvedValue("# Skill\n"),
      readTextAttachment: vi.fn().mockResolvedValue(
        Array.from({ length: SKILL_ENV_MAX_VARIABLES + 1 }, (_, index) => `KEY_${index}=`).join("\n"),
      ),
    }

    await expect(new SkillEnvSourceService(reader).inspect(source))
      .rejects.toThrow(`Skill .env.example 最多声明 ${SKILL_ENV_MAX_VARIABLES} 个环境变量。`)
  })
})
