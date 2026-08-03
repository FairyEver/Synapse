# Drive Webpage Sharing Design

Date: 2026-06-23
Scope: `server/`, `desktop/`, `shared/`, `desktop/synapse-capabilities/`, `desktop/resources/templates/skills/synapse-skill/files/drive/`, `docs/`

## Goal

Add Drive folder webpage sharing for static multi-page prototypes and small static sites. `DriveSite` remains the internal model and `/sites/<siteId>/` remains the compatible public route.

Users can choose a Drive folder and create a standalone published site from the folder's current contents. The published site keeps normal static-site relative path behavior, so multiple HTML files, CSS, JavaScript, images, fonts, and nested folders can reference each other with relative URLs.

Site creation is a one-way copy. After creation, the source Drive folder is only a remembered convenience source for future republishing. The published site is managed independently from the Drive folder and remains available even if the source folder is changed, moved, or deleted.

## Confirmed Product Decisions

- Drive rows expose one `分享` action. A folder's share dialog defaults to `文件夹分享` and also offers `网页分享`.
- Files, including standalone HTML files, only use ordinary file sharing. They never implicitly publish their parent folder.
- Switching a folder to `网页分享` runs site preflight and handles entry page, access settings, expiry, and creation result in the same dialog.
- Drive top bar exposes one `分享管理` entry with `文件`、`文件夹`、`网页` tabs.
- The user-facing concept is `网页分享`; `DriveSite` and site API/tool identifiers remain internal compatibility names.
- Creating a site copies the selected folder's current file tree into an independent site deployment.
- The source folder does not own the site after creation. The source may be edited or deleted without changing the published site.
- A site may remember `sourceFolderItemId` and `sourceFolderName` for diagnostics and convenient republish, but public serving must not depend on the source folder.
- The main flow creates one primary site from a folder. Advanced management may allow more than one site to be created from the same source folder later.
- Public site URLs use `/sites/<siteId>/`.
- `siteId` is a public, URL-safe, non-guessable id.
- Root `index.html` is the default entry page.
- If root `index.html` is missing, the creation dialog lets the user choose an HTML file from the folder tree.
- If the folder contains no HTML file, site creation is blocked.
- The first version supports HTML, CSS, JavaScript, images, fonts, and nested static assets.
- Published sites are read-only. Public visitors cannot browse the Drive folder, download the original folder as a Drive object, edit files, comment, or receive Drive share permissions.
- Webpage share access settings support public access, password access, and expiry. Dashboard creation defaults to password access for 3 days.
- Site access settings are independent from Drive share settings. Creating or updating a site must not create or mutate a Drive share.
- Cancelling publication disables public access but keeps the site record, access settings, current deployment, and history.
- Deleting a site is a destructive management action and requires confirmation.
- Republishing creates a new deployment from the remembered source folder if the source still exists. A failed republish never replaces the currently served deployment.
- If the remembered source folder no longer exists, the site remains manageable, but republish from source is unavailable.

## Non-Goals

- Do not build online editing for published site files.
- Do not let public site visitors access Drive folder browsing, original Drive download, comments, or editing.
- Do not use `/share/:shareId` as the public site URL.
- Do not use `/files/:assetId` public asset URLs as the site publishing model.
- Do not add custom domains in the first version.
- Do not add user-defined slugs in the first version.
- Do not add incremental sync or automatic Drive folder watching.
- Do not expose directory listings.
- Do not add complex analytics in the first version.
- Do not make rollback a primary first-version workflow, though the data model can preserve enough history for later rollback.
- Do not add custom UI colors, gradients, marketing copy, or a separate visual system.

## Product Model

The feature has two surfaces:

1. The folder's unified share dialog.
2. The `网页` tab in central share management.

Drive folders are sources, not containers for site state. A created site is an independent resource:

```text
Drive folder at creation time
  ↓ one-way copy
DriveSite
  └─ current DriveSiteDeployment
      └─ DriveSiteAsset(relativePath -> storageKey)
```

The source folder relationship is informational after creation:

```text
sourceFolderItemId exists
  -> republish can copy current source tree

sourceFolderItemId deleted or unavailable
  -> existing site still serves current deployment
  -> access settings, disable, delete, and open link still work
  -> republish from source is disabled
```

This avoids mixing three different concepts:

