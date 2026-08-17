import type { CapabilityId } from "./naming"
import {
  buildPrimaryMcpToolActions,
  withPrimaryMcpTools,
} from "./mcp-tool-names"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const PUBLIC_ASSET_SUPPORTED_FORMATS = "PNG, JPG, JPEG, GIF, WebP, AVIF, ICO, PDF, DOCX, XLSX, PPTX, TXT, MD, CSV"

const driveCapabilities: readonly CapabilityDefinition[] = [
  { id: "app.drive.item.list" as CapabilityId, title: "List drive items", description: "List Synapse Drive files and folders under a parent folder.", mutates: false },
  { id: "app.drive.item.get" as CapabilityId, title: "Get drive item", description: "Get metadata for one Synapse Drive file or folder.", mutates: false },
  { id: "app.drive.file.upload" as CapabilityId, title: "Upload file", description: "Upload one local file to Synapse Drive once, overwriting the newest same-name file in the target folder. This does not create a persistent local sync binding.", mutates: true },
  { id: "app.drive.folder.upload" as CapabilityId, title: "Upload folder", description: "Upload a local folder to Synapse Drive once, merging same-name folders and overwriting same-name files. This does not create a persistent local sync binding.", mutates: true },
  { id: "app.drive.folder.create" as CapabilityId, title: "Create folder", description: "Create a Synapse Drive folder.", mutates: true },
  { id: "app.drive.item.rename" as CapabilityId, title: "Rename item", description: "Rename a Synapse Drive file or folder.", mutates: true },
  { id: "app.drive.item.move" as CapabilityId, title: "Move item", description: "Move a Synapse Drive file or folder.", mutates: true },
  { id: "app.drive.item.delete" as CapabilityId, title: "Delete item", description: "Move a Synapse Drive file or folder to Drive trash.", mutates: true, risk: "high" },
  { id: "app.drive.item_preview.get" as CapabilityId, title: "Get item preview", description: "Get the owner browser preview snapshot for a Synapse Drive item.", mutates: false },
  { id: "app.drive.file_content.read" as CapabilityId, title: "Read file content", description: "Read previewable text content from a Synapse Drive file.", mutates: false },
  { id: "app.drive.file_download.create" as CapabilityId, title: "Create file download", description: "Download a Synapse Drive file to a local path.", mutates: true },
  { id: "app.drive.file_version.list" as CapabilityId, title: "List file versions", description: "List historical versions for an owned Synapse Drive file.", mutates: false },
  { id: "app.drive.file_version_download.create" as CapabilityId, title: "Create file version download", description: "Download a specific Synapse Drive file version that is not pending cleanup to a local path.", mutates: true },
  { id: "app.drive.file_version.restore" as CapabilityId, title: "Restore file version", description: "Restore a non-current Synapse Drive file version that is not pending cleanup as the current version.", mutates: true },
  { id: "app.drive.file_version.delete" as CapabilityId, title: "Delete file version", description: "Delete a non-current Synapse Drive file version that is not pending cleanup and is not pinned. Unpin retained versions before deleting.", mutates: true, risk: "high" },
  { id: "app.drive.file_version_pin.update" as CapabilityId, title: "Update file version pin", description: "Keep or unkeep a non-current Synapse Drive file version that is not pending cleanup.", mutates: true },
  { id: "app.drive.link.resolve" as CapabilityId, title: "Resolve Drive link", description: "Resolve a Synapse Drive /share, /sites, or /files URL for Agent consumption.", mutates: false },
  { id: "app.drive.link.list" as CapabilityId, title: "List Drive link", description: "List children or resources for a resolved Synapse Drive link.", mutates: false },
  { id: "app.drive.link.read_text" as CapabilityId, title: "Read Drive link text", description: "Read previewable Markdown, HTML source, or text from a Synapse Drive link, including image ids for complete Markdown responses.", mutates: false },
  { id: "app.drive.link.annotation.thread.list" as CapabilityId, title: "List Drive link annotation threads", description: "List all visible annotation threads and projected permissions for a shared Markdown document.", mutates: false },
  { id: "app.drive.link.annotation.thread.create" as CapabilityId, title: "Create Drive link annotation thread", description: "Create an anchored annotation thread on uniquely identified visible text or a projected whole image in a shared Markdown document.", mutates: true },
  { id: "app.drive.link.annotation.comment.create" as CapabilityId, title: "Reply to Drive link annotation", description: "Add a comment or nested reply to an annotation thread in a shared Markdown document.", mutates: true },
  { id: "app.drive.link.annotation.comment.update" as CapabilityId, title: "Update Drive link annotation comment", description: "Edit the current user's annotation comment in a shared Markdown document.", mutates: true },
  { id: "app.drive.link.annotation.comment.delete" as CapabilityId, title: "Delete Drive link annotation comment", description: "Delete one permitted annotation comment with its descendant replies; deleting the first comment removes the thread.", mutates: true },
  { id: "app.drive.link.annotation.thread.delete" as CapabilityId, title: "Delete Drive link annotation thread", description: "Delete one annotation thread when the current user has permission.", mutates: true },
  { id: "app.drive.link.materialize" as CapabilityId, title: "Materialize Drive link", description: "Download a Synapse Drive link into a local cache directory for local Agent tools.", mutates: true },
  { id: "app.drive.link.download_file" as CapabilityId, title: "Download Drive link file", description: "Download one file or public asset from a Synapse Drive link to a local path or cache.", mutates: true },
  { id: "app.drive.folder_zip.create" as CapabilityId, title: "Create folder zip", description: "Download a Synapse Drive folder as a local zip file.", mutates: true },
  { id: "app.drive.share.list" as CapabilityId, title: "List shares", description: "List public Synapse Drive share links for the current user.", mutates: false },
  { id: "app.drive.share.create" as CapabilityId, title: "Create share", description: "Create or reuse a public Synapse Drive share link. Standalone HTML defaults to this route and does not receive sibling relative-resource access unless the user explicitly asks to publish the whole folder as a webpage share. Existing shares keep their settings unless access settings are supplied.", mutates: true },
  { id: "app.drive.share.disable" as CapabilityId, title: "Disable share", description: "Disable a Synapse Drive share link.", mutates: true },
  { id: "app.drive.site.create" as CapabilityId, title: "Create webpage share", description: "Create an independent read-only webpage share from a multi-file Drive folder, or a whole folder explicitly selected by the user, at /sites/<siteId>/. A folder containing only index.html is valid.", mutates: true },
  { id: "app.drive.site.list" as CapabilityId, title: "List webpage shares", description: "List the current user's Drive webpage shares.", mutates: false },
  { id: "app.drive.site.update_access" as CapabilityId, title: "Update webpage share access", description: "Update access mode and expiry settings for a Drive webpage share without changing Drive shares.", mutates: true },
  { id: "app.drive.site.disable" as CapabilityId, title: "Disable webpage share", description: "Disable public access to a Drive webpage share while keeping its record and deployment.", mutates: true },
  { id: "app.drive.site.enable" as CapabilityId, title: "Enable webpage share", description: "Restore public access to a disabled Drive webpage share.", mutates: true },
  { id: "app.drive.site.delete" as CapabilityId, title: "Delete webpage share", description: "Delete a Drive webpage share and make its /sites/<siteId>/ URL inaccessible.", mutates: true, risk: "high" },
  { id: "app.drive.site.republish" as CapabilityId, title: "Update webpage share", description: "Copy the remembered source folder into a new webpage deployment and switch only after success.", mutates: true },
  { id: "app.drive.usage.get" as CapabilityId, title: "Get usage", description: "Get Synapse Drive quota usage for the current user.", mutates: false },
  { id: "app.drive.stats.get" as CapabilityId, title: "Get stats", description: "Get Synapse Drive item counts and quota usage for the current user.", mutates: false },
  { id: "app.drive.item_tree.list" as CapabilityId, title: "List item tree", description: "List recursive Synapse Drive file and folder metadata without reading file contents.", mutates: false },
  { id: "app.drive.folder_path.ensure" as CapabilityId, title: "Ensure folder path", description: "Create or reuse a nested Synapse Drive folder path.", mutates: true },
  { id: "app.drive.reorganization.preview" as CapabilityId, title: "Preview reorganization", description: "Validate a Synapse Drive reorganization plan without moving items.", mutates: false },
  { id: "app.drive.reorganization.apply" as CapabilityId, title: "Apply reorganization", description: "Apply a previously previewed Synapse Drive reorganization plan.", mutates: true },
  { id: "app.drive.sync.snapshot.get" as CapabilityId, title: "Get sync snapshot", description: "Get local Drive sync bindings, operations, conflicts, and health while Synapse is running.", mutates: false },
  { id: "app.drive.sync.binding.preview" as CapabilityId, title: "Preview sync binding", description: "Validate a persistent local file or folder sync binding without creating it.", mutates: false },
  { id: "app.drive.sync.binding.create" as CapabilityId, title: "Create sync binding", description: "Create a persistent local file or folder sync binding after repeating the safety preflight.", mutates: true, risk: "high" },
  { id: "app.drive.sync.binding.pause" as CapabilityId, title: "Pause sync binding", description: "Pause one persistent local Drive sync binding.", mutates: true },
  { id: "app.drive.sync.binding.resume" as CapabilityId, title: "Resume sync binding", description: "Resume and catch up one persistent local Drive sync binding.", mutates: true },
  { id: "app.drive.sync.binding.remove" as CapabilityId, title: "Remove sync binding", description: "Stop and remove one sync binding without deleting the local or Drive content.", mutates: true },
  { id: "app.drive.sync.binding.exclude_rules.update" as CapabilityId, title: "Update sync exclude rules", description: "Replace editable exclude rules for one folder sync binding.", mutates: true },
  { id: "app.drive.sync.binding.rescan" as CapabilityId, title: "Rescan sync binding", description: "Run a complete catch-up scan for one sync binding.", mutates: true },
  { id: "app.drive.sync.conflict.resolve" as CapabilityId, title: "Resolve sync conflict", description: "Resolve one local Drive sync conflict using the user's explicit choice.", mutates: true, risk: "high" },
  { id: "app.drive.direct_link.upload" as CapabilityId, title: "Upload public asset", description: `Upload a supported image or document to Drive 公开素材, also known as 外链, 直链, public asset, or direct link. Supported formats: ${PUBLIC_ASSET_SUPPORTED_FORMATS}; SVG is not supported.`, mutates: true },
  { id: "app.drive.direct_link.list" as CapabilityId, title: "List public assets", description: "List current user's Drive 公开素材 public assets. Access logs are not returned.", mutates: false },
  { id: "app.drive.direct_link.get" as CapabilityId, title: "Get public asset", description: "Get one public asset by assetId without access-log detail.", mutates: false },
  { id: "app.drive.direct_link.update" as CapabilityId, title: "Replace public asset", description: "Replace a public asset file with the same content category while preserving its /files/<assetId> URL. Images can replace images; documents can replace documents.", mutates: true },
  { id: "app.drive.direct_link.rename" as CapabilityId, title: "Rename public asset", description: "Rename a public asset while preserving its /files/<assetId> URL.", mutates: true },
  { id: "app.drive.direct_link.delete" as CapabilityId, title: "Delete public asset", description: "Move a public asset to Drive trash. Its public URL returns 404 until restored.", mutates: true, risk: "high" },
  { id: "app.drive.direct_link.restore" as CapabilityId, title: "Restore public asset", description: "Restore a trashed public asset and make the same public URL available again.", mutates: true },
  { id: "app.drive.trash.list" as CapabilityId, title: "List Drive trash", description: "List user-visible Drive trash, including normal Drive files and public assets.", mutates: false },
  { id: "app.drive.trash.delete" as CapabilityId, title: "Delete from Drive trash", description: "Hide a trashed Drive item from the user. Admins can still see and restore it.", mutates: true, risk: "high" },
  { id: "app.drive.item.restore" as CapabilityId, title: "Restore Drive item", description: "Restore a Drive item from trash.", mutates: true },
]

