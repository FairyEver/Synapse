import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const driveCapabilities: readonly CapabilityDefinition[] = [
  { id: "drive.item.list" as CapabilityId, title: "List drive items", description: "List Synapse Drive files and folders under a parent folder.", mutates: false },
  { id: "drive.file.upload" as CapabilityId, title: "Upload file", description: "Upload one local file to Synapse Drive and complete the direct upload session.", mutates: true },
  { id: "drive.folder.upload" as CapabilityId, title: "Upload folder", description: "Upload a local folder to Synapse Drive while preserving relative paths.", mutates: true },
  { id: "drive.folder.create" as CapabilityId, title: "Create folder", description: "Create a Synapse Drive folder.", mutates: true },
  { id: "drive.item.move" as CapabilityId, title: "Move item", description: "Move a Synapse Drive file or folder.", mutates: true },
  { id: "drive.item.delete" as CapabilityId, title: "Delete item", description: "Delete a Synapse Drive file or folder.", mutates: true, risk: "high" },
  { id: "drive.share.create" as CapabilityId, title: "Create share", description: "Create or reuse a public Synapse Drive share link.", mutates: true },
  { id: "drive.share.disable" as CapabilityId, title: "Disable share", description: "Disable a Synapse Drive share link.", mutates: true },
  { id: "drive.usage.get" as CapabilityId, title: "Get usage", description: "Get Synapse Drive quota usage for the current user.", mutates: false },
]

export const DRIVE_DOMAIN: CapabilityDomainDefinition = {
  id: "drive",
  capabilities: driveCapabilities,
}

export const DRIVE_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  driveCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

const stringField = (description: string) => ({ type: "string", description })
const optionalParentId = stringField("Parent folder item id. Omit or pass null to use the Drive root directory.")
const driveAccessExpiresInValues = ["3d", "7d", "30d", "1y", "forever"]

export function buildDriveTools(): McpToolDefinition[] {
  return [
    {
      name: "drive_item_list",
      description: "List Synapse Drive files and folders. parentId defaults to root.",
      inputSchema: {
        type: "object",
        properties: {
          parentId: optionalParentId,
        },
      },
    },
    {
      name: "drive_file_upload",
      description: "Upload one local file to Synapse Drive using server-prepared direct upload. The result omits presigned upload URLs.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringField("Absolute local file path to upload."),
          parentId: optionalParentId,
          name: stringField("Optional Drive display name. Defaults to the local file basename."),
          mimeType: stringField("Optional MIME type."),
        },
        required: ["filePath"],
      },
    },
    {
      name: "drive_folder_upload",
      description: "Upload a local folder to Synapse Drive using a manifest and direct uploads. The result omits presigned upload URLs.",
      inputSchema: {
        type: "object",
        properties: {
          folderPath: stringField("Absolute local folder path to upload."),
          parentId: optionalParentId,
          folderName: stringField("Optional Drive folder name. Defaults to the local folder basename."),
        },
        required: ["folderPath"],
      },
    },
    {
      name: "drive_folder_create",
      description: "Create a Synapse Drive folder. parentId defaults to root.",
      inputSchema: {
        type: "object",
        properties: {
          parentId: optionalParentId,
          name: stringField("Folder name."),
        },
        required: ["name"],
      },
    },
    {
      name: "drive_item_move",
      description: "Move a Synapse Drive file or folder. parentId null moves it to root.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
          parentId: optionalParentId,
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_item_delete",
      description: "Delete a Synapse Drive file or folder. Set disablePublications to true to disable affected page/site publications during deletion.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
          disablePublications: {
            type: "boolean",
            description: "Whether to disable affected page/site publications while deleting. Defaults to false.",
          },
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_share_create",
      description: "Create or reuse a public Synapse Drive share link and return the public URL.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
          passwordEnabled: { type: "boolean", description: "Whether the share should require a password. Defaults to true." },
          expiresIn: { type: "string", enum: driveAccessExpiresInValues, description: "Share expiration. Defaults to 3d." },
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_share_disable",
      description: "Disable a Synapse Drive share link by share record id.",
      inputSchema: {
        type: "object",
        properties: {
          shareId: stringField("Drive share record id returned by drive_share_create or item activeShareId."),
        },
        required: ["shareId"],
      },
    },
    {
      name: "drive_usage_get",
      description: "Get Synapse Drive quota usage for the current user.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ]
}
