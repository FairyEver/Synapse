# Drive HTML Publication Design

Date: 2026-06-09
Scope: `server/`, `desktop/`, `shared/`, `dashboard/`, `docs/`

## Goal

Extend Synapse Drive with a publication feature that is separate from existing share links.

Users can publish an HTML file as a web page, or publish a folder that contains `index.html` as a static site. Published pages and sites use snapshot deployments, so later Drive file moves, renames, edits, or deletions do not change the already published content unless the user redeploys or disables the publication.

The first version keeps object storage private. Public page and site URLs are Synapse URLs. Synapse validates the publication record and proxies snapshot objects from storage to the browser.

## Confirmed Product Decisions

- Existing Drive share behavior remains download-oriented and keeps using `/files/<shareId>`.
- Published content uses independent links, not share links.
- A file row can show `发布网页` only for HTML files.
- A folder row can show `发布站点` when publishing a static site. The folder must contain a root-level `index.html`.
- Published content is snapshot based. A deploy copies source Drive objects into a publication snapshot prefix.
- Published content remains accessible if the source Drive file or folder is deleted.
- Users manage published content from a Drive top-bar `已发布` entry.
- Users also manage existing share links from a Drive top-bar `已分享` entry.
- Cancelled publications are not reactivated by the normal publish action. Publishing the same source again after cancellation creates a new `publishId`, so old public URLs are not unexpectedly revived.
- Deleting a Drive file or folder checks related publications. The confirmation dialog offers `同时取消相关发布` when any active publication currently references the deleted item or subtree.
- If the user does not select `同时取消相关发布`, source content is deleted but published snapshots remain accessible.
- If the user selects `同时取消相关发布`, affected active publications are disabled during the delete operation.
- Public HTML and static assets are served through the Synapse server proxy in the first version.
- No first-version size limit is added for page, site, or individual assets.

## Non-Goals

- Do not make the Drive COS bucket public.
- Do not turn existing `/files/<shareId>` links into rendered HTML pages.
- Do not use Drive filenames or folder paths as primary source object keys. Source bytes still live at internal Drive storage keys such as `drive/<itemId>`.
- Do not expose permanent Tencent Cloud credentials to desktop, dashboard, renderer, public routes, MCP responses, or logs.
- Do not build a full hosting platform in the first version: no custom domain UI, no analytics UI, no deploy history UI, no rollback UI, no password protection, no expiration controls, no CDN integration.
- Do not add first-version page or site size limits, though the model must leave room for later quota, traffic, and cleanup policy.
- Do not add marketing-style UI or a separate visual system for publication management.

## Public URL Model

Publication URLs are separate from share URLs:

```text
GET /pages/<publishId>
GET /sites/<publishId>/
GET /sites/<publishId>/<relativePath>
```

`publishId` is a public, URL-safe, non-guessable id owned by a `DrivePublication` record. Recommended format:

```text
pub_<32+ url-safe random chars>
```

Single-page publications and site publications both resolve through the current active deployment.

For a page:

- `/pages/<publishId>` resolves to the current deployment asset at `index.html`.

For a site:

- `/sites/<publishId>` redirects or normalizes to `/sites/<publishId>/`.
- `/sites/<publishId>/` resolves to `index.html`.
- `/sites/<publishId>/<relativePath>` resolves to that exact snapshot asset relative path.

Missing ids, disabled publications, failed deployments, missing current deployments, missing assets, and deleted future access policy failures must show the same public text: `网页未找到`.

## Data Model

### DrivePublication

Stable public identity for a published page or site.

```prisma
model DrivePublication {
  id                  String   @id @default(cuid())
  publishId           String   @unique
  userId              String
  sourceItemId         String?
  type                String
  name                String
  status              String
  currentDeploymentId String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  disabledAt          DateTime?

  @@index([userId, createdAt])
  @@index([sourceItemId, status])
}
```

Field rules:

- `type` is `page` or `site`.
- `status` is `active` or `disabled` in the first version.
- `sourceItemId` points to the page HTML file or the site root folder when the source still exists. It may become null or point to a soft-deleted source after Drive deletion; the publication remains valid because assets are snapshots.
- `currentDeploymentId` points at the currently served deployment. It changes only after a new deployment succeeds.