export const DRIVE_DOMAIN: CapabilityDomainDefinition = {
  id: "drive",
  capabilities: driveCapabilities,
}

export const DRIVE_MCP_TOOL_ACTIONS: Record<string, string> = buildPrimaryMcpToolActions(
  driveCapabilities,
)

const stringField = (description: string) => ({ type: "string", description })
const optionalParentId = {
  anyOf: [
    { type: "string" },
    { type: "null" },
  ],
  description: "Parent folder item id. Omit or pass null to use the Drive root directory.",
}
const driveAccessExpiresInValues = ["3d", "7d", "30d", "1y", "forever"]
const driveShareAccessModeValues = ["link_read", "link_edit", "specified_users_edit"]
const driveSiteAccessModeValues = ["public", "password"]
const driveSiteStatusValues = ["active", "disabled", "expired", "deleted", "failed", "all"]
const pageInputProperties = {
  offset: { type: "number", description: "Optional pagination offset. Defaults to 0." },
  limit: { type: "number", description: "Optional pagination page size." },
}
const shareSearchablePageInputProperties = {
  ...pageInputProperties,
  search: stringField("Optional search text. Matches share id, share record id, or item name."),
}
const publicAssetSearchablePageInputProperties = {
  ...pageInputProperties,
  search: stringField("Optional search text. Public assets match name or assetId."),
}
const trashSearchablePageInputProperties = {
  ...pageInputProperties,
  search: stringField("Optional search text. Trash matches name, original path, or public asset id."),
}
const driveLinkBaseProperties = {
  url: stringField("Absolute Synapse Drive /share, /sites, or /files URL."),
  password: stringField("Optional actual link password. Environment variables are not expanded in MCP parameters; read the variable first or ask the user. Used only for this call and never returned."),
}
const driveLinkAnnotationBaseProperties = {
  ...driveLinkBaseProperties,
  url: stringField("Absolute current Synapse Drive /share URL."),
  path: stringField("Optional share-relative path to a Markdown file. Ignored when itemId is supplied."),
  itemId: stringField("Optional Drive item id inside the share. Takes precedence over path."),
}
const driveLinkAnnotationTargetProperty = {
  description: "Visible Markdown text or a whole Markdown image. Obtain imageId from drive_link_read_text immediately before creating an image thread.",
  oneOf: [
    {
      type: "object",
      properties: {
        exact: { type: "string", minLength: 1, maxLength: 1000, description: "Exact visible text to anchor." },
        prefix: { type: "string", maxLength: 200, description: "Optional visible text immediately before exact for disambiguation." },
        suffix: { type: "string", maxLength: 200, description: "Optional visible text immediately after exact for disambiguation." },
      },
      required: ["exact"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["image"], description: "Whole-image annotation target." },
        imageId: { type: "string", minLength: 1, maxLength: 128, description: "Current image id from drive_link_read_text.markdownImages." },
      },
      required: ["kind", "imageId"],
      additionalProperties: false,
    },
  ],
}
const accessSettingsProperties = {
  passwordEnabled: { type: "boolean", description: "Whether public access should require a password. Defaults to false." },
  expiresIn: { type: "string", enum: driveAccessExpiresInValues, description: "Public access expiration. Defaults to forever." },
  accessMode: { type: "string", enum: driveShareAccessModeValues, description: "Share permission. link_read lets link holders read; link_edit lets link holders edit supported text files only after signing in; specified_users_edit lets only listed emails edit." },
  editorEmails: { type: "array", items: { type: "string" }, description: "Editor email list for specified_users_edit. Leave empty for other access modes." },
}
const sitePasswordField = stringField("Optional custom webpage-share password. Used only when accessMode is password. MCP responses never return site passwords; pass a custom value when the user needs a known password.")
const driveSyncDirectionValues = ["local_to_remote", "remote_to_local", "bind_existing"]
const driveSyncConflictResolutionValues = ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"]
const driveSyncBindingProperties = {
  localPath: stringField("Stable absolute local file or folder path. Never pass a temporary attachment or cache path."),
  direction: {
    type: "string",
    enum: driveSyncDirectionValues,
    description: "Initial sync direction. Use local_to_remote for a new Drive target, remote_to_local for a new local target, or bind_existing only when both sides already match exactly.",
  },
  driveItemId: stringField("Existing owned Drive item id. Required for remote_to_local and bind_existing; omit for local_to_remote."),
  targetParentId: optionalParentId,
  name: stringField("Optional new Drive item name for local_to_remote. Defaults to the local basename."),
  excludeRules: { type: "array", items: { type: "string" }, description: "Optional user exclude rules for a folder binding." },
  useDefaultExcludes: { type: "boolean", description: "Whether to include Synapse recommended folder excludes. Defaults to true." },
  importGitignore: { type: "boolean", description: "Import the current root .gitignore rules once when creating a folder binding. Defaults to false." },
}

