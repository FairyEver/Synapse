import { describe, expect, it } from "vitest"
import { fileOpenerCapabilityManifest } from "../manifest"

describe("fileOpenerCapabilityManifest", () => {
  it("explicitly exposes only the open deep-link action", () => {
    expect(fileOpenerCapabilityManifest).toMatchObject({
      id: "file-opener",
      capabilities: ["app.file_opener.file.open"],
      mcpTools: ["app_file_opener_file_open"],
      workflowNodes: ["file_opener_file_open"],
      deepLinks: [{ action: "open", capabilityId: "app.file_opener.file.open" }],
    })
  })
})

