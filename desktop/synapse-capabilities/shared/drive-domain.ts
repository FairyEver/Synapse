import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const driveCapabilities: readonly CapabilityDefinition[] = [
  { id: "drive.item.list" as CapabilityId, title: "List drive items", description: "List Synapse Drive files and folders under a parent folder.", mutates: false },
  { id: "drive.item.get" as CapabilityId, title: "Get drive item", description: "Get metadata for one Synapse Drive file or folder.", mutates: false },
  { id: "drive.file.upload" as CapabilityId, title: "Upload file", description: "Upload one local file to Synapse Drive and complete the direct upload session.", mutates: true },
  { id: "drive.folder.upload" as CapabilityId, title: "Upload folder", description: "Upload a local folder to Synapse Drive while preserving relative paths.", mutates: true },
  { id: "drive.folder.create" as CapabilityId, title: "Create folder", description: "Create a Synapse Drive folder.", mutates: true },
  { id: "drive.item.rename" as CapabilityId, title: "Rename item", description: "Rename a Synapse Drive file or folder.", mutates: true },
  { id: "drive.item.move" as CapabilityId, title: "Move item", description: "Move a Synapse Drive file or folder.", mutates: true },
  { id: "drive.delete_impact.get" as CapabilityId, title: "Get delete impact", description: "Get active publications affected by deleting a Synapse Drive item.", mutates: false },
  { id: "drive.item.delete" as CapabilityId, title: "Delete item", description: "Delete a Synapse Drive file or folder.", mutates: true, risk: "high" },
  { id: "drive.item_preview.get" as CapabilityId, title: "Get item preview", description: "Get the owner browser preview snapshot for a Synapse Drive item.", mutates: false },
  { id: "drive.file_content.read" as CapabilityId, title: "Read file content", description: "Read previewable text content from a Synapse Drive file.", mutates: false },
  { id: "drive.file_download.create" as CapabilityId, title: "Create file download", description: "Download a Synapse Drive file to a local path.", mutates: true },
  { id: "drive.folder_zip.create" as CapabilityId, title: "Create folder zip", description: "Download a Synapse Drive folder as a local zip file.", mutates: true },
  { id: "drive.share.list" as CapabilityId, title: "List shares", description: "List public Synapse Drive share links for the current user.", mutates: false },
  { id: "drive.share.create" as CapabilityId, title: "Create share", description: "Create or reuse a public Synapse Drive share link.", mutates: true },
  { id: "drive.share.disable" as CapabilityId, title: "Disable share", description: "Disable a Synapse Drive share link.", mutates: true },
  { id: "drive.publication.list" as CapabilityId, title: "List publications", description: "List public Synapse Drive page and site publication links for the current user.", mutates: false },
  { id: "drive.page_publication.create" as CapabilityId, title: "Create page publication", description: "Publish an HTML Drive file as a public page.", mutates: true },
  { id: "drive.site_publication.create" as CapabilityId, title: "Create site publication", description: "Publish a Drive folder containing root index.html as a public site.", mutates: true },
  { id: "drive.publication_deployment.create" as CapabilityId, title: "Create publication deployment", description: "Create a new deployment snapshot for an existing Drive publication.", mutates: true },
  { id: "drive.publication.disable" as CapabilityId, title: "Disable publication", description: "Disable a Synapse Drive page or site publication.", mutates: true },
  { id: "drive.usage.get" as CapabilityId, title: "Get usage", description: "Get Synapse Drive quota usage for the current user.", mutates: false },
  { id: "drive.stats.get" as CapabilityId, title: "Get stats", description: "Get Synapse Drive item counts and quota usage for the current user.", mutates: false },
  { id: "drive.item_tree.list" as CapabilityId, title: "List item tree", description: "List recursive Synapse Drive file and folder metadata without reading file contents.", mutates: false },
  { id: "drive.folder_path.ensure" as CapabilityId, title: "Ensure folder path", description: "Create or reuse a nested Synapse Drive folder path.", mutates: true },
  { id: "drive.reorganization.preview" as CapabilityId, title: "Preview reorganization", description: "Validate a Synapse Drive reorganization plan without moving items.", mutates: false },
  { id: "drive.reorganization.apply" as CapabilityId, title: "Apply reorganization", description: "Apply a previously previewed Synapse Drive reorganization plan.", mutates: true },
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
const pageInputProperties = {
  offset: { type: "number", description: "Optional pagination offset. Defaults to 0." },
  limit: { type: "number", description: "Optional pagination page size." },
}
const accessSettingsProperties = {
  passwordEnabled: { type: "boolean", description: "Whether public access should require a password. Defaults to true." },
  expiresIn: { type: "string", enum: driveAccessExpiresInValues, description: "Public access expiration. Defaults to 3d." },
}

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
      name: "drive_item_get",
      description: "Get metadata for one Synapse Drive file or folder. This does not open, download, share, or publish the item.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_file_upload",
      description: "Upload one local file to Synapse Drive using server-prepared direct upload. The result never returns COS credentials, Authorization headers, or presigned upload URLs.",
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
      description: "Upload a local folder to Synapse Drive while preserving relative paths. The result never returns COS credentials, Authorization headers, or presigned upload URLs.",
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
      name: "drive_item_rename",
      description: "Rename a Synapse Drive file or folder. Renaming does not change the item id, existing share links, or existing publication snapshots.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
          name: stringField("New item name."),
        },
        required: ["itemId", "name"],
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
      name: "drive_delete_impact_get",
      description: "Check which active page or site publications would be affected by deleting a Drive item. Call this before drive_item_delete when the user asks about publication impact.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id to evaluate before deletion."),
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
      name: "drive_item_preview_get",
      description: "Get the owner open/preview snapshot for a Drive item. This returns browser state and available URLs; it does not create a share or publication.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id to open or preview."),
          surface: { type: "string", enum: ["standalone", "console"], description: "Preview surface. Defaults to standalone." },
          childrenOffset: { type: "number", description: "Optional child pagination offset for folders." },
          childrenLimit: { type: "number", description: "Optional child pagination page size for folders." },
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_file_content_read",
      description: "Read previewable small text content from a Drive file, such as text, Markdown, or HTML source. Binary, oversized, or non-previewable files should be downloaded with drive_file_download_create.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          maxBytes: { type: "number", description: "Optional maximum UTF-8 bytes to return from preview text." },
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_file_download_create",
      description: "Download a Synapse Drive file to a local path. This writes to the local filesystem and requires fs.write permission.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          outputPath: stringField("Absolute local output file path."),
        },
        required: ["itemId", "outputPath"],
      },
    },
    {
      name: "drive_folder_zip_create",
      description: "Download a Synapse Drive folder as a zip file to a local path. This writes to the local filesystem and requires fs.write permission.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive folder item id."),
          outputPath: stringField("Absolute local output .zip file path."),
        },
        required: ["itemId", "outputPath"],
      },
    },
    {
      name: "drive_share_list",
      description: "List current user's Drive share links for /files/... access. Shares let others browse or download shared files and folders.",
      inputSchema: {
        type: "object",
        properties: pageInputProperties,
      },
    },
    {
      name: "drive_share_create",
      description: "Create or reuse a public Synapse Drive share link and return the /files/... URL. Shares let others browse or download files and folders, not publish HTML as a page or site.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
          ...accessSettingsProperties,
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
      name: "drive_publication_list",
      description: "List current user's Drive publication links for /pages/... and /sites/... access. Publications serve HTML pages or static sites from deployment snapshots.",
      inputSchema: {
        type: "object",
        properties: pageInputProperties,
      },
    },
    {
      name: "drive_page_publication_create",
      description: "Publish an HTML Drive file as a public /pages/... web page. This creates or updates a publication snapshot; use share tools for browse/download links.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive HTML file item id."),
          ...accessSettingsProperties,
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_site_publication_create",
      description: "Publish a Drive folder containing a root index.html as a public /sites/... static site. This creates or updates a publication snapshot; use share tools for browse/download links.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive folder item id."),
          ...accessSettingsProperties,
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_publication_deployment_create",
      description: "Create a new deployment snapshot for an existing Drive publication. This is the MCP equivalent of redeploying a page or site.",
      inputSchema: {
        type: "object",
        properties: {
          publicationId: stringField("Drive publication record id."),
        },
        required: ["publicationId"],
      },
    },
    {
      name: "drive_publication_disable",
      description: "Disable a Drive page or site publication link. This stops public /pages/... or /sites/... access for that publication.",
      inputSchema: {
        type: "object",
        properties: {
          publicationId: stringField("Drive publication record id."),
        },
        required: ["publicationId"],
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
    {
      name: "drive_stats_get",
      description: "Get Synapse Drive item counts and quota usage for the current user.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "drive_item_tree_list",
      description: "Recursively list Synapse Drive file and folder metadata without reading file contents. Use this before organizing Drive files.",
      inputSchema: {
        type: "object",
        properties: {
          parentId: optionalParentId,
          offset: { type: "number", description: "Optional pagination offset across the flattened recursive tree. Defaults to 0." },
          limit: { type: "number", description: "Optional page size. Defaults to 500 and is capped by the server." },
        },
      },
    },
    {
      name: "drive_folder_path_ensure",
      description: "Create or reuse a nested Drive folder path. Fails if any path segment collides with an existing file.",
      inputSchema: {
        type: "object",
        properties: {
          parentId: optionalParentId,
          segments: {
            type: "array",
            description: "Folder names from parent to leaf.",
            items: stringField("Folder name segment."),
          },
        },
        required: ["segments"],
      },
    },
    {
      name: "drive_reorganization_preview",
      description: "Validate a Drive reorganization plan and return a planId. This does not move files or read file contents.",
      inputSchema: {
        type: "object",
        properties: {
          moves: {
            type: "array",
            description: "Items to move by stable id.",
            items: {
              type: "object",
              properties: {
                itemId: stringField("Drive item id to move."),
                targetParentId: optionalParentId,
              },
              required: ["itemId", "targetParentId"],
            },
          },
        },
        required: ["moves"],
      },
    },
    {
      name: "drive_reorganization_apply",
      description: "Apply a previously previewed Drive reorganization plan. Requires planId; raw moves are not accepted.",
      inputSchema: {
        type: "object",
        properties: {
          planId: stringField("Plan id returned by drive_reorganization_preview."),
        },
        required: ["planId"],
      },
    },
  ]
}
