import { describe, expect, it } from "vitest"
import {
  buildSkillRepositoryManagementUrl,
  normalizeSkillRepositoryName,
  normalizeUserHandle,
  skillRepositoryNameMaxLength,
  skillRepositoryErrorCodes,
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
  })

  it("builds dashboard management urls by stable repository id", () => {
    expect(buildSkillRepositoryManagementUrl("https://synapse.example/", "repo_1"))
      .toBe("https://synapse.example/console/skill-repositories/repo_1")
  })
})