- Drive share: live access to Drive items.
- Public asset: flat image direct links.
- Webpage share: static read-only website copied from a Drive folder and implemented by DriveSite.

## Folder Webpage Share Flow

The folder row's `分享` action opens the unified share dialog. The default mode is `文件夹分享`; the user must explicitly switch to `网页分享` before any site preflight or snapshot creation occurs.

The creation dialog should be one dialog with clear sections, not a multi-page wizard:

1. **Basic information**
   - Source folder name, read-only.
   - Site name, defaulted from the folder name.
   - Short note that creation copies the current folder contents into a site. Keep the wording operational and brief.

2. **Entry page**
   - Scan the folder tree for HTML files.
   - Prefer root `index.html`.
   - If no root `index.html` exists, show a select control for HTML files.
   - If no HTML exists, block creation with a concise error.

3. **Access settings**
   - Public or password access.
   - Expiry: existing Drive share expiry options can be reused if product language fits.
   - The dialog must not mention editing, Drive sharing, or folder download as visitor abilities.

4. **Preflight**
   - Show file count, total size, entry page, and whether JavaScript files are included.
   - Block invalid paths, duplicate normalized paths, missing storage objects, too many files, and total size over configured limit.
   - Use short errors; do not show implementation details or storage keys.

5. **Completion**
   - Show `/sites/<siteId>/` URL.
   - Actions: copy link, open site, close.

## Webpage Share Management

The Drive top bar includes `分享管理`. Its `网页` tab lists DriveSite-backed webpage shares alongside the separate `文件` and `文件夹` tabs.

Layout requirements:

- Use a large dialog or page-like modal.
- Keep the modal within the viewport.
- Give the modal body a fixed max height and internal scrolling.
- Keep the table header sticky inside the scroll area.
- Avoid horizontal overflow.
- Do not place cards inside cards.
- Use existing shadcn/Radix components and Tailwind tokens.

Recommended table columns:

| Column | Behavior |
| --- | --- |
| Site | Flexible width. Shows site name and short public URL. Single-line truncate for long names. |
| Status | Narrow fixed width. Published, disabled, expired, or failed. |
| Access | Fixed width. Public or password. |
| Expires | Fixed width. Date, relative text, or no expiry. |
| Updated | Fixed width. Last successful deployment time. |
| Size | Narrow fixed width. File count or total size. |
| Actions | Narrow fixed width. One more menu. |

Top controls:

- Search by site name or public id.
- Filter by status.
- Optional refresh button.

Row action menu:

- Open.
- Copy link.
- Access settings.
- Republish.
- Disable / enable.
- Delete.

Dangerous actions:

- Disable site requires confirmation if the site is currently published.
- Delete site requires confirmation and makes the URL inaccessible.

Details:

- Do not expand large details inside table rows.
- If deployment history, file lists, or error detail are needed, use a detail view inside the same modal with a back action to the list.

## Public URL And Path Resolution

Public site URLs use:

```text
GET /sites/<siteId>/
GET /sites/<siteId>/<relativePath>
```

Resolution rules:

- `/sites/<siteId>` redirects to `/sites/<siteId>/`.
- `/sites/<siteId>/` serves the site's configured `entryPath`.
- `/sites/<siteId>/<file>` serves the asset with that normalized relative path.
- `/sites/<siteId>/<folder>/` serves `<folder>/index.html` if it exists.
- `/sites/<siteId>/<folder>` redirects to `/sites/<siteId>/<folder>/` only when `<folder>/index.html` exists.
- Missing files return a concise 404.
- Directories without an index file do not list contents.

Relative links should work without rewriting:

```html
<a href="about.html">
<link rel="stylesheet" href="assets/app.css">
<script src="assets/app.js"></script>
<img src="../images/a.png">
```

The browser resolves those links against `/sites/<siteId>/...`, so the server only needs stable static path semantics.

Path safety:

- Normalize URL paths with `/`.
- Reject empty asset paths except the site root.
- Reject absolute paths.
- Reject `.` and `..` path segments.
- Decode URLs safely and reject malformed encodings.
- Only serve assets belonging to the current deployment.

## Access Control

Site access is independent from Drive share access.

The first version supports:

- Public access.
- Password access.
- Expiry.
- Disabled status.

Password-protected site behavior:

