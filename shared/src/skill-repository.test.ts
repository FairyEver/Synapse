import { describe, expect, it } from "vitest"
import {
  appendSkillRepositoryInstallSessionToDeepLink,
  buildSkillRepositoryPublicUrl,
  buildSkillRepositoryManagementUrl,
  buildSkillRepositorySettingsUrl,
  defaultSkillRepositoryInstallDeepLinkBase,
  normalizeSkillRepositoryName,
  normalizeUserHandle,
  skillRepositoryNameMaxLength,
  skillRepositoryErrorCodes,
  type SkillRepositoryLegacyContentRouteDto,
  type SkillRepositoryLegacyMigrationResultDto,
  userHandleMaxLength,
} from "./skill-repository.js"

describe("skill repository shared helpers", () => {
  it("normalizes repository names with the existing Skill machine-name shape", () => {
    expect(normalizeSkillRepositoryName(" Demo-Skill ")).toBe("demo-skill")
    expect(() => normalizeSkillRepositoryName("demo.skill")).toThrow("仓库名不能包含点。")
    expect(() => normalizeSkillRepositoryName("con")).toThrow("仓库名不能使用 Windows 保留名称。")
  })

  it("normalizes user handles for URL identity", () => {
    expect(normalizeUserHandle(" Li-Yang ")).toBe("li-yang")
    expect(() => normalizeUserHandle("li.yang")).toThrow("用户名不能包含点。")
    expect(() => normalizeUserHandle("-liyang")).toThrow("用户名必须以字母或数字开头和结尾。")
    expect(() => normalizeUserHandle("console")).toThrow("用户名不能使用保留路由名称。")
  })

  it("enforces exported identifier length limits", () => {
    expect(normalizeSkillRepositoryName("a".repeat(skillRepositoryNameMaxLength))).toBe("a".repeat(skillRepositoryNameMaxLength))
    expect(() => normalizeSkillRepositoryName("a".repeat(skillRepositoryNameMaxLength + 1))).toThrow("仓库名不能超过 64 个字符。")
    expect(normalizeUserHandle("u".repeat(userHandleMaxLength))).toBe("u".repeat(userHandleMaxLength))
    expect(() => normalizeUserHandle("u".repeat(userHandleMaxLength + 1))).toThrow("用户名不能超过 64 个字符。")
  })

  it("exports stable structured error codes", () => {
    expect(skillRepositoryErrorCodes).toContain("USER_HANDLE_REQUIRED")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_NAME_CONFLICT")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_INVALID_SKILL")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_INSTALL_SESSION_NOT_FOUND")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING")
  })

  it("builds dashboard management urls by stable repository id", () => {
    expect(buildSkillRepositoryManagementUrl("https://synapse.example/", "repo_1"))
      .toBe("https://synapse.example/console/skill-repositories/repo_1")
  })

  it("builds public repository urls by owner handle and repository name", () => {
    expect(buildSkillRepositoryPublicUrl("https://synapse.example/", "alice", "demo-skill"))
      .toBe("https://synapse.example/console/skills/alice/demo-skill")
  })

  it("builds profile settings urls for missing public handles", () => {
    expect(buildSkillRepositorySettingsUrl("https://synapse.example/"))
      .toBe("https://synapse.example/console/settings/profile")
  })

  it("builds skill install deep links", () => {
    expect(defaultSkillRepositoryInstallDeepLinkBase).toBe("synapse://skill-install")
    expect(appendSkillRepositoryInstallSessionToDeepLink(defaultSkillRepositoryInstallDeepLinkBase, "session-1"))
      .toBe("synapse://skill-install?session=session-1")
  })
})

describe("legacy Content Store migration contracts", () => {
  it("allows migrated routes to describe either a repository redirect or retired content", () => {
    const skillRoute: SkillRepositoryLegacyContentRouteDto = {
      status: "migrated",
      repositoryId: "repo-1",
      managementUrl: buildSkillRepositoryManagementUrl("https://synapse.example", "repo-1"),
      publicUrl: buildSkillRepositoryPublicUrl("https://synapse.example", "liyang", "demo-skill"),
    }
    const retiredRoute: SkillRepositoryLegacyContentRouteDto = {
      status: "retired",
      contentType: "prompt",
      message: "云端 Prompt 商店已停止维护。",
    }

    expect(skillRoute.status).toBe("migrated")
    expect(retiredRoute.status).toBe("retired")
  })

  it("summarizes idempotent migration results", () => {
    const result: SkillRepositoryLegacyMigrationResultDto = {
      scanned: 3,
      migrated: 1,
      alreadyMigrated: 1,
      skipped: [
        {
          contentStoreItemId: "content-rule-1",
          reason: "not_skill",
        },
      ],
      warnings: [
        {
          contentStoreItemId: "content-skill-2",
          code: "USER_HANDLE_REQUIRED",
          message: "公开 Skill 需要先设置用户名。",
        },
        {
          contentStoreItemId: "content-skill-3",
          code: "SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING",
          message: "旧 Skill 复制来源尚未迁移。",
        },
      ],
    }

    expect(result.scanned).toBe(3)
    expect(result.skipped[0]?.reason).toBe("not_skill")
    expect(result.warnings[0]?.code).toBe("USER_HANDLE_REQUIRED")
    expect(result.warnings[1]?.code).toBe("SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING")
  })
})
