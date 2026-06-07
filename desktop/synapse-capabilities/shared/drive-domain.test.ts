import { describe, expect, it } from "vitest"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "./registry"

describe("Drive capability domain", () => {
  it("registers Drive MCP tools and actions", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)

    expect(toolNames).toContain("drive_item_list")
    expect(toolNames).toContain("drive_file_upload")
    expect(toolNames).toContain("drive_folder_upload")
    expect(toolNames).toContain("drive_share_create")
    expect(MCP_TOOL_ACTIONS.drive_file_upload).toBe("drive.file.upload")
    expect(getActionDomainId("drive.item.list")).toBe("drive")
  })
})