### DrivePublicationDeployment

One immutable deploy snapshot.

```prisma
model DrivePublicationDeployment {
  id            String   @id @default(cuid())
  publicationId String
  status        String
  createdAt     DateTime @default(now())
  activatedAt   DateTime?
  error         String?

  @@index([publicationId, createdAt])
}
```

Field rules:

- `status` is `pending`, `active`, or `failed`.
- A failed redeploy never changes `DrivePublication.currentDeploymentId`.
- Future rollback can point `currentDeploymentId` back to an older active deployment without changing asset storage.

### DrivePublicationAsset

One file inside one deployment snapshot.

```prisma
model DrivePublicationAsset {
  id            String @id @default(cuid())
  publicationId String
  deploymentId  String
  sourceItemId  String?
  relativePath  String
  storageKey    String @unique
  contentType   String?
  size          BigInt
  sha256        String?

  @@unique([deploymentId, relativePath])
  @@index([sourceItemId])
  @@index([publicationId, deploymentId])
}
```

Field rules:

- Page publications store the source HTML as `relativePath = "index.html"` to share serving logic with sites.
- Site publications store every active file under the source folder as a snapshot asset.
- `relativePath` is normalized with `/`, never absolute, never empty, and never contains `.` or `..` path segments.
- `sourceItemId` is the original Drive file id. This index powers delete impact checks, including a site resource file inside a published site.
- `sha256` is optional for the first version but reserved for cache validation, duplicate detection, and future integrity checks.

## Storage Model

Source Drive bytes stay where they are today:

```text
drive/<driveItemId>
```

Publication snapshots are copied to:

```text
drive-publications/<publicationId>/<deploymentId>/<relativePath>
```

The storage abstraction should add:

```ts
copyObject(input: { fromKey: string; toKey: string; contentType?: string | null }): Promise<void>
getObjectStream(input: { key: string }): Promise<{ stream: NodeJS.ReadableStream; size?: bigint; contentType?: string | null }>
```

`copyObject` avoids routing publish-time bytes through the Synapse server when the backing storage can copy server-side. Local storage can implement it as a file copy.

`getObjectStream` is required because public page and site serving proxies content through Synapse.

Storage deletion for disabled or superseded publication snapshots is not synchronous in the first version. A later maintenance task can clean disabled publication assets and old deployments.

## Publish Flow

### Publish Page

Input: source Drive file id.

Validation:

- The authenticated user owns the item.
- The item is a file.
- The item is active and not deleted.
- The item has a storage key.
- The item is HTML. The first version accepts `.html`, `.htm`, or `mimeType = "text/html"`.

Flow:

1. Create a `DrivePublication` with `type = "page"` or reuse the active publication for the same source item when the user is using the normal `发布网页` action.
2. Create a pending `DrivePublicationDeployment`.
3. Copy the source storage object to `drive-publications/<publicationId>/<deploymentId>/index.html`.
4. Create one `DrivePublicationAsset` with `relativePath = "index.html"`.
5. Mark the deployment active.
6. Atomically set `DrivePublication.currentDeploymentId` to the new deployment and `status = "active"`.
7. Return the publication DTO and public URL.

`重新发布网页` always creates a new deployment. If it fails, the previous current deployment keeps serving.

If the same source item only has disabled publication records, normal `发布网页` creates a new publication with a new `publishId`.

### Publish Site

Input: source Drive folder id.

Validation:

- The authenticated user owns the item.
- The item is a folder.
- The folder is active and not deleted.
- The folder's recursive file tree contains a root-level `index.html`.

Flow:

1. Create a `DrivePublication` with `type = "site"` or reuse the active publication for the same source folder when the user is using the normal `发布站点` action.
2. Create a pending `DrivePublicationDeployment`.
3. Collect the recursive source folder file tree.
4. For every active file with a storage key, compute its normalized relative path from the site root.
5. Reject invalid or duplicate relative paths.
6. Copy every source object to `drive-publications/<publicationId>/<deploymentId>/<relativePath>`.
7. Create one `DrivePublicationAsset` per copied file.
8. Mark the deployment active.
9. Atomically set `DrivePublication.currentDeploymentId` to the new deployment and `status = "active"`.
10. Return the publication DTO and public URL.

