import { describe, expect, it } from "vitest"
import { createDefaultAutomationDraft } from "../../utils"
import { validateAutomationDraftFields } from "../validation"

describe("automation field validation", () => {
  it("keeps trigger and executor errors attached to their fields", () => {
    const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.interval", triggerConfig: { everyMinutes: 0, anchor: "created_at" }, executorType: "builtin.claude-code", executorConfig: { projectId: "", prompt: "" } }
    expect(validateAutomationDraftFields(draft)).toMatchObject({ "trigger.everyMinutes": expect.any(String), "executor.projectId": expect.any(String), "executor.prompt": expect.any(String) })
  })
  it("accepts complete configuration without inventing errors", () => {
    const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.cron", triggerConfig: { expr: "0 9 * * *" }, executorType: "builtin.claude-code", executorConfig: { projectId: "p1", prompt: "检查项目" } }
    expect(validateAutomationDraftFields(draft)).toEqual({})
  })
})