- If a visitor lacks a valid site access cookie, serve a password page for HTML page requests.
- Static asset requests without valid access must not leak content. Navigations receive the password page; subresource requests return 404.
- After successful password entry, set a cookie scoped to the site id.
- Do not include the password in public URLs after unlock.

Expiry behavior:

- Expired sites are inaccessible publicly.
- The management modal still shows expired sites and allows extending expiry.

Public error behavior:

- Unknown site id, disabled site, expired site, missing deployment, and missing asset should avoid exposing owner or source-folder details.

## Data Model

### DriveSite

Stable public identity for a published site.

```prisma
model DriveSite {
  id                  String    @id @default(cuid())
  siteId              String    @unique
  userId              String
  name                String    @db.VarChar(255)
  status              String    @db.VarChar(32)
  accessMode          String    @db.VarChar(32)
  passwordHash        String?
  expiresAt           DateTime?
  currentDeploymentId String?
  sourceFolderItemId  String?
  sourceFolderName    String?   @db.VarChar(255)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  disabledAt          DateTime?
  deletedAt           DateTime?

  @@index([userId, createdAt])
  @@index([userId, status, updatedAt])
  @@index([sourceFolderItemId])
}
```

Field rules:

- `siteId` is public, URL-safe, and non-guessable. Suggested shape: `site_` plus at least 32 random URL-safe characters.
- `status` is `active`, `disabled`, `expired`, or `deleted` at the API DTO level. The database may derive `expired` from `expiresAt`.
- `accessMode` is `public` or `password`.
- `sourceFolderItemId` is optional and must not be required for serving.
- `currentDeploymentId` changes only after a deployment succeeds.

### DriveSiteDeployment

One immutable copied snapshot.

```prisma
model DriveSiteDeployment {
  id          String    @id @default(cuid())
  driveSiteId String
  status      String    @db.VarChar(32)
  entryPath   String    @db.VarChar(1024)
  fileCount   Int
  totalBytes  BigInt
  createdAt   DateTime  @default(now())
  activatedAt DateTime?
  error       String?

  @@index([driveSiteId, createdAt])
  @@index([status])
}
```

Field rules:

- `status` is `pending`, `active`, or `failed`.
- `entryPath` is the normalized relative path served for `/sites/<siteId>/`.
- Failed deployments store a safe error summary and never become current.
- `driveSiteId` points to `DriveSite.id`. The public id remains `DriveSite.siteId`.

### DriveSiteAsset

One file in one deployment.

```prisma
model DriveSiteAsset {
  id           String  @id @default(cuid())
  driveSiteId  String
  deploymentId String
  sourceItemId String?
  relativePath String  @db.VarChar(1024)
  storageKey   String  @unique
  contentType  String? @db.VarChar(255)
  size         BigInt
  sha256       String?

  @@unique([deploymentId, relativePath])
  @@index([driveSiteId, deploymentId])
  @@index([sourceItemId])
}
```

Field rules:

- `relativePath` uses `/`, never starts with `/`, and never contains `.` or `..` segments.
- `sourceItemId` is optional provenance only.
- `sha256` is optional but useful for future integrity checks and deduplication.
- `driveSiteId` points to `DriveSite.id`. Public serving resolves by `DriveSite.siteId`, then uses `currentDeploymentId` and deployment assets.

## Storage Model

Source Drive bytes remain in existing Drive object keys.

Site deployment assets are copied to a site-specific prefix:

```text
drive-sites/<siteId>/<deploymentId>/<relativePath>
```

The storage port should support server-side copy where possible:

```ts
copyObject(input: {
  fromKey: string
  toKey: string
  contentType?: string | null
}): Promise<void>
```

Local storage can implement copy as filesystem copy. COS storage can use object copy to avoid streaming bytes through Synapse when supported.

Site deletion should mark database state first. Physical object cleanup can be asynchronous.

## Service Boundaries

### DriveSiteService

Owns:

- Create site.
- List sites.
- Get site.
- Update access settings.
- Disable and enable site.
- Delete site.
- Republish from remembered source folder.
- Resolve public access state.

### DriveSitePublisher

Owns:

- Reading a Drive folder tree.
- Validating publishability.
- Choosing or validating entry path.
- Normalizing relative paths.
- Enforcing file count and total size limits.
- Copying source objects to deployment storage.
- Creating deployment and asset records.

### DriveSitePublicController

Owns:

