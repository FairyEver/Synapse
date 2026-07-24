import { describe, expect, it } from "vitest"
import { clipboardPackageManifest } from "../manifest"

describe("Clipboard capability package manifest", () => {
  it("declares only the two visible Workflow surfaces", () => {
    expect(clipboardPackageManifest).toMatchObject({
      schemaVersion: 1,
      packageId: "clipboard",
      packageVersion: "1.0.0",
      capabilities: [
        {
          id: "app.clipboard.text.write",
          version: "1.0.0",
          availability: "always",
          userToggle: "none",
        },
        {
          id: "app.clipboard.text.read",
          version: "1.0.0",
          availability: "always",
          userToggle: "none",
        },
      ],
      workflowNodes: [
        {
          type: "clipboard_text_write",
          capabilityId: "app.clipboard.text.write",
          discovery: "visible",
        },
        {
          type: "clipboard_text_read",
          capabilityId: "app.clipboard.text.read",
          discovery: "visible",
        },
      ],
      automationActions: [],
      mcpTools: [],
      systemApp: null,
      deepLinks: [],
    })
  })
})
