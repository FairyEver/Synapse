import { describe, expect, it } from "vitest"
import { systemNotifierCapabilityManifest } from "../manifest"

describe("System Notifier capability manifest", () => {
  it("registers one App, capability, tool and node with no deep links", () => {
    expect(systemNotifierCapabilityManifest).toEqual({
      id: "system-notifier",
      app: { id: "system-notifier" },
      capabilities: ["app.system_notifier.notification.trigger"],
      mcpTools: ["app_system_notifier_notification_trigger"],
      workflowNodes: ["system_notifier_notification_trigger"],
      deepLinks: [],
    })
  })
})
