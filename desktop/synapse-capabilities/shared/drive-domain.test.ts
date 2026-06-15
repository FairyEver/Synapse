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
      "drive_delete_impact_get",
      "drive_item_delete",
      "drive_item_preview_get",
      "drive_file_content_read",
      "drive_file_download_create",
      "drive_folder_zip_create",
      "drive_share_list",
      "drive_share_create",
      "drive_share_disable",
      "drive_publication_list",
      "drive_page_publication_create",
      "drive_site_publication_create",
      "drive_publication_deployment_create",
      "drive_publication_disable",
      "drive_usage_get",
    ])
    expect(MCP_TOOL_ACTIONS.drive_file_upload).toBe("drive.file.upload")
    expect(MCP_TOOL_ACTIONS.drive_page_publication_create).toBe("drive.page_publication.create")
    expect(getActionDomainId("drive.item.list")).toBe("drive")
  })
})
