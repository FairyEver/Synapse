# Drive Link Intake Design

Date: 2026-06-28
Scope: `shared/`, `server/`, `desktop/electron/`, `desktop/synapse-capabilities/`, `desktop/resources/templates/skills/synapse-skill/files/drive/`, `website/developer/`

## Goal

Add a Drive link intake capability for local Agents: linked content remains read-only, while shared Markdown annotations can be managed through existing comment permissions.

The first target workflow is a developer receiving a Synapse Drive link from a product manager, then asking Codex, Claude Code, Cursor, or another local Agent to read the link through Synapse MCP and analyze the product material. The link may point to a Markdown requirement file, a shared folder containing multiple Markdown or HTML files, a Drive-published static site, or a public asset.

The capability should expose raw material to the Agent, not perform product analysis inside MCP. Agents can then decide how to summarize requirements, inspect HTML prototypes, generate implementation tasks, or download assets.

## Confirmed Product Decisions

- Do not build team spaces, team roles, organization permissions, or team ownership in this version.
- Keep existing Drive share permissions: read-only link, editable link for logged-in users, and editable link for specified emails.
- Drive Link Intake never edits shared file content or imports it into the current user's Drive. For current-origin `/share/...` `.md` documents only, it can list visible annotations and perform comment mutations through the existing annotation service and permission model.
- Support password-protected share and site links through an optional `password` input.
- Never persist, log, or return link passwords.
- Prefer a group of small MCP tools over one large black-box intake tool.
- Online text reads are the primary path for Markdown, HTML source, and other previewable text.
- Local materialization is the secondary path for HTML prototypes, folders, assets, binary files, or workflows that need local filesystem tools.
- v1 returns raw material packages: file trees, text content, local paths, resource metadata, skipped entries, and warnings. It does not return a generated product summary.

## Supported Links

v1 supports Synapse Drive public URLs:

```text
/share/<shareId>
/share/<shareId>/items/<itemId>
/sites/<siteId>/
/sites/<siteId>/<path>
/files/<assetId>
```

The tools should accept absolute Synapse URLs and should reject unsupported or malformed URLs with a clear error. They should not fetch arbitrary internet URLs in v1.

## Non-Goals

- Do not add team spaces or department folders.
- Do not add team member management.
- Do not add new share access modes.
- Do not edit shared Markdown or HTML through link intake tools.
- Do not expose annotations for `/sites`, `/files`, folders, or non-`.md` files.
- Do not expose document editing, presence, online-member state, or collaboration-room control.
- Do not import a shared link into the current user's Drive.
- Do not crawl arbitrary public websites.
- Do not make public asset access logs available through MCP.
- Do not store passwords or reuse them across calls.
- Do not turn MCP into a product-requirement analyzer.

## Product Model

Existing Drive MCP tools operate on the current user's own Drive:

```text
app_drive_item_list
app_drive_file_content_read
app_drive_file_download_create
app_drive_share_create
...
```

New Drive Link MCP tools operate on content delivered by URL:

```text
app_drive_link_resolve
app_drive_link_list
app_drive_link_read_text
app_drive_link_annotation_thread_list
app_drive_link_annotation_thread_create
app_drive_link_annotation_comment_create
app_drive_link_annotation_comment_update
app_drive_link_annotation_comment_delete
app_drive_link_annotation_thread_delete
app_drive_link_annotation_anchor_update
app_drive_link_materialize
app_drive_link_download_file
```

This keeps the mental model clean:

```text
Existing Drive MCP: manage my Drive.
Drive Link MCP: consume a Drive link someone sent me, and manage comments on its shared Markdown document.
```

Agents should normally follow this sequence:

```text
resolve -> list -> read_text -> materialize or download_file when needed
```

## MCP Tools

### `app_drive_link_resolve`

Identifies a Drive URL, validates access, and returns a stable reference for follow-up calls.

Input:

```json
{
  "url": "https://synapse.example/share/shr_xxx",
  "password": "optional"
}
```

Output shape:

```json
{
  "ok": true,
  "linkType": "share | share_item | site | site_path | public_asset",
  "access": {
    "status": "ok | password_required | login_required | not_found",
    "canRead": true,
    "canList": true,
    "canReadText": true,
    "canDownload": true
  },
  "root": {
    "name": "需求评审",
    "type": "file | folder | site | asset",
    "previewKind": "markdown | html | text | image | download-only"
  },
  "ref": {
    "kind": "share | site | public_asset",
    "shareId": "shr_xxx",
    "itemId": null,
    "siteId": null,
    "path": null,
    "assetId": null
  }
}
```

### `app_drive_link_list`

Lists children for a share folder or site path. Public assets do not have children.

Input:

```json
{
  "url": "https://synapse.example/share/shr_xxx",
  "password": "optional",
  "path": "optional",
  "itemId": "optional",
  "offset": 0,
  "limit": 100
}
```

