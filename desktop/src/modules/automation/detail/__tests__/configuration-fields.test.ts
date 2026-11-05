import { describe, expect, it } from "vitest"
import { buildAutomationConfigurationFields, getAutomationProviderModelSelection } from "../configuration-fields"
import { validateChangedTriggerVariables } from "../../utils"
import type { AutomationEditorDraft } from "../../types"

describe("automation read-only configuration", () => {
  it.each([
    { providerId: "provider-1" },
    { modelTier: "haiku" },
    { providerId: "provider-1", modelTier: "unknown-tier" },
  ])("preserves incomplete or unknown provider fields without resolving a selection: %j", (config) => {
    expect(getAutomationProviderModelSelection(config)).toBeNull()
    expect(buildAutomationConfigurationFields(config, []).map(field => field.key)).toEqual(Object.keys(config))
  })

  it("shows readable project, schedule and session values without rendering form controls", () => {
    const fields = buildAutomationConfigurationFields({ projectId: "project-1", activeDays: [1, 3, 5], timeRange: { start: "08:00", end: "17:00" }, sessionPolicy: "resume", prompt: "first line\nsecond line" }, [{ id: "project-1", name: "项目一", path: "/example/project" }])
    expect(fields).toEqual([
      { key: "projectId", label: "项目", value: "项目一" },
      { key: "activeDays", label: "活跃日", value: "周一、周三、周五" },
      { key: "timeRange", label: "触发时段", value: "开始: 08:00\n结束: 17:00" },
      { key: "sessionPolicy", label: "会话策略", value: "复用上次" },
      { key: "prompt", label: "提示词", value: "first line\nsecond line" },
    ])
  })
  it("masks nested authentication, private headers and environment values in details", () => {
    const fields = buildAutomationConfigurationFields({ auth: { type: "basic", basicUsername: "demo", basicPassword: "private-password" }, headers: { Authorization: "private-header", Accept: "application/json" }, env: { SESSION_VALUE: "private-env" } }, [])
    const text = fields.map(field => field.value).join("\n")
    expect(text).toContain("Basic Auth")
    expect(text).toContain("application/json")
    expect(text).toContain("SESSION_VALUE: ••••••••")
    expect(text).not.toContain("private-password")
    expect(text).not.toContain("private-header")
    expect(text).not.toContain("private-env")
  })
  it("removes credentials embedded in URLs before showing details", () => {
    const fields = buildAutomationConfigurationFields({ url: "https://user:private-password@example.com/api?token=private-token&state=ok" }, [])
    expect(fields[0]!.value).not.toContain("private-password")
    expect(fields[0]!.value).not.toContain("private-token")
    expect(fields[0]!.value).toContain("example.com")
  })
  it("keeps literal template text in program source and structured script inputs", () => {
    const draft: AutomationEditorDraft = {
      name: "代码", description: "", cwd: "", enabled: false, missedRunPolicy: "skip",
      triggerType: "builtin.interval", triggerConfig: {}, executorType: "builtin.javascript-run",
      executorConfig: { source: "return '{{trigger.cron}}'", inputs: [{ name: "literal", source: { type: "static", value: "{{trigger.cron}}" } }] },
    }
    expect(() => validateChangedTriggerVariables(draft, ["builtin.cron"])).not.toThrow()
  })
})