If any copy or asset creation fails, mark the deployment failed and leave the previous current deployment untouched.

If the same source folder only has disabled publication records, normal `发布站点` creates a new publication with a new `publishId`.

## Public Serving Flow

Public routes are unauthenticated. They do not read account state.

For `/pages/:publishId`:

1. Resolve an active page publication by `publishId`.
2. Resolve its current active deployment.
3. Resolve `relativePath = "index.html"`.
4. Stream the asset from object storage through Synapse.
5. Return `Content-Type: text/html; charset=utf-8`.

For `/sites/:publishId/*`:

1. Resolve an active site publication by `publishId`.
2. Resolve its current active deployment.
3. Map empty path to `index.html`.
4. Normalize and validate the requested relative path.
5. Resolve the matching asset.
6. Stream the asset from object storage through Synapse.
7. Return a content type based on asset metadata or extension.

Recommended content type fallback:

- `.html`, `.htm`: `text/html; charset=utf-8`
- `.css`: `text/css; charset=utf-8`
- `.js`, `.mjs`: `application/javascript; charset=utf-8`
- `.json`: `application/json; charset=utf-8`
- common image/font/media types from stored mime type or extension
- unknown: `application/octet-stream`

Recommended first-version headers:

```http
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';
```

The CSP is intentionally permissive enough for user-authored static pages. Long term, published pages should be served from a dedicated pages domain.

## Domain And Cookie Isolation

Add a future-facing public pages URL configuration:

```text
PAGES_PUBLIC_URL
```

Publication URLs should be built from `PAGES_PUBLIC_URL` when configured, otherwise from the normal public app URL. This makes it possible to move published pages to a separate subdomain without changing database records.

Security note:

- Same-origin publication serving is acceptable for the first version only if public routes never depend on account cookies.
- Long term, published pages should run on a dedicated domain or subdomain whose cookies are isolated from the main Synapse app.
- Do not send account-specific data to publication public routes.

## User API

Authenticated Drive APIs:

```text
GET    /api/drive/publications
POST   /api/drive/items/:id/publications/page
POST   /api/drive/items/:id/publications/site
POST   /api/drive/publications/:id/redeploy
DELETE /api/drive/publications/:id
GET    /api/drive/items/:id/delete-impact
DELETE /api/drive/items/:id
```

`DELETE /api/drive/items/:id` accepts:

```ts
{
  disablePublications?: boolean
}
```

`GET /api/drive/items/:id/delete-impact` returns publication impact summarized by publication, not by asset:

```ts
{
  publications: Array<{
    id: string
    publishId: string
    type: "page" | "site"
    name: string
    url: string
  }>
}
```

Publication DTO:

```ts
type DrivePublicationDto = {
  readonly id: string
  readonly publishId: string
  readonly type: "page" | "site"
  readonly name: string
  readonly status: "active" | "disabled"
  readonly sourceItemId: string | null
  readonly sourceDeleted: boolean
  readonly url: string
  readonly currentDeploymentId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
```

The existing share API remains separate. A new share listing API is needed for `已分享` management:

```text
GET /api/drive/shares
```

It should list active shares owned by the user with item name, item type, URL, created time, and whether the source item still exists.

## Delete Impact Rules

Deleting a file:

- Check active publications whose current deployment assets include `sourceItemId = deletedFileId`.
- Check active publications whose `sourceItemId = deletedFileId`.
- Return each affected publication once.

Deleting a folder:

- Collect the folder subtree DriveItem ids.
- Check active publications whose current deployment assets include any subtree id.
- Check active publications whose `sourceItemId` is any subtree id.
- Return each affected publication once.

If `disablePublications` is false or omitted:

- Existing Drive delete behavior continues.
- Affected publications remain active and continue serving their snapshot assets.

If `disablePublications` is true:

- Disable affected publications in the same logical operation as deleting source Drive items.
- Set `disabledAt`.
- Do not synchronously delete publication snapshot objects.

This rule covers deleting a resource file inside a published site. For example, if a published site uses `assets/logo.png` and the user deletes only that file, the delete confirmation still offers `同时取消相关发布`.

## Desktop UI

Follow existing Drive UI patterns and shadcn/Radix components. Do not introduce custom colors, custom CSS modules, nested cards, or marketing copy.

Top bar actions:

- `已分享`
- `已发布`

Row action menu:

- HTML file:
  - `发布网页` when no active page publication exists for this source.
  - `重新发布网页` and `取消发布` when an active page publication exists.
- Folder:
  - `发布站点` when no active site publication exists for this source.
  - `重新发布站点` and `取消发布` when an active site publication exists.
- Non-HTML files do not show publication actions.

`已发布` management:

- Use a dialog or sheet inside the Drive module.
- Show active and disabled publications owned by the user.
- Show: name, type, status, source state, updated time, actions.
- Active actions: copy link, open, redeploy, disable.
- Disabled actions: copy link is available for reference, but open and redeploy are hidden.
- If the source is deleted, keep copy/open/disable for active publications and hide redeploy.

`已分享` management:

- Use a sibling dialog or sheet.
- Show active share links with name, type, source state, created time, actions.
- Actions: copy link, open, disable.

Delete confirmation:

- Before showing the confirmation, load delete impact.
- If affected publications exist, show concise text such as `会影响 N 个已发布内容`.
- Show a checkbox: `同时取消相关发布`.
- Keep the current delete confirmation layout otherwise.

## Dashboard UI

The first version can extend the existing Drive admin table with publication status if useful, but it is not required for user-facing publication management.

If admin management is added later, it should use the existing dashboard `ServerDataTable` and shared data-table components. Do not hand-roll table structure on individual dashboard pages.

## Future Extensions

The `Publication + Deployment + Asset` model is intended to support:

- Redeploy history.
- Rollback by changing `currentDeploymentId`.
- Custom domains by binding domains to `DrivePublication`.
- Access statistics keyed by publication and deployment.
- CDN caching keyed by immutable deployment asset paths.
- Quota or traffic limits.
- Async cleanup of disabled publications and old deployments.
- Password and expiry policies on publications.
- A dedicated pages domain through `PAGES_PUBLIC_URL`.

These are not first-version requirements.

## Test Plan

Server tests:

- Publish page accepts `.html`, `.htm`, and `text/html`.
- Publish page rejects non-HTML, folder, inactive, and deleted items.
- Publish page creates publication, deployment, and `index.html` asset.
- Publish site requires root `index.html`.
- Publish site snapshots recursive active files with normalized relative paths.
- Publish site rejects duplicate, absolute, empty, `.` and `..` relative paths.
- Redeploy success switches `currentDeploymentId`.
- Redeploy failure leaves the previous deployment active.
- Public page route returns HTML through server proxy.
- Public site index and resource routes return matching assets through server proxy.
- Disabled, missing, failed, or missing-asset public routes return `网页未找到`.
- Public responses include content type, `X-Content-Type-Options`, `Referrer-Policy`, and CSP.
- Delete impact detects a published page source file.
- Delete impact detects a published site root folder.
- Delete impact detects a child resource file inside a published site.
- Delete with `disablePublications=false` keeps publication active.
- Delete with `disablePublications=true` disables affected publications.

Desktop tests:

- HTML file rows show publication actions.
- Ordinary file rows do not show publication actions.
- Folder rows show site publication actions.
- Top bar shows `已分享` and `已发布`.
- Published management lists active publications and handles source-deleted rows.
- Delete confirmation shows the publication checkbox only when delete impact contains publications.
- Delete submission passes `disablePublications` according to the checkbox.

Shared tests:

- Publication URL builders produce `/pages/<publishId>` and `/sites/<publishId>/`.
- Publication URL masking redacts publish ids in logs.
- DTO schemas cover `page`, `site`, `sourceDeleted`, active and disabled status.