- `/sites/<siteId>` and `/sites/<siteId>/*` routes.
- Password unlock route.
- Site access cookie.
- Static asset streaming.
- MIME type, cache headers, and public 404 behavior.

### Desktop Account Bridge

Expose site APIs to renderer:

- `createDriveSite`
- `listDriveSites`
- `updateDriveSiteAccess`
- `disableDriveSite`
- `enableDriveSite`
- `deleteDriveSite`
- `republishDriveSite`

### MCP And Built-In Skill

If Drive site publishing is exposed to agents, update the consolidated Synapse skill under:

```text
desktop/resources/templates/skills/synapse-skill/files/drive/
```

The tools should describe site creation and management separately from Drive shares and public assets. Do not overload `drive_share_create` or `drive_direct_link_upload`.

## Lifecycle Semantics

### Create

Creating a site:

1. Validates the source folder belongs to the user and is active.
2. Builds a recursive file tree snapshot.
3. Validates entry page.
4. Creates `DriveSite`.
5. Creates pending `DriveSiteDeployment`.
6. Copies every eligible source file to `drive-sites/<siteId>/<deploymentId>/<relativePath>`.
7. Creates `DriveSiteAsset` rows.
8. Marks deployment active.
9. Sets `DriveSite.currentDeploymentId`.
10. Returns the site URL.

If creation fails, the site should not appear as active. Partial copied objects are cleaned best-effort or left for maintenance cleanup with safe failed state.

### Republish

Republishing:

- Requires an available remembered source folder.
- Creates a new deployment.
- Uses the same validation as creation.
- Lets the user choose a new entry page if the previous entry path is missing.
- Switches `currentDeploymentId` only after success.
- Leaves the old deployment online if anything fails.

### Disable

Disabling:

- Changes the site status.
- Makes public URLs inaccessible.
- Keeps deployments and management record.
- Can be reversed by enabling if access settings are valid.

### Delete

Deleting:

- Requires confirmation.
- Makes the URL inaccessible.
- Soft-deletes the site record first.
- Schedules object cleanup.
- Does not delete or mutate the remembered source folder.

## Limits And Validation

First-version limits:

- Maximum files per site deployment: 1000.
- Maximum total bytes per site deployment: 200 MB.
- Maximum individual file size: existing Drive file limit.
- Maximum relative path length: 1024 characters.
- Allowed source files: active uploaded files with storage keys and non-missing objects.

Suggested first-version behavior:

- Include all active files with storage keys under the selected folder.
- Reject duplicate normalized paths.
- Reject missing storage objects.
- Reject files with unsupported or unknown state.
- Do not reject JavaScript, but show in preflight that JavaScript is included.

## Testing Requirements

Server tests:

- Creating a site copies folder files into deployment assets.
- Root `index.html` is selected by default.
- Missing `index.html` allows explicit entry path.
- No HTML blocks creation.
- Relative path normalization rejects traversal.
- Duplicate normalized paths are rejected.
- Public route serves `/sites/<siteId>/`, nested HTML, CSS, JS, images, and fonts.
- Folder URLs resolve `folder/index.html`.
- Directory listing is not exposed.
- Password access protects HTML and static assets.
- Expiry blocks public access.
- Source folder deletion does not break an existing site.
- Republish failure keeps the old deployment active.

Dashboard tests:

- File and folder rows expose only `分享`; the old `发布站点` action is absent.
- HTML files only expose ordinary file sharing.
- Folder share creation handles the explicit webpage mode, entry selection, preflight states, protected three-day defaults, and completion URL.
- Top-bar `分享管理` opens one dialog with `文件`、`文件夹`、`网页` tabs.
- Long site names and long tables do not overflow.
- Management actions call the bridge APIs with expected inputs.

Bridge and capability tests:

- Account service calls the correct server endpoints.
- Site management responses do not expose passwords or storage keys.
- MCP capability docs distinguish site publishing from share and public asset tools if tools are added.

## Rollout Notes

The existing `2026-06-09-drive-publication-design.md` is superseded and included both page and site publication. This design intentionally narrows the product to folder-created static sites and makes the copied site independent from its source folder after creation.

The earlier `DrivePublication` table was removed. A new implementation may reuse the snapshot/deployment concept, but should prefer `DriveSite` naming to match the product surface and avoid reviving the old single-page publication scope.
