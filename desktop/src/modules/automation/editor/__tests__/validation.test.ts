import { describe, expect, it } from "vitest"
import { createDefaultAutomationDraft } from "../../utils"
import { validateAutomationDraftFields } from "../validation"

describe("automation field validation", () => {
  it("keeps terminal command text literal", () => {
    const draft = { ...createDefaultAutomationDraft("终端"), triggerType: "builtin.cron", triggerConfig: { expr: "0 9 * * *" }, executorType: "builtin.terminal", executorConfig: { command: "echo '{{arbitrary.literal}}'" } }
    expect(validateAutomationDraftFields(draft)).toEqual({})
  })
  it("keeps trigger and executor errors attached to their fields", () => {
    const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.interval", triggerConfig: { everyMinutes: 0, anchor: "created_at" }, executorType: "builtin.claude-code", executorConfig: { projectId: "", prompt: "" } }
    expect(validateAutomationDraftFields(draft)).toMatchObject({ "trigger.everyMinutes": expect.any(String), "executor.projectId": expect.any(String), "executor.prompt": expect.any(String) })
  })
  it("accepts complete configuration without inventing errors", () => {
    const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.cron", triggerConfig: { expr: "0 9 * * *" }, executorType: "builtin.claude-code", executorConfig: { projectId: "p1", prompt: "检查项目" } }
    expect(validateAutomationDraftFields(draft)).toEqual({})
  })
})


it.each(["{{trigger.typo}}", "{{trigger.payload.messageId}}", "{{trigger.request.body.order..id}}", "{{trigger.triggeredAt}", "{{trigger.request.body#/a{b}}"])("rejects an invalid reference before save: %s", prompt => {
  const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.webhook", triggerConfig: { webhookPublicId: "wh_public" }, executorType: "builtin.claude-code", executorConfig: { projectId: "p1", prompt } }
  expect(validateAutomationDraftFields(draft)["executor.prompt"]).toBeTruthy()
})


it.each(["{{trigger.payload.request.body#/order.id}}", "{{trigger.request.remoteAddress}}"])("accepts explicit compatibility references and pointer paths: %s", prompt => {
  const draft = { ...createDefaultAutomationDraft("测试"), triggerType: "builtin.webhook", triggerConfig: { webhookPublicId: "wh_public" }, executorType: "builtin.claude-code", executorConfig: { projectId: "p1", prompt } }
  expect(validateAutomationDraftFields(draft)).toEqual({})
})
