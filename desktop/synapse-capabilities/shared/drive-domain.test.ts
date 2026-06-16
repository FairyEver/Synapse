import { describe, expect, it } from "vitest"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "./registry"

describe("Drive capability domain", () => {
  it("registers Drive MCP tools and actions", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)

    expect(toolNames.filter((name) => name.startsWith("drive_"))).toEqual([
      "drive_item_list",
      "drive_item_get",
      "drive_file_upload",
      "drive_folder_upload",
      "drive_folder_create",
      "drive_item_rename",
      "drive_item_move",
      "drive_item_delete",
      "drive_item_preview_get",
      "drive_file_content_read",
      "drive_file_download_create",
      "drive_folder_zip_create",
      "drive_share_list",
      "drive_share_create",
      "drive_share_disable",
      "drive_usage_get",
      "drive_stats_get",
      "drive_item_tree_list",
      "drive_folder_path_ensure",
      "drive_reorganization_preview",
      "drive_reorganization_apply",
    ])
    expect(MCP_TOOL_ACTIONS.drive_file_upload).toBe("drive.file.upload")
    expect(MCP_TOOL_ACTIONS.drive_reorganization_apply).toBe("drive.reorganization.apply")
    expect(getActionDomainId("drive.item.list")).toBe("drive")
  })
})
