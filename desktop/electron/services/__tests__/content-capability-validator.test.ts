import { describe, expect, it } from "vitest"
import { SYNAPSE_CONTENT_COLOR_OPTIONS } from "../../../src/lib/content-appearance-options"
import { ContentCapabilityError } from "../content-capability-errors"
import {
  describeContentTypes,
  normalizeCreateContentParams,
  normalizeDeleteContentParams,
  normalizeUpdateContentParams,
} from "../content-capability-validator"

const validRuleParams = {
  name: "team-rule",
  title: "Team Rule",
  description: "Keep output concise.",
  category: "coding",
  iconType: "icon",
  icon: "wrench",
  iconBg: "graphite",
  content: "# Rule\n\nUse this.",
}

describe("content capability validator", () => {
  it("describes content categories and shared appearance options", () => {
    const description = describeContentTypes("rule")

    expect(description.types).toHaveLength(1)
    expect(description.types[0]?.id).toBe("rule")
    expect(description.types[0]?.categories.some((category) => category.id === "coding")).toBe(true)
    expect(description.appearance.icons.some((icon) => icon.value === "wrench")).toBe(true)
    expect(description.appearance.backgroundColors).toBe(SYNAPSE_CONTENT_COLOR_OPTIONS)
    expect(description.constraints.skillAttachmentMaxCount).toBeGreaterThan(0)
  })

  it("normalizes a rule create payload", () => {
    const payload = normalizeCreateContentParams("rule", validRuleParams)

    expect(payload).toMatchObject({
      name: "team-rule",
      title: "Team Rule",
      description: "Keep output concise.",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      iconImage: "",
      content: "# Rule\n\nUse this.",
    })
  })

  it("rejects invalid categories", () => {
    expect(() => normalizeCreateContentParams("rule", {
      ...validRuleParams,
      category: "nope",
    })).toThrow(ContentCapabilityError)
  })

  it("rejects unsupported icon values", () => {
    expect(() => normalizeCreateContentParams("rule", {
      ...validRuleParams,
      icon: "unknown",
    })).toThrow(ContentCapabilityError)
  })

  it("requires exactly one icon image input for image icons", () => {
    expect(() => normalizeCreateContentParams("prompt", {
      title: "Prompt",
      description: "Prompt description.",
      category: "coding",
      iconType: "image",
      iconImagePath: "/tmp/icon.png",
      iconImageBase64: Buffer.from("image").toString("base64"),
      content: "Write tests.",
    })).toThrow(ContentCapabilityError)
  })

  it("allows update payloads to preserve an existing icon image reference", () => {
    const payload = normalizeUpdateContentParams("skill", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "image",
      iconImage: "icon.png",
      content: "# Skill",
      files: [],
    })

    expect(payload).toMatchObject({
      icon: "",
      iconBg: "",
      iconType: "image",
      iconImage: "icon.png",
    })
  })

  it("normalizes skill attachment paths and bytes", () => {
    const payload = normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [{
        path: " references\\guide.md ",
        contentText: "hello",
      }],
    })

    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]?.originalName).toBe("references/guide.md")
    expect(payload.files[0]?.size).toBe(5)
    expect(Buffer.from(payload.files[0]?.bytes ?? []).toString("utf8")).toBe("hello")
  })

  it("normalizes valid skill attachment base64", () => {
    const payload = normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [{
        path: "references/guide.md",
        contentBase64: Buffer.from("hello").toString("base64"),
      }],
    })

    expect(Buffer.from(payload.files[0]?.bytes ?? []).toString("utf8")).toBe("hello")
  })

  it("rejects invalid skill attachment base64", () => {
    expect(() => normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [{
        path: "references/guide.md",
        contentBase64: "not valid %",
      }],
    })).toThrow(ContentCapabilityError)

    expect(() => normalizeUpdateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      files: [{
        path: "references/guide.md",
        contentBase64: "abcd=",
      }],
    })).toThrow(ContentCapabilityError)
  })

  it("rejects duplicate skill attachment paths after normalization", () => {
    expect(() => normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [
        { path: "refs/a.md", contentText: "a" },
        { path: "refs\\a.md", contentText: "b" },
      ],
    })).toThrow(ContentCapabilityError)
  })

  it("rejects skill attachments that target generated install files", () => {
    expect(() => normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [{ path: "SKILL.md", contentText: "# Replacement" }],
    })).toThrowError("附件路径不能使用 Skill 安装保留文件：SKILL.md")

    expect(() => normalizeUpdateContentParams("skill", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [{ path: ".synapse.json", contentText: "{}" }],
    })).toThrowError("附件路径不能使用 Skill 安装保留文件：.synapse.json")
  })

  it("rejects files and sourceDirectoryPath together", () => {
    expect(() => normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      sourceDirectoryPath: "/tmp/skill",
      files: [{ path: "SKILL.md", contentText: "# Skill" }],
    })).toThrow(ContentCapabilityError)
  })

  it("keeps sourceDirectoryPath skill creates valid after inline fields are merged", () => {
    const payload = normalizeCreateContentParams("skill", {
      name: "test-skill",
      title: "Test Skill",
      description: "Skill description.",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      sourceDirectoryPath: "/tmp/skill",
    })

    expect(payload.name).toBe("test-skill")
    expect(payload.files).toEqual([])
  })

  it("explains Skill create alternatives when inline fields and sourceDirectoryPath are missing", () => {
    expect(() => normalizeCreateContentParams("skill", {
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
    })).toThrowError("创建 Skill 请提供完整字段 name/title/description/category/content，或提供 sourceDirectoryPath。")
  })

  it("explains Skill update alternatives when inline fields and sourceDirectoryPath are missing", () => {
    expect(() => normalizeUpdateContentParams("skill", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
    })).toThrowError("更新 Skill 请提供完整字段 name/title/description/category/content，或提供 sourceDirectoryPath。")
  })

  it("normalizes update and delete version tokens", () => {
    const updatePayload = normalizeUpdateContentParams("rule", {
      ...validRuleParams,
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    })
    const deletePayload = normalizeDeleteContentParams("rule", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    })

    expect(updatePayload.id).toBe("rule-1")
    expect(updatePayload.baseHistoryDirname).toBe("20260521000000Z__user__abc123")
    expect(deletePayload).toEqual({
      type: "rule",
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    })
  })

  it("rejects force updates and deletes", () => {
    expect(() => normalizeUpdateContentParams("rule", {
      ...validRuleParams,
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      force: true,
    })).toThrow(ContentCapabilityError)
    expect(() => normalizeDeleteContentParams("rule", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      force: true,
    })).toThrow(ContentCapabilityError)
  })
})
