import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { cronRendererTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.renderer"
import { intervalRendererTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.renderer"
import { webhookRendererTriggerDefinition } from "../../../automation-trigger-packages/builtin/webhook/index.renderer"
import { rendererAutomationTriggerRegistry } from "../builtin-triggers"

describe("rendererAutomationTriggerRegistry", () => {
  it("registers built-in triggers in product order", () => {
    expect(rendererAutomationTriggerRegistry.list().map((trigger) => ({
      id: trigger.manifest.id,
      kind: trigger.manifest.kind,
    }))).toEqual([
      { id: "builtin.cron", kind: "schedule" },
      { id: "builtin.interval", kind: "schedule" },
      { id: "builtin.webhook", kind: "event" },
    ])
  })

  it("parses and summarizes cron config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.cron", {
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })

    expect(parsed).toEqual({
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.cron", parsed)).toBe("Cron · 0 9 * * *")
  })

  it("renders cron trigger config with the advanced cron input", () => {
    const trigger = rendererAutomationTriggerRegistry.get("builtin.cron")
    const ConfigForm = trigger.ConfigForm

    const html = ConfigForm
      ? renderToStaticMarkup(
        <ConfigForm
          value={{ expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] }}
          onChange={() => undefined}
        />,
      )
      : ""

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('id="automation-trigger-cron-expr"')
    expect(html).toContain(">编辑</button>")
  })

  it("parses and summarizes interval config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.interval", {
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })

    expect(parsed).toEqual({
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.interval", parsed)).toBe("每 60 分钟 · 完成后")
  })

  it("rejects duplicate trigger ids", () => {
    const existing = rendererAutomationTriggerRegistry.get("builtin.cron")

    expect(() => rendererAutomationTriggerRegistry.register(existing)).toThrow(
      'Automation trigger "builtin.cron" is already registered',
    )
  })

  it("exports built-in renderer trigger definitions from trigger packages", () => {
    expect(cronRendererTriggerDefinition.manifest.id).toBe("builtin.cron")
    expect(cronRendererTriggerDefinition.ConfigForm).toBeTypeOf("function")

    expect(intervalRendererTriggerDefinition.manifest.id).toBe("builtin.interval")
    expect(intervalRendererTriggerDefinition.ConfigForm).toBeTypeOf("function")

    expect(webhookRendererTriggerDefinition.manifest.id).toBe("builtin.webhook")
    expect(webhookRendererTriggerDefinition.ConfigForm).toBeTypeOf("function")
  })
})