export function buildDriveTools(): McpToolDefinition[] {
  return withPrimaryMcpTools([
    {
      name: "drive_item_list",
      description: "List Synapse Drive files and folders with pagination. parentId defaults to root.",
      inputSchema: {
        type: "object",
        properties: {
          parentId: optionalParentId,
          ...pageInputProperties,
        },
      },
    },
    {
      name: "drive_item_get",
      description: "Get metadata for one Synapse Drive file or folder. This does not open, download, or share the item.",
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
      description: "Upload one local file to Synapse Drive once using server-prepared direct upload. This does not create persistent sync; when the user asks to sync, keep synchronized, or upload and sync, use drive_sync_binding_preview then drive_sync_binding_create instead. A same-name file in the target folder is overwritten while preserving its item id and share links. The result never returns COS credentials, Authorization headers, or presigned upload URLs.",
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
      description: "Upload a local folder to Synapse Drive once while preserving relative paths, including empty subdirectories. This does not create persistent sync; when the user asks to sync, keep synchronized, or upload and sync, use drive_sync_binding_preview then drive_sync_binding_create instead. Same-name folders are merged and same-name files are overwritten. The result includes uploadedFiles and createdDirectories relative paths, and never returns COS credentials, Authorization headers, or presigned upload URLs.",
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
      description: "Rename a Synapse Drive file or folder. Renaming does not change the item id or existing share links.",
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
          parentId: {
            ...optionalParentId,
            description: "Target folder item id. Pass null to move to Drive root; do not omit.",
          },
        },
        required: ["itemId", "parentId"],
      },
    },
    {
      name: "drive_item_delete",
      description: "Move a Synapse Drive file or folder to Drive trash.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive item id."),
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_item_preview_get",
      description: "Get the owner open/preview snapshot for a Drive item. This returns browser state and available URLs; it does not create a share.",
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
      name: "drive_file_version_list",
      description: "List historical versions for an owned Synapse Drive file. Shares do not expose version history.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          ...pageInputProperties,
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_file_version_download_create",
      description: "Download a specific Synapse Drive file version that is not pending cleanup to a local path. This writes to the local filesystem and requires fs.write permission.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          versionId: stringField("Drive file version id."),
          outputPath: stringField("Absolute local output file path."),
        },
        required: ["itemId", "versionId", "outputPath"],
      },
    },
    {
      name: "drive_file_version_restore",
      description: "Restore a non-current Synapse Drive file version that is not pending cleanup as the current version.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          versionId: stringField("Drive file version id."),
        },
        required: ["itemId", "versionId"],
      },
    },
    {
      name: "drive_file_version_delete",
      description: "Delete a non-current Synapse Drive file version that is not pending cleanup and is not pinned. Current versions cannot be deleted with this tool; unpin retained versions with drive_file_version_pin_update before deleting. If the result has deletePending: true, report that physical cleanup is still pending.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          versionId: stringField("Drive file version id."),
        },
        required: ["itemId", "versionId"],
      },
    },
    {
      name: "drive_file_version_pin_update",
      description: "Keep or unkeep a non-current Synapse Drive file version that is not pending cleanup.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Drive file item id."),
          versionId: stringField("Drive file version id."),
          isPinned: { type: "boolean", description: "true keeps the version; false lets automatic cleanup remove it later." },
        },
        required: ["itemId", "versionId", "isPinned"],
      },
    },
    {
      name: "drive_link_resolve",
      description: "Resolve a Synapse Drive /share, /sites, or /files URL and return access state plus an Agent-friendly reference. password_required means the password must be supplied as the actual password value. Raw MCP or --json event streams may include tool arguments, so do not save or quote logs containing passwords.",
      inputSchema: { type: "object", properties: driveLinkBaseProperties, required: ["url"] },
    },
    {
      name: "drive_link_list",
      description: "List children for a Drive share folder or resources for a Drive site link. Public assets have no children.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          ...pageInputProperties,
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_read_text",
      description: "Read Markdown, HTML source, JSON, or other previewable text from a Drive link. Complete, untruncated Markdown responses include markdownImages with current imageId values. Use drive_link_download_file for binary files.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          maxBytes: { type: "number", description: "Maximum UTF-8 bytes to return." },
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_annotation_thread_list",
      description: "List every visible annotation thread on a shared .md document, including anchors, authors, nested comments, and per-comment permissions. Returns itemId and canComment. Author emails are redacted. The anchor field is the current authority; target preserves the original quote snapshot.",
      inputSchema: { type: "object", properties: driveLinkAnnotationBaseProperties, required: ["url"] },
    },
    {
      name: "drive_link_annotation_thread_create",
      description: "Create an annotation thread on visible text or one whole projected image in a shared .md document. For an image, first call drive_link_read_text and pass { kind: image, imageId } from markdownImages. The server rejects stale, missing, or ambiguous targets instead of guessing.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkAnnotationBaseProperties,
          target: driveLinkAnnotationTargetProperty,
          body: { type: "string", minLength: 1, maxLength: 4000, description: "Initial comment body." },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 128, description: "Stable caller-generated key. Reuse it when retrying the same creation." },
        },
        required: ["url", "target", "body", "idempotencyKey"],
      },
    },
    {
      name: "drive_link_annotation_comment_create",
      description: "Add a comment to a shared .md annotation thread. Supply parentCommentId to reply to a specific visible comment.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkAnnotationBaseProperties,
          threadId: stringField("Annotation thread id."),
          parentCommentId: { anyOf: [{ type: "string" }, { type: "null" }], description: "Optional parent comment id for a nested reply." },
          body: { type: "string", minLength: 1, maxLength: 4000, description: "Reply body." },
        },
        required: ["url", "threadId", "body"],
      },
    },
    {
      name: "drive_link_annotation_comment_update",
      description: "Edit one annotation comment authored by the current user on a shared .md document.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkAnnotationBaseProperties,
          commentId: stringField("Annotation comment id."),
          body: { type: "string", minLength: 1, maxLength: 4000, description: "Replacement comment body." },
        },
        required: ["url", "commentId", "body"],
      },
    },
    {
      name: "drive_link_annotation_comment_delete",
      description: "Delete one permitted annotation comment and all of its descendant replies on a shared .md document. Deleting the first comment removes the entire thread. Call only when the user explicitly identifies the deletion target.",
      inputSchema: {
        type: "object",
        properties: { ...driveLinkAnnotationBaseProperties, commentId: stringField("Annotation comment id to delete.") },
        required: ["url", "commentId"],
      },
    },
    {
      name: "drive_link_annotation_thread_delete",
      description: "Delete one annotation thread on a shared .md document when permitted. Call only when the user explicitly identifies the deletion target.",
      inputSchema: {
        type: "object",
        properties: { ...driveLinkAnnotationBaseProperties, threadId: stringField("Annotation thread id to delete.") },
        required: ["url", "threadId"],
      },
    },
    {
      name: "drive_link_materialize",
      description: "Download a Drive link into the local Drive link intake cache. Use for HTML prototypes, folders, assets, or local analysis tools; this writes local cache files and is audited as a local write.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          scope: { type: "string", enum: ["entry", "text", "all"], description: "entry downloads only the entry; text downloads previewable text; all downloads all allowed files within limits." },
          maxFiles: { type: "number", description: "Maximum files to write." },
          maxBytes: { type: "number", description: "Maximum total bytes to write." },
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_download_file",
      description: "Download one file, site asset, or public asset from a Drive link. outputPath is optional; omitted writes to cache.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          outputPath: stringField("Optional absolute local output path."),
        },
        required: ["url"],
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
      description: "List current user's Drive share links for /share/... access without returning share passwords. Shares let others browse, render previewable HTML, or download shared files and folders.",
      inputSchema: {
        type: "object",
        properties: shareSearchablePageInputProperties,
      },
    },
    {
      name: "drive_share_create",
      description: "Create or reuse a public Synapse Drive share link and return the /share/... URL. Prefer this route for a standalone HTML file; it does not grant sibling relative-resource access. Use a webpage share only when the user explicitly asks to publish the whole containing folder; merely naming an upload destination folder or casually saying page, website, or site is not explicit folder-publishing intent. Existing shares keep their password, expiry, and access mode unless access settings are supplied. accessMode controls read/edit permission without changing the share link.",
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
      description: "Disable a Synapse Drive share link by record id or public shareId.",
      inputSchema: {
        type: "object",
        properties: {
          shareId: stringField("Drive share record id, item activeShareId, or public shareId such as shr_...."),
        },
        required: ["shareId"],
      },
    },
    {
      name: "drive_site_create",
      description: "Create an independent webpage share from a Drive folder at /sites/<siteId>/. Use this for a multi-file webpage or when the user explicitly asks to publish the whole folder; a folder containing only index.html is valid. Do not infer whole-folder publishing from a standalone HTML upload, an upload destination folder, or casual words such as page, website, or site. The folder is copied at publish time; this does not create a Drive share or grant edit access.",
      inputSchema: {
        type: "object",
        properties: {
          sourceFolderItemId: stringField("Drive folder item id to copy into the webpage deployment."),
          name: stringField("Webpage share display name."),
          entryPath: stringField("Optional HTML entry path inside the folder. Defaults to index.html when available."),
          accessMode: { type: "string", enum: driveSiteAccessModeValues, description: "public for open access, password to require a password. Defaults to public." },
          password: sitePasswordField,
          expiresIn: { type: "string", enum: driveAccessExpiresInValues, description: "Webpage share expiration. Defaults to forever." },
        },
        required: ["sourceFolderItemId", "name"],
      },
    },
    {
      name: "drive_site_list",
      description: "List Drive webpage shares for the current user. Webpage shares use /sites/<siteId>/ and are separate from /share links and /files public assets.",
      inputSchema: {
        type: "object",
        properties: {
          ...pageInputProperties,
          search: stringField("Optional search text for site name, site id, source folder, or entry path."),
          status: { type: "string", enum: driveSiteStatusValues, description: "Optional status filter. Use all or omit to include normal site rows." },
        },
      },
    },
    {
      name: "drive_site_update_access",
      description: "Update a Drive webpage share access mode and expiry without republishing files or changing Drive shares.",
      inputSchema: {
        type: "object",
        properties: {
          siteId: stringField("Public site id from /sites/<siteId>/."),
          accessMode: { type: "string", enum: driveSiteAccessModeValues, description: "public for open access, password to require a password." },
          password: sitePasswordField,
          expiresIn: { type: "string", enum: driveAccessExpiresInValues, description: "Webpage share expiration. Use forever for no expiry." },
        },
        required: ["siteId", "accessMode", "expiresIn"],
      },
    },
    {
      name: "drive_site_disable",
      description: "Disable public access to a Drive webpage share while keeping its record and deployment.",
      inputSchema: {
        type: "object",
        properties: {
          siteId: stringField("Public site id from /sites/<siteId>/."),
        },
        required: ["siteId"],
      },
    },
    {
      name: "drive_site_enable",
      description: "Restore public access to a disabled Drive webpage share.",
      inputSchema: {
        type: "object",
        properties: {
          siteId: stringField("Public site id from /sites/<siteId>/."),
        },
        required: ["siteId"],
      },
    },
    {
      name: "drive_site_delete",
      description: "Delete a Drive webpage share and make its /sites/<siteId>/ URL inaccessible.",
      inputSchema: {
        type: "object",
        properties: {
          siteId: stringField("Public site id from /sites/<siteId>/."),
        },
        required: ["siteId"],
      },
    },
    {
      name: "drive_site_republish",
      description: "Update a Drive webpage share by copying the remembered source folder into a new deployment. The active deployment switches only after success.",
      inputSchema: {
        type: "object",
        properties: {
          siteId: stringField("Public site id from /sites/<siteId>/."),
          entryPath: stringField("Optional replacement HTML entry path inside the source folder."),
        },
        required: ["siteId"],
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
    {
      name: "drive_sync_snapshot_get",
      description: "Get all local Drive sync bindings, current operations, open conflicts, health, and summary counts. Synapse must be running; offline or logged-out state is returned as read-only health.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "drive_sync_binding_preview",
      description: "Preflight a persistent local file or folder sync binding without creating it. Always call this before drive_sync_binding_create. Ready previews include an initialTransfer summary and up to 200 planned file/folder entries; use totalEntries and truncated to detect an abbreviated list. A blocked preview must be reported or corrected rather than bypassed.",
      inputSchema: {
        type: "object",
        properties: driveSyncBindingProperties,
        required: ["localPath", "direction"],
      },
    },
    {
      name: "drive_sync_binding_create",
      description: "Create a persistent local file or folder sync binding. This repeats the complete safety preflight and returns an error result when blocked. Use only for explicit sync intent, never for an ordinary one-time upload.",
      inputSchema: {
        type: "object",
        properties: driveSyncBindingProperties,
        required: ["localPath", "direction"],
      },
    },
    {
      name: "drive_sync_binding_pause",
      description: "Pause one local Drive sync binding by bindingId.",
      inputSchema: {
        type: "object",
        properties: { bindingId: stringField("Sync binding id returned by create or snapshot."), },
        required: ["bindingId"],
      },
    },
    {
      name: "drive_sync_binding_resume",
      description: "Resume and catch up one paused or interrupted local Drive sync binding by bindingId.",
      inputSchema: {
        type: "object",
        properties: { bindingId: stringField("Sync binding id returned by create or snapshot."), },
        required: ["bindingId"],
      },
    },
    {
      name: "drive_sync_binding_remove",
      description: "Stop and remove one local Drive sync binding. Local and Drive content remain in place.",
      inputSchema: {
        type: "object",
        properties: { bindingId: stringField("Sync binding id returned by create or snapshot."), },
        required: ["bindingId"],
      },
    },
    {
      name: "drive_sync_binding_exclude_rules_update",
      description: "Replace editable exclude-rule groups for one folder sync binding. Forced exclusions such as .git/ remain enforced.",
      inputSchema: {
        type: "object",
        properties: {
          bindingId: stringField("Folder sync binding id."),
          defaults: { type: "array", items: { type: "string" }, description: "Complete replacement list of enabled Synapse default rules." },
          importedGitignore: { type: "array", items: { type: "string" }, description: "Complete replacement list of rules previously imported from .gitignore." },
          user: { type: "array", items: { type: "string" }, description: "Complete replacement list of user rules." },
        },
        required: ["bindingId", "defaults", "importedGitignore", "user"],
      },
    },
    {
      name: "drive_sync_binding_rescan",
      description: "Run a complete catch-up scan for one local Drive sync binding and return its refreshed binding state.",
      inputSchema: {
        type: "object",
        properties: { bindingId: stringField("Sync binding id returned by create or snapshot."), },
        required: ["bindingId"],
      },
    },
    {
      name: "drive_sync_conflict_resolve",
      description: "Resolve one open sync conflict using an explicit user choice. keep_local overwrites Drive, keep_remote overwrites local, keep_both is for supported file conflicts, confirm_delete propagates deletion, and skip leaves the conflict open.",
      inputSchema: {
        type: "object",
        properties: {
          conflictId: stringField("Open conflict id returned by drive_sync_snapshot_get."),
          action: { type: "string", enum: driveSyncConflictResolutionValues, description: "Resolution explicitly selected by the user." },
        },
        required: ["conflictId", "action"],
      },
    },
    {
      name: "drive_direct_link_upload",
      description: `Upload a supported image or document to Drive 公开素材 and create a new 外链 / 直链 / public asset / direct link URL at /files/<assetId>. Supported formats: ${PUBLIC_ASSET_SUPPORTED_FORMATS}; SVG is not supported. Duplicate names are allowed. Public documents download as attachments.`,
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringField(`Absolute local file path to upload. Supported formats: ${PUBLIC_ASSET_SUPPORTED_FORMATS}; SVG is not supported.`),
          name: stringField("Optional public asset display name. Defaults to the local file basename."),
          mimeType: stringField("Optional supported MIME type; inferred from the local file path extension when omitted."),
        },
        required: ["filePath"],
      },
    },
    {
      name: "drive_direct_link_list",
      description: "List current user's Drive 公开素材 public assets. Access logs are not returned.",
      inputSchema: {
        type: "object",
        properties: publicAssetSearchablePageInputProperties,
      },
    },
    {
      name: "drive_direct_link_get",
      description: "Get one Drive 公开素材 public asset by assetId without access-log detail.",
      inputSchema: {
        type: "object",
        properties: {
          assetId: stringField("Public asset id from the /files/<assetId> URL."),
        },
        required: ["assetId"],
      },
    },
    {
      name: "drive_direct_link_update",
      description: `Replace a public asset with a supported file in the same content category while preserving its /files/<assetId> URL. Images can replace images; documents can replace documents. Supported formats: ${PUBLIC_ASSET_SUPPORTED_FORMATS}; SVG is not supported.`,
      inputSchema: {
        type: "object",
        properties: {
          assetId: stringField("Public asset id to replace."),
          filePath: stringField(`Absolute local replacement file path. Supported formats: ${PUBLIC_ASSET_SUPPORTED_FORMATS}; SVG is not supported.`),
          name: stringField("Optional replacement display name. Defaults to the local file basename."),
          mimeType: stringField("Optional supported MIME type; inferred from the local file path extension when omitted."),
        },
        required: ["assetId", "filePath"],
      },
    },
    {
      name: "drive_direct_link_rename",
      description: "Rename a Drive 公开素材 public asset while preserving its /files/<assetId> URL.",
      inputSchema: {
        type: "object",
        properties: {
          assetId: stringField("Public asset id to rename."),
          name: stringField("New public asset display name."),
        },
        required: ["assetId", "name"],
      },
    },
    {
      name: "drive_direct_link_delete",
      description: "Move a public asset to Drive trash. Its public URL returns 404 until restored.",
      inputSchema: {
        type: "object",
        properties: {
          assetId: stringField("Public asset id to move to trash."),
        },
        required: ["assetId"],
      },
    },
    {
      name: "drive_direct_link_restore",
      description: "Restore a trashed public asset and make the same public URL available again.",
      inputSchema: {
        type: "object",
        properties: {
          assetId: stringField("Public asset id to restore."),
        },
        required: ["assetId"],
      },
    },
    {
      name: "drive_trash_list",
      description: "List user-visible Drive trash, including normal Drive files and public assets.",
      inputSchema: {
        type: "object",
        properties: trashSearchablePageInputProperties,
      },
    },
    {
      name: "drive_trash_delete",
      description: "Hide a trashed Drive item from the user. Admins can still see and restore it.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Trashed Drive item id to hide from the user."),
        },
        required: ["itemId"],
      },
    },
    {
      name: "drive_item_restore",
      description: "Restore a Drive item from trash. For public_asset rows returned by drive_trash_list, pass kind and assetId.",
      inputSchema: {
        type: "object",
        properties: {
          itemId: stringField("Trashed Drive item id to restore."),
          kind: {
            type: "string",
            enum: ["normal", "public_asset"],
            description: "Trash item kind from drive_trash_list. Pass public_asset together with assetId for public assets.",
          },
          assetId: stringField("Public asset id from drive_trash_list. Required when kind is public_asset."),
        },
        required: ["itemId"],
      },
    },
  ], { sourcePrefix: "drive", primaryPrefix: "app_drive" })
}
