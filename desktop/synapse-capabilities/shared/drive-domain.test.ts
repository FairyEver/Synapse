import { describe, expect, it } from "vitest"
import { DRIVE_DOMAIN, DRIVE_MCP_TOOL_ACTIONS, buildDriveTools } from "./drive-domain"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "./registry"

describe("Drive capability domain", () => {
  it("registers Drive MCP tools and actions", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)

    expect(toolNames.filter((name) => name.startsWith("app_drive_"))).toEqual([
      "app_drive_item_list",
      "app_drive_item_get",
      "app_drive_file_upload",
      "app_drive_folder_upload",
      "app_drive_folder_create",
      "app_drive_item_rename",
      "app_drive_item_move",
      "app_drive_item_delete",
      "app_drive_item_preview_get",
      "app_drive_file_content_read",
      "app_drive_file_download_create",
      "app_drive_file_version_list",
      "app_drive_file_version_download_create",
      "app_drive_file_version_restore",
      "app_drive_file_version_delete",
      "app_drive_file_version_pin_update",
      "app_drive_link_resolve",
      "app_drive_link_list",
      "app_drive_link_read_text",
      "app_drive_link_materialize",
      "app_drive_link_download_file",
      "app_drive_folder_zip_create",
      "app_drive_share_list",
      "app_drive_share_create",
      "app_drive_share_disable",
      "app_drive_site_create",
      "app_drive_site_list",
      "app_drive_site_update_access",
      "app_drive_site_disable",
      "app_drive_site_enable",
      "app_drive_site_delete",
      "app_drive_site_republish",
      "app_drive_usage_get",
      "app_drive_stats_get",
      "app_drive_item_tree_list",
      "app_drive_folder_path_ensure",
      "app_drive_reorganization_preview",
      "app_drive_reorganization_apply",
      "app_drive_sync_snapshot_get",
      "app_drive_sync_binding_preview",
      "app_drive_sync_binding_create",
      "app_drive_sync_binding_pause",
      "app_drive_sync_binding_resume",
      "app_drive_sync_binding_remove",
      "app_drive_sync_binding_exclude_rules_update",
      "app_drive_sync_binding_rescan",
      "app_drive_sync_conflict_resolve",
      "app_drive_direct_link_upload",
      "app_drive_direct_link_list",
      "app_drive_direct_link_get",
      "app_drive_direct_link_update",
      "app_drive_direct_link_rename",
      "app_drive_direct_link_delete",
      "app_drive_direct_link_restore",
      "app_drive_trash_list",
      "app_drive_trash_delete",
      "app_drive_item_restore",
    ])
    expect(toolNames.some((name) => name.startsWith("drive_"))).toBe(false)
    expect(MCP_TOOL_ACTIONS.app_drive_file_upload).toBe("app.drive.file.upload")
    expect(MCP_TOOL_ACTIONS.app_drive_file_version_restore).toBe("app.drive.file_version.restore")
    expect(MCP_TOOL_ACTIONS.app_drive_reorganization_apply).toBe("app.drive.reorganization.apply")
    expect(MCP_TOOL_ACTIONS.app_drive_sync_binding_create).toBe("app.drive.sync.binding.create")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_upload).toBe("app.drive.direct_link.upload")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_list).toBe("app.drive.direct_link.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_get).toBe("app.drive.direct_link.get")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_update).toBe("app.drive.direct_link.update")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_rename).toBe("app.drive.direct_link.rename")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_delete).toBe("app.drive.direct_link.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_direct_link_restore).toBe("app.drive.direct_link.restore")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_create).toBe("app.drive.site.create")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_list).toBe("app.drive.site.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_update_access).toBe("app.drive.site.update_access")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_disable).toBe("app.drive.site.disable")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_enable).toBe("app.drive.site.enable")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_delete).toBe("app.drive.site.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_site_republish).toBe("app.drive.site.republish")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_trash_list).toBe("app.drive.trash.list")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_trash_delete).toBe("app.drive.trash.delete")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_item_restore).toBe("app.drive.item.restore")
    expect(DRIVE_MCP_TOOL_ACTIONS.app_drive_link_resolve).toBe("app.drive.link.resolve")
    expect(DRIVE_MCP_TOOL_ACTIONS).not.toHaveProperty("drive_item_list")
    expect(getActionDomainId("app.drive.item.list")).toBe("drive")
  })

  it("builds persistent Drive sync schemas and risk metadata", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))
    const capabilities = new Map(DRIVE_DOMAIN.capabilities.map((capability) => [capability.id, capability]))

    expect(tools.get("app_drive_sync_binding_preview")?.inputSchema).toMatchObject({
      properties: {
        localPath: { type: "string" },
        direction: { enum: ["local_to_remote", "remote_to_local", "bind_existing"] },
        driveItemId: { type: "string" },
        targetParentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        excludeRules: { type: "array" },
        useDefaultExcludes: { type: "boolean" },
        importGitignore: { type: "boolean" },
      },
      required: ["localPath", "direction"],
    })
    expect(tools.get("app_drive_sync_binding_exclude_rules_update")?.inputSchema.required)
      .toEqual(["bindingId", "defaults", "importedGitignore", "user"])
    expect(tools.get("app_drive_file_upload")?.description).toContain("does not create persistent sync")
    expect(tools.get("app_drive_folder_upload")?.description).toContain("does not create persistent sync")
    expect(tools.get("app_drive_sync_binding_preview")?.description).toContain("initialTransfer")
    expect(tools.get("app_drive_sync_binding_preview")?.description).toContain("up to 200")
    expect(capabilities.get("app.drive.sync.snapshot.get")).toMatchObject({ mutates: false })
    expect(capabilities.get("app.drive.sync.binding.preview")).toMatchObject({ mutates: false })
    expect(capabilities.get("app.drive.sync.binding.create")).toMatchObject({ mutates: true, risk: "high" })
    expect(capabilities.get("app.drive.sync.conflict.resolve")).toMatchObject({ mutates: true, risk: "high" })
  })

  it("documents public non-expiring Drive share defaults", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))
    const shareCreate = tools.get("app_drive_share_create")
    const siteCreate = tools.get("app_drive_site_create")

    expect(shareCreate?.inputSchema.properties).toMatchObject({
      passwordEnabled: { description: expect.stringContaining("Defaults to false") },
      expiresIn: { description: expect.stringContaining("Defaults to forever") },
    })
    expect(siteCreate?.inputSchema.required).toEqual(["sourceFolderItemId", "name"])
    expect(siteCreate?.inputSchema.properties).toMatchObject({
      accessMode: { description: expect.stringContaining("Defaults to public") },
      expiresIn: { description: expect.stringContaining("Defaults to forever") },
    })
  })

  it("builds Drive link intake tool schemas and marks local writes", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))
    const capabilities = new Map(DRIVE_DOMAIN.capabilities.map((capability) => [capability.id, capability]))

    expect(tools.get("app_drive_link_read_text")?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        url: { type: "string" },
        password: { type: "string" },
        maxBytes: { type: "number" },
      },
      required: ["url"],
    })
    expect(tools.get("app_drive_link_read_text")?.inputSchema.properties.password.description).toContain("actual link password")
    expect(tools.get("app_drive_link_resolve")?.description).toContain("password_required")
    expect(tools.get("app_drive_link_resolve")?.description).toContain("Raw MCP")
    expect(tools.get("app_drive_link_resolve")?.inputSchema.properties.password.description).toContain("Environment variables are not expanded")
    expect(tools.get("app_drive_link_materialize")?.inputSchema.properties).toMatchObject({
      scope: { type: "string", enum: ["entry", "text", "all"] },
      maxFiles: { type: "number" },
      maxBytes: { type: "number" },
    })
    expect(capabilities.get("app.drive.link.resolve")).toMatchObject({ mutates: false })
    expect(capabilities.get("app.drive.link.materialize")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.link.download_file")).toMatchObject({ mutates: true })
  })

  it("describes standalone HTML sharing as the default and folder publishing as explicit", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))
    const capabilities = new Map(DRIVE_DOMAIN.capabilities.map((capability) => [capability.id, capability]))

    expect(tools.get("app_drive_share_create")?.description).toContain("Prefer this route for a standalone HTML file")
    expect(tools.get("app_drive_share_create")?.description).toContain("upload destination folder")
    expect(tools.get("app_drive_site_create")?.description).toContain("explicitly asks to publish the whole folder")
    expect(tools.get("app_drive_site_create")?.description).toContain("folder containing only index.html is valid")
    expect(capabilities.get("app.drive.share.create")?.description).toContain("Standalone HTML defaults to this route")
    expect(capabilities.get("app.drive.site.create")?.description).toContain("folder containing only index.html is valid")
  })

  it("builds public asset and trash tool schemas", () => {
    const tools = new Map(buildDriveTools().map((tool) => [tool.name, tool]))

    expect(tools.get("app_drive_direct_link_upload")?.inputSchema).toMatchObject({
      properties: {
        filePath: { type: "string" },
        name: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["filePath"],
    })
    expect(tools.get("app_drive_direct_link_list")?.inputSchema.properties).toMatchObject({
      offset: { type: "number" },
      limit: { type: "number" },
      search: { type: "string" },
    })
    expect(tools.get("app_drive_direct_link_get")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("app_drive_direct_link_update")?.inputSchema).toMatchObject({
      properties: {
        assetId: { type: "string" },
        filePath: { type: "string" },
        name: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["assetId", "filePath"],
    })
    expect(tools.get("app_drive_direct_link_rename")?.inputSchema).toMatchObject({
      properties: {
        assetId: { type: "string" },
        name: { type: "string" },
      },
      required: ["assetId", "name"],
    })
    expect(tools.get("app_drive_direct_link_delete")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("app_drive_direct_link_restore")?.inputSchema).toMatchObject({
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    })
    expect(tools.get("app_drive_trash_list")?.inputSchema.properties).toMatchObject({
      offset: { type: "number" },
      limit: { type: "number" },
      search: { type: "string" },
    })
    expect(tools.get("app_drive_share_list")?.inputSchema.properties.search.description).toContain("share id")
    expect(tools.get("app_drive_share_list")?.inputSchema.properties.search.description).toContain("item name")
    expect(tools.get("app_drive_direct_link_list")?.inputSchema.properties.search.description).toContain("Public assets")
    expect(tools.get("app_drive_trash_list")?.inputSchema.properties.search.description.toLowerCase()).toContain("trash")
    expect(tools.get("app_drive_trash_delete")?.inputSchema).toMatchObject({
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    })
    expect(tools.get("app_drive_item_restore")?.inputSchema).toMatchObject({
      properties: {
        itemId: { type: "string" },
        kind: { type: "string", enum: ["normal", "public_asset"] },
        assetId: { type: "string" },
      },
      required: ["itemId"],
    })
    expect(tools.get("app_drive_item_restore")?.description).toContain("pass kind and assetId")
    expect(tools.get("app_drive_item_restore")?.inputSchema).not.toHaveProperty("allOf")
  })

  it("allows Drive reorganization moves to target the root directory", () => {
    const tool = buildDriveTools().find((item) => item.name === "app_drive_reorganization_preview")
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

    expect(capabilities.get("app.drive.direct_link.upload")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.direct_link.update")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.direct_link.rename")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.direct_link.delete")).toMatchObject({ mutates: true, risk: "high" })
    expect(capabilities.get("app.drive.direct_link.restore")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.trash.delete")).toMatchObject({ mutates: true, risk: "high" })
    expect(capabilities.get("app.drive.item.restore")).toMatchObject({ mutates: true })
    expect(capabilities.get("app.drive.direct_link.list")).toMatchObject({ mutates: false })
    expect(capabilities.get("app.drive.direct_link.get")).toMatchObject({ mutates: false })
    expect(capabilities.get("app.drive.trash.list")).toMatchObject({ mutates: false })
  })

  it("does not register public asset access-log tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)

    expect(toolNames.some((name) => /access.*log|log.*access/.test(name))).toBe(false)
  })
})