Output shape:

```json
{
  "items": [
    {
      "path": "需求说明.md",
      "name": "需求说明.md",
      "type": "file",
      "mimeType": "text/markdown",
      "previewKind": "markdown",
      "size": "12000"
    }
  ],
  "page": {
    "hasMore": false,
    "nextOffset": null
  }
}
```

### `app_drive_link_read_text`

Reads Markdown, HTML source, plain text, JSON, or other previewable text from one linked item or site path.

Input:

```json
{
  "url": "https://synapse.example/share/shr_xxx/items/item_xxx",
  "password": "optional",
  "itemId": "optional",
  "path": "optional",
  "maxBytes": 131072
}
```

Output shape:

```json
{
  "path": "需求说明.md",
  "mimeType": "text/markdown",
  "previewKind": "markdown",
  "text": "...",
  "truncated": false,
  "source": {
    "linkType": "share",
    "versionId": "optional"
  }
}
```

This tool must reject binary and non-previewable files with a clear message suggesting `app_drive_link_download_file`.

### `app_drive_link_materialize`

Downloads a linked share, share folder, site, or selected entry into a local temporary directory for local Agent tools.

Input:

```json
{
  "url": "https://synapse.example/sites/site_xxx/",
  "password": "optional",
  "scope": "entry | text | all",
  "maxFiles": 200,
  "maxBytes": 52428800
}
```

Scope semantics:

- `entry`: download only the linked entry or site entry page plus a manifest.
- `text`: download previewable text files and preserve relative paths; list binary assets as skipped metadata.
- `all`: download all allowed files until limits are reached.

Output shape:

```json
{
  "localRootPath": "/Users/<user>/Library/Application Support/Synapse/drive-link-intake/run_xxx",
  "manifestPath": "/Users/<user>/Library/Application Support/Synapse/drive-link-intake/run_xxx/manifest.json",
  "entryPath": "/Users/<user>/Library/Application Support/Synapse/drive-link-intake/run_xxx/content/需求说明.md",
  "files": [
    {
      "relativePath": "需求说明.md",
      "kind": "markdown",
      "size": "12000"
    }
  ],
  "skipped": [],
  "warnings": []
}
```

Materialization writes a local cache copy only. It must not write into the user's project unless the user explicitly asks for a target path through a download tool.

### `app_drive_link_download_file`

Downloads one linked file, site asset, or public asset.

Input:

```json
{
  "url": "https://synapse.example/files/asset_xxx",
  "password": "optional",
  "itemId": "optional",
  "path": "optional",
  "outputPath": "optional"
}
```

Output shape:

```json
{
  "localPath": "/Users/<user>/Library/Application Support/Synapse/drive-link-intake/run_xxx/content/file.png",
  "mimeType": "image/png",
  "size": "102400"
}
```

When `outputPath` is omitted, the file is written under the Drive link intake cache directory. When `outputPath` is supplied, normal local file write permission and audit behavior must apply.

## Typical Workflows

### Markdown Requirement Link

```text
User: 用 SY MCP 分析这个需求链接：https://.../share/shr_xxx

Agent:
1. app_drive_link_resolve
2. app_drive_link_read_text
3. Analyze the returned Markdown text locally.
```

### Folder Delivery Package

```text
Delivery folder:
  需求说明.md
  页面流程.md
  assets/
  prototype/index.html
  验收清单.md

Agent:
1. app_drive_link_resolve
2. app_drive_link_list
3. Read likely entry documents with app_drive_link_read_text.
4. Materialize only if local inspection of prototype or attachments is needed.
```

### HTML Prototype Site

```text
User: 用 SY MCP 分析这个 HTML 原型：https://.../sites/site_xxx/

Agent:
1. app_drive_link_resolve
2. app_drive_link_list
3. app_drive_link_read_text for index.html or selected pages.
4. app_drive_link_materialize(scope="all") when relative CSS, JS, images, or screenshots are needed.
```

### Public Asset

```text
User provides https://.../files/asset_xxx

Agent:
1. app_drive_link_resolve
2. If local image inspection is needed, app_drive_link_download_file.
```

## Architecture

### Shared Types

Add Link Intake DTOs to `shared/src/drive.ts`:

- `DriveLinkResolveInput`
- `DriveLinkResolveDto`
- `DriveLinkListInput`
- `DriveLinkListDto`
- `DriveLinkReadTextInput`
- `DriveLinkReadTextDto`
- `DriveLinkMaterializeInput`
- `DriveLinkMaterializeDto`
- `DriveLinkDownloadFileInput`
- `DriveLinkDownloadFileDto`
- `DriveLinkRefDto`
- `DriveLinkAccessDto`
- `DriveLinkEntryDto`

