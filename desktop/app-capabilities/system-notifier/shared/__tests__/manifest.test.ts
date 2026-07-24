import { describe, expect, it } from "vitest"
import { systemNotifierCapabilityManifest } from "../manifest"

describe("System Notifier capability manifest", () => {
  it("registers its capability, tool, and node without a System App or deep link", () => {
    expect(systemNotifierCapabilityManifest).toEqual({
      id: "system-notifier",
      app: null,
      capabilities: ["app.system_notifier.notification.trigger"],
      mcpTools: ["app_system_notifier_notification_trigger"],
      workflowNodes: ["system_notifier_notification_trigger"],
      deepLinks: [],
    })
  })
})
