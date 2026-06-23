import { describe, expect, it } from "vitest"
import { DRIVE_DOMAIN, DRIVE_MCP_TOOL_ACTIONS, buildDriveTools } from "./drive-domain"
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
      "drive_file_version_list",
      "drive_file_version_download_create",
      "drive_file_version_restore",
      "drive_file_version_delete",
      "drive_file_version_pin_update",
      "drive_folder_zip_create",
      "drive_share_list",
      "drive_share_create",
      "drive_share_disable",
      "drive_site_create",
      "drive_site_list",
      "drive_site_update_access",
      "drive_site_disable",
      "drive_site_delete",
      "drive_site_republish",
      "drive_usage_get",
      "drive_stats_get",
      "drive_item_tree_list",
      "drive_folder_path_ensure",
      "drive_reorganization_preview",
      "drive_reorganization_apply",
      "drive_direct_link_upload",
      "drive_direct_link_list",
      "drive_direct_link_get",
      "drive_direct_link_update",
      "drive_direct_link_rename",
      "drive_direct_link_delete",
      "drive_direct_link_restore",
      "drive_trash_list",
      "drive_trash_delete",
      "drive_item_restore",
    ])
    expect(MCP_TOOL_ACTIONS.drive_file_upload).toBe("drive.file.upload")
    expect(MCP_TOOL_ACTIONS.drive_file_version_restore).toBe("drive.file_version.restore")
    expect(MCP_TOOL_ACTIONS.drive_reorganization_apply).toBe("drive.reorganization.apply")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_upload).toBe("drive.direct_link.upload")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_list).toBe("drive.direct_link.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_get).toBe("drive.direct_link.get")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_update).toBe("drive.direct_link.update")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_rename).toBe("drive.direct_link.rename")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_delete).toBe("drive.direct_link.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_restore).toBe("drive.direct_link.restore")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_create).toBe("drive.site.create")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_list).toBe("drive.site.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_update_access).toBe("drive.site.update_access")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_disable).toBe("drive.site.disable")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_delete).toBe("drive.site.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_site_republish).toBe("drive.site.republish")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_trash_list).toBe("drive.trash.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_trash_delete).toBe("drive.trash.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.drive_item_restore).toBe("drive.item.restore")
    expect(getActionDomainId("drive.item.list")).toBe("drive")
  })

  it("builds public asset and trash tool schemas", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))

    expect(tools.get("drive_direct_link_upload")?.inputSchema).toMatchObject({
      properties: {
        filePath: { type: "string" },
        name: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["filePath"],
    })
    expect(tools.get("drive_direct_link_list")?.inputSchema.properties).toMatchObject({
      offset: { type: "number" },
      limit: { type: "number" },
      search: { type: "string" },
    })
    expect(tools.get("drive_direct_link_get")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("drive_direct_link_update")?.inputSchema).toMatchObject({
      properties: {
        assetId: { type: "string" },
        filePath: { type: "string" },
        name: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["assetId", "filePath"],
    })
    expect(tools.get("drive_direct_link_rename")?.inputSchema).toMatchObject({
      properties: {
        assetId: { type: "string" },
        name: { type: "string" },
      },
      required: ["assetId", "name"],
    })
    expect(tools.get("drive_direct_link_delete")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("drive_direct_link_restore")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("drive_trash_list")?.inputSchema.properties).toMatchObject({
      offset: { type: "number" },
      limit: { type: "number" },
      search: { type: "string" },
    })
    expect(tools.get("drive_trash_delete")?.inputSchema).toMatchObject({
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    })
    expect(tools.get("drive_item_restore")?.inputSchema).toMatchObject({
      properties: {
        itemId: { type: "string" },
        kind: { type: "string", enum: ["normal", "public_asset"] },
        assetId: { type: "string" },
      },
      required: ["itemId"],
    })
  })

  it("allows Drive reorganization moves to target the root directory", () => {
    const tool = buildDriveTools().find((item) => item.name === "drive_reorganization_preview")
    const moves = tool?.inputSchema.properties.moves as {
      readonly items?: {
        readonly properties?: Record<string, unknown>
      }
    }

    expect(moves.items?.properties?.targetParentId).toMatchObject({
      anyOf: [
        { type: "string" },
        { type: "null" },
      ],
    })
  })

  it("marks public asset and trash write capabilities correctly", () => {
    const capabilities = new Map(DRIVE_DOMAIN.capabilities.map((capability) => [capability.id, capability]))

    expect(capabilities.get("drive.direct_link.upload")).toMatchObject({ mutates: true })
    expect(capabilities.get("drive.direct_link.update")).toMatchObject({ mutates: true })
    expect(capabilities.get("drive.direct_link.rename")).toMatchObject({ mutates: true })
    expect(capabilities.get("drive.direct_link.delete")).toMatchObject({ mutates: true, risk: "high" })
    expect(capabilities.get("drive.direct_link.restore")).toMatchObject({ mutates: true })
    expect(capabilities.get("drive.trash.delete")).toMatchObject({ mutates: true, risk: "high" })
    expect(capabilities.get("drive.item.restore")).toMatchObject({ mutates: true })
    expect(capabilities.get("drive.direct_link.list")).toMatchObject({ mutates: false })
    expect(capabilities.get("drive.direct_link.get")).toMatchObject({ mutates: false })
    expect(capabilities.get("drive.trash.list")).toMatchObject({ mutates: false })
  })

  it("does not register public asset access-log tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)

    expect(toolNames.some((name) => /access.*log|log.*access/.test(name))).toBe(false)
  })
})