These DTOs are separate from `DriveBrowserSnapshotDto`. Browser snapshots are UI-oriented; link intake DTOs are Agent-oriented.

### Server

Add a focused service:

```text
server/src/drive/drive-link-intake.service.ts
```

Reuse existing Drive services and access checks:

- Shares: `DriveService.resolvePublicShareAccess`, `DriveService.getShareBrowserSnapshot`, `DriveService.openShareBrowserItemDownload`.
- Sites: `DriveSiteService.resolvePublicSite`, `DriveStoragePort.getObjectStream`.
- Public assets: `DrivePublicAssetService.resolvePublicAsset`.

Do not duplicate share password, cookie, expiry, or edit-access logic. Link intake should ask existing services whether a URL is readable and then project that result into Agent-friendly DTOs.

### Electron

Extend `desktop/electron/services/account-service.ts` with methods matching the new tools:

- `resolveDriveLink`
- `listDriveLink`
- `readDriveLinkText`
- `materializeDriveLink`
- `downloadDriveLinkFile`

Materialization and default downloads should use a Drive link intake cache under Electron `userData`, for example:

```text
<userData>/drive-link-intake/<run-id>/
  manifest.json
  content/
```

The manifest records source URL, resolved link type, entry, fetched files, skipped files, warnings, timestamps, and size totals. It must not record passwords.

### MCP Capability Domain

Add capabilities in `desktop/synapse-capabilities/shared/drive-domain.ts`:

```text
app.drive.link.resolve
app.drive.link.list
app.drive.link.read_text
app.drive.link.materialize
app.drive.link.download_file
```

MCP tool names:

```text
app_drive_link_resolve
app_drive_link_list
app_drive_link_read_text
app_drive_link_materialize
app_drive_link_download_file
```

Legacy aliases should follow the existing Drive pattern:

```text
drive_link_resolve
drive_link_list
drive_link_read_text
drive_link_materialize
drive_link_download_file
```

### Capability Dispatcher

Extend `desktop/electron/capabilities/drive-dispatcher.ts` with `drive.link.*` dispatcher actions, matching the existing Drive dispatcher convention. Resolve, list, and text reads are non-mutating. Materialize and download tools do not mutate remote Drive content, but they write local files and must use existing permission and audit boundaries for local file writes.

Risk classification:

- `link.resolve`: read-only.
- `link.list`: read-only.
- `link.read_text`: read-only.
- `link.materialize`: mutates local filesystem.
- `link.download_file`: mutates local filesystem.

## Limits And Safety

- All recursive operations must enforce `maxFiles` and `maxBytes`.
- Text reads must enforce `maxBytes` and return `truncated`.
- Materialization must preserve relative paths safely and reject path traversal.
- Site materialization must preserve relative paths so HTML, CSS, JS, and image references remain usable locally.
- Unsupported files should be listed in `skipped` with a reason.
- Results must redact or omit passwords.
- Logs must not contain passwords, full signed URLs, cookies, Authorization headers, or raw large document bodies.
- Public asset access logs remain admin-only.

## Documentation Updates

Because this changes Drive MCP capabilities, implementation must update:

- `desktop/synapse-capabilities/shared/drive-domain.ts`
- `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`
- `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`
- `website/developer/capability-naming-matrix.md`

The Drive skill should teach Agents:

```text
If the user provides a /share, /sites, or /files URL, use app_drive_link_* tools.
If the user asks to manage their own Drive files, use existing drive_* owner tools.
Prefer resolve -> list -> read_text, and materialize only when local files are useful.
```

Annotation tools accept the same URL/password/item/path selection model, with `itemId` taking precedence. Thread creation and reassociation accept only `{ exact, prefix?, suffix? }`; the server reads the current Markdown projection/version and generates V2 selectors. Missing and ambiguous targets are distinct errors and must never be guessed. Passwords and comment bodies are excluded from audits. Deletion is an ordinary mutation, while Agent guidance still requires an explicitly identified target.

## Testing

Server tests should cover:

- Resolving share file, share folder, share item, site root, site path, and public asset URLs.
- Password-required links without password.
- Password-protected links with correct and incorrect passwords.
- Not-found and expired links.
- Listing share folder children.
- Listing site assets or pages.
- Reading Markdown and HTML text.
- Rejecting binary reads.
- Materialization limits, skipped files, and path traversal protection.

Electron tests should cover:

- Account service URL construction and password redaction.
- Dispatcher action mapping.
- Permission checks and audit metadata for local writes.
- Default cache directory writes.

Capability tests should cover:

- New primary and legacy MCP tool names.
- Mutating and non-mutating capability metadata.
- Input schemas for URL, password, item/path selection, limits, scope, and output path.

Template tests or content checks should cover:

- Synapse skill Drive guide mentions the link intake flow.
- API reference documents all twelve Drive Link tools.
- Capability naming matrix includes the new capabilities.
