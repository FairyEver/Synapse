# Drive File Browser Console Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Drive file browser承接页 and route normalization in one scoped change: `/console/` replaces `/dashboard/` as the canonical Web console, `/api/console/*` replaces `/api/dashboard/*` with compatibility aliases, owners can browse and preview their own Drive files at `/drive/items/:rootItemId`, console users get a `网盘` sidebar entry backed by the same Drive data, shared resources use the same browser at `/files/:shareId`, and published pages/sites continue to render directly at `/pages/*` and `/sites/*`.

**Architecture:** Reuse the dashboard React bundle for four browser surfaces:

- `/console/*`: authenticated console SPA.
- `/console/drive*`: authenticated user Drive page inside the console shell, with management actions around the shared browser/preview core.
- `/drive/items/*`: owner standalone file browser routes, served by the same SPA but backed by authenticated Drive browser APIs.
- `/files/*`: shared file browser routes, served by the same SPA but backed by public share browser APIs and password access state.

The reusable FileBrowser component is context-driven. It receives a browser snapshot from the API and never knows whether access came from an owner session, console surface, or share token except through explicit context and capability flags. Publish rendering stays outside this component.

**Tech Stack:** NestJS, Prisma, React 19, TanStack Router, TanStack Query, shadcn/Radix UI, Tailwind utilities, Vitest.

---

## Current State

- `dashboard/src/main.tsx` creates the TanStack router with `basepath: '/dashboard'`.
- `dashboard/vite.config.ts` uses `base: '/dashboard/'` and opens `/dashboard/`.
- `server/nginx.conf` serves the dashboard bundle at `/dashboard/` and redirects `/` to `/dashboard/`.
- Control-plane APIs are exposed under `/api/dashboard/*`.
- Existing public Drive share pages are server-rendered HTML in `server/src/drive/drive.controller.ts`.
- Existing publish routes `/pages/:publishId` and `/sites/:publishId/*` already render HTML directly and should not become file browser pages.

---

## Target Route Contract

Console:

```text
GET /console/
GET /console/*
GET /dashboard
GET /dashboard/
GET /dashboard/*
```

- `/console/` is canonical.
- `/dashboard*` redirects with HTTP 301 to the matching `/console*` URL.
- New generated Web console links use `/console/`.

Console API:

```text
/api/console/*
/api/dashboard/*
```

- `/api/console/*` is canonical.
- `/api/dashboard/*` remains as a compatibility alias.
- API aliases do not redirect.

Owner Drive browser:

```text
GET /drive/items/:rootItemId
GET /drive/items/:rootItemId/download
GET /drive/items/:rootItemId/zip
GET /drive/items/:rootItemId/render
GET /drive/items/:rootItemId/items/:browserItemId
GET /drive/items/:rootItemId/items/:browserItemId/download
GET /drive/items/:rootItemId/items/:browserItemId/zip
GET /drive/items/:rootItemId/items/:browserItemId/render
```

- `/drive/items/:rootItemId` is the owner standalone browser root page.
- `/drive/items/:rootItemId/items/:browserItemId` opens a child item under that root.
- Download, zip, and HTML render routes stay server responses.
- Owner render routes are owner-only and HTML-only.

Console Drive browser:

```text
GET /console/drive
GET /console/drive/items/:rootItemId
GET /console/drive/items/:rootItemId/items/:browserItemId
```

- `/console/drive` is the logged-in user's virtual Drive root.
- Console routes use the same FileBrowser and PreviewRenderer but render inside the authenticated console layout.
- The user sidebar label is `网盘`.
- The existing admin-only Drive management page must not conflict with the user `网盘` route; migrate it to an admin route such as `/admin-drive` and label it `云盘管理`.

Share Drive browser:

```text
GET /files/:shareId
GET /files/:shareId/download
GET /files/:shareId/zip
GET /files/:shareId/items/:browserItemId
GET /files/:shareId/items/:browserItemId/download
GET /files/:shareId/items/:browserItemId/zip
```

- `/files/:shareId` is the share root browser page.
- `/files/:shareId/items/:browserItemId` opens a child item inside the shared tree.
- Share browser never exposes the owner-only HTML `访问` action.

Down-drill rule:

```text
context root URL
context root URL + /items/:browserItemId
```

Owner, share, and console all follow this rule. Only the context root differs.

Publish:

```text
GET /pages/:publishId
GET /sites/:publishId/
GET /sites/:publishId/*
```

- These routes continue to directly render published HTML/site assets.
- They must not mount the FileBrowser UI.

---

## Files To Change

Route hosting and API namespace:

```text
dashboard/package.json
dashboard/vite.config.ts
dashboard/src/main.tsx
dashboard/src/lib/api.ts
dashboard/src/lib/api.test.ts
dashboard/src/lib/dashboard-redirect.ts
dashboard/src/lib/dashboard-redirect.test.ts
dashboard/src/lib/dashboard-sign-out.test.ts
dashboard/src/components/layout/data/sidebar-data.ts
dashboard/src/components/layout/data/sidebar-data.test.ts
server/nginx.conf
server/src/admin-auth/admin-auth.controller.ts
server/src/dashboard/dashboard.controller.ts
server/src/live/live.controller.ts
server/src/webhooks/webhook.controller.ts
server/src/deploy-config.spec.ts
server/src/invitations/invitation-url.spec.ts
server/src/invitations/invitations.service.spec.ts
server/src/admin/admin.service.spec.ts
server/src/admin/admin.controller.spec.ts
server/README.md
```

Shared Drive browser contract:

```text
shared/src/drive.ts
shared/src/drive.test.ts
```

Server Drive browser:

```text
server/src/drive/drive-browser.ts
server/src/drive/drive-browser.spec.ts
server/src/drive/drive.controller.ts
server/src/drive/drive.service.ts
server/src/drive/drive.service.spec.ts
```

Dashboard FileBrowser UI:

```text
dashboard/src/routes/_authenticated/admin-drive/index.tsx
dashboard/src/routes/_authenticated/drive/index.tsx
dashboard/src/routes/drive/items/$rootItemId.tsx
dashboard/src/routes/drive/items/$rootItemId/items/$browserItemId.tsx
dashboard/src/routes/_authenticated/drive/items/$rootItemId.tsx
dashboard/src/routes/_authenticated/drive/items/$rootItemId/items/$browserItemId.tsx
dashboard/src/routes/files/$shareId.tsx
dashboard/src/routes/files/$shareId/items/$browserItemId.tsx
dashboard/src/features/drive-browser/index.tsx
dashboard/src/features/drive-browser/drive-console-page.tsx
dashboard/src/features/drive-browser/file-browser-page.tsx
dashboard/src/features/drive-browser/file-browser-table.tsx
dashboard/src/features/drive-browser/file-preview-panel.tsx
dashboard/src/features/drive-browser/password-access-form.tsx
dashboard/src/features/drive-browser/use-drive-browser.ts
dashboard/src/features/drive-browser/drive-browser.test.tsx
dashboard/src/routeTree.gen.ts
```

Release notes:

```text
RELEASE_NOTES_PENDING.md
```

---

## Phase 1: Normalize Console Routes

Checklist:

- [ ] Switch dashboard build and router base to `/console`.
- [ ] Move dashboard API client to `/api/console`.
- [ ] Add server `/api/console` aliases.
- [ ] Redirect `/dashboard*` to `/console*`.
- [ ] Reserve `/console/drive` for the user `网盘` page and move the admin Drive page out of that route.
- [ ] Update generated links and redirect normalization.
- [ ] Run Phase 1 focused tests.
- [ ] Commit Phase 1.

### Task 1.1: Switch dashboard build and router base to `/console`

Modify `dashboard/package.json`:

- Change dev open path from `/dashboard/` to `/console/`.

Modify `dashboard/vite.config.ts`:

- Change Vite `base` from `/dashboard/` to `/console/`.
- Keep `/api`, `/webhooks`, `/pages`, and `/sites` proxies.
- Replace the broad `/files` proxy with explicit download/zip proxies after Phase 5, because `/files/:shareId` becomes an SPA route.
- Add explicit `/drive/.../download`, `/drive/.../zip`, and `/drive/.../render` proxies after Phase 5, because `/drive/items/:rootItemId` and `/drive/items/:rootItemId/items/:browserItemId` become SPA routes.

Modify `dashboard/src/main.tsx`:

- Replace the fixed router basepath with a helper:

```ts
function resolveRouterBasepath(pathname: string) {
  return pathname === '/console' || pathname.startsWith('/console/') ? '/console' : '/'
}
```

- Use `basepath: resolveRouterBasepath(window.location.pathname)`.

Expected behavior:

- Console routes resolve under `/console/*`.
- File browser routes resolve at root-level `/drive/*` and `/files/*` when the same bundle is served for those paths.

### Task 1.2: Move dashboard API client to `/api/console`

Modify `dashboard/src/lib/api.ts`:

- Introduce:

```ts
const consoleApiBasePath = '/api/console'
const legacyDashboardApiBasePath = '/api/dashboard'
```

- Use `consoleApiBasePath` for all `dashboardApi` requests.
- Keep auth-expired detection compatible with both `consoleApiBasePath` and `legacyDashboardApiBasePath`.

Modify `dashboard/src/lib/api.test.ts`:

- Update current expectations from `/api/dashboard/*` to `/api/console/*`.
- Add one auth-expired test proving `/api/dashboard/session` still participates in the auth-expired path compatibility check.

### Task 1.3: Add server `/api/console` aliases

Modify these controllers:

- `server/src/admin-auth/admin-auth.controller.ts`
- `server/src/dashboard/dashboard.controller.ts`
- `server/src/webhooks/webhook.controller.ts`

Use Nest controller path arrays:

```ts
@Controller(['/api/console', '/api/dashboard'])
```

Modify `server/src/live/live.controller.ts`:

- It currently declares full method paths directly. Add `/api/console/...` entries beside each existing `/api/dashboard/...` path.
- Keep existing `/api/admin/live...` routes unchanged.

Add or update tests:

- Existing endpoint tests should assert canonical `/api/console/*`.
- Add narrow compatibility assertions for representative old routes:
  - `/api/dashboard/session`
  - `/api/dashboard/webhooks`
  - `/api/dashboard/live-clients`

### Task 1.4: Redirect `/dashboard*` to `/console*`

Modify `server/nginx.conf`:

- Add `/console/` static hosting:

```nginx
location = /console {
  return 301 /console/;
}

location /console/ {
  alias /app/dashboard/dist/;
  try_files $uri $uri/ /console/index.html;
}
```

- Replace old dashboard hosting with redirects:

```nginx
location = /dashboard {
  return 301 /console/;
}

location /dashboard/ {
  return 301 /console/$is_args$args;
}
```

- Preserve deep paths using a regex redirect:

```nginx
location ~ ^/dashboard/(.*)$ {
  return 301 /console/$1$is_args$args;
}
```

- Change `/` redirect to `/console/`.

Modify `server/src/deploy-config.spec.ts`:

- Assert `/console/` is the served dashboard path.
- Assert `/dashboard*` redirects to `/console*`.

### Task 1.5: Update generated links and redirect normalization

Modify `dashboard/src/lib/dashboard-redirect.ts`:

- Change canonical base from `/dashboard` to `/console`.
- Optionally keep old `/dashboard` parsing so old redirects normalize safely after the server redirect.

Modify tests:

- `dashboard/src/lib/dashboard-redirect.test.ts`
- `dashboard/src/lib/dashboard-sign-out.test.ts`

Modify invitation/admin tests:

- `server/src/invitations/invitation-url.spec.ts`
- `server/src/invitations/invitations.service.spec.ts`
- `server/src/admin/admin.service.spec.ts`
- `server/src/admin/admin.controller.spec.ts`

Expected:

- New invite URLs use `/console/team-invite?...`.
- Old `/dashboard/team-invite?...` remains reachable through Nginx redirect.

### Task 1.6: Reserve `/console/drive` for user Drive

Modify dashboard route files:

- Move current admin-only route from `dashboard/src/routes/_authenticated/drive/index.tsx` to `dashboard/src/routes/_authenticated/admin-drive/index.tsx`.
- Keep the page implementation in `dashboard/src/features/drive/index.tsx`.
- Change the admin route label in `dashboard/src/components/layout/data/sidebar-data.ts` from `云盘` to `云盘管理`.
- Change the admin route URL from `/drive` to `/admin-drive`.

Modify `dashboard/src/components/layout/data/sidebar-data.test.ts`:

- Admin sidebar contains `/admin-drive` and label `云盘管理`.
- User sidebar does not contain `/admin-drive`.

`/console/drive` becomes the user Drive browser route in Phase 6. Phase 1 only moves the admin page so the route name is available.

Commit after Phase 1:

```bash
git add dashboard/package.json dashboard/vite.config.ts dashboard/src/main.tsx dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/lib/dashboard-redirect.ts dashboard/src/lib/dashboard-redirect.test.ts dashboard/src/lib/dashboard-sign-out.test.ts dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/components/layout/data/sidebar-data.test.ts dashboard/src/routes/_authenticated/drive/index.tsx dashboard/src/routes/_authenticated/admin-drive/index.tsx server/nginx.conf server/src/admin-auth/admin-auth.controller.ts server/src/dashboard/dashboard.controller.ts server/src/live/live.controller.ts server/src/webhooks/webhook.controller.ts server/src/deploy-config.spec.ts server/src/invitations/invitation-url.spec.ts server/src/invitations/invitations.service.spec.ts server/src/admin/admin.service.spec.ts server/src/admin/admin.controller.spec.ts server/README.md
git commit -m "feat(console): rename dashboard routes to console"
```

---

## Phase 2: Add Shared Drive Browser Contract

Checklist:

- [ ] Add owner/share browser path constants.
- [ ] Add Drive browser DTO types.
- [ ] Add owner/share/console URL builders with root/current item support.
- [ ] Extend Drive route masking tests.
- [ ] Commit Phase 2.

### Task 2.1: Extend shared Drive constants

Modify `shared/src/drive.ts`:

```ts
export const DRIVE_OWNER_BROWSER_PATH_PREFIX = "/drive/items"
export const DRIVE_CONSOLE_BROWSER_PATH_PREFIX = "/console/drive"
export const DRIVE_SHARE_BROWSER_PATH_PREFIX = "/files"
```

Keep existing:

```ts
export const DRIVE_PUBLIC_PATH_PREFIX = "/files"
export const DRIVE_PAGE_PUBLIC_PATH_PREFIX = "/pages"
export const DRIVE_SITE_PUBLIC_PATH_PREFIX = "/sites"
```

`DRIVE_PUBLIC_PATH_PREFIX` can remain as a compatibility alias for share browser links if renaming it would cause noisy churn.

### Task 2.2: Add browser DTO types

Add to `shared/src/drive.ts`:

```ts
export type DriveBrowserAccessContext = "owner" | "share"
export type DriveBrowserSurface = "standalone" | "console"

export type DriveBrowserPreviewKind =
  | "image"
  | "text"
  | "html-source"
  | "download-only"

export interface DriveBrowserItemDto {
  readonly id: string
  readonly name: string
  readonly type: "file" | "folder"
  readonly size: string
  readonly mimeType: string | null
  readonly updatedAt: string
  readonly previewKind: DriveBrowserPreviewKind
  readonly browserUrl: string
  readonly downloadUrl: string | null
}

export interface DriveBrowserBreadcrumbDto {
  readonly id: string
  readonly name: string
  readonly browserUrl: string
}

export interface DriveBrowserPreviewDto {
  readonly kind: DriveBrowserPreviewKind
  readonly text: string | null
  readonly truncated: boolean
  readonly imageUrl: string | null
  readonly visitUrl: string | null
}

export interface DriveBrowserSnapshotDto {
  readonly context: DriveBrowserAccessContext
  readonly surface: DriveBrowserSurface
  readonly current: DriveBrowserItemDto
  readonly breadcrumbs: readonly DriveBrowserBreadcrumbDto[]
  readonly children: readonly DriveBrowserItemDto[]
  readonly preview: DriveBrowserPreviewDto | null
  readonly canDownload: boolean
  readonly canZip: boolean
}

export interface DriveBrowserPasswordRequiredDto {
  readonly passwordRequired: true
  readonly message: string
}
```

Capability meaning:

- `preview.visitUrl` is only populated for owner HTML source preview.
- Share HTML preview returns `kind: "html-source"` with `visitUrl: null`.
- Archive and unknown binary file types return `kind: "download-only"`.

### Task 2.3: Add URL builders and masking

Add pure helpers:

```ts
export function buildOwnerDriveBrowserUrl(rootItemId: string): string
export function buildOwnerDriveChildBrowserUrl(rootItemId: string, itemId: string): string
export function buildOwnerDriveDownloadUrl(rootItemId: string): string
export function buildOwnerDriveChildDownloadUrl(rootItemId: string, itemId: string): string
export function buildOwnerDriveZipUrl(rootItemId: string): string
export function buildOwnerDriveChildZipUrl(rootItemId: string, itemId: string): string
export function buildOwnerDriveRenderUrl(rootItemId: string): string
export function buildOwnerDriveChildRenderUrl(rootItemId: string, itemId: string): string
export function buildConsoleDriveRootUrl(): string
export function buildConsoleDriveBrowserUrl(rootItemId: string): string
export function buildConsoleDriveChildBrowserUrl(rootItemId: string, itemId: string): string
export function buildShareDriveBrowserUrl(shareId: string, itemId?: string | null): string
export function buildShareDriveDownloadUrl(shareId: string, itemId?: string | null): string
export function buildShareDriveZipUrl(shareId: string): string
export function buildShareDriveChildZipUrl(shareId: string, itemId: string): string
```

Update masking helpers so logs redact:

- `/drive/items/:rootItemId`
- `/drive/items/:rootItemId/download`
- `/drive/items/:rootItemId/render`
- `/drive/items/:rootItemId/items/:browserItemId`
- `/console/drive/items/:rootItemId`
- `/console/drive/items/:rootItemId/items/:browserItemId`
- `/files/:shareId/items/:browserItemId`

Add tests in `shared/src/drive.test.ts`:

- Owner browser URL encodes item ids.
- Owner child URL encodes both root and child ids.
- Console child URL encodes both root and child ids.
- Share child URL encodes both share id and item id.
- Masking redacts owner item ids and share ids while preserving route shape.

Commit after Phase 2:

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(drive): add browser route contract"
```

---

## Phase 3: Add Server Drive Browser Mapping

Checklist:

- [ ] Create pure Drive browser mapping helper.
- [ ] Add owner browser service methods.
- [ ] Add console virtual root browser service method.
- [ ] Add share browser service methods.
- [ ] Cover preview classification, ownership, share boundaries, and password behavior with tests.
- [ ] Commit Phase 3.

### Task 3.1: Add pure browser mapping helper

Create `server/src/drive/drive-browser.ts`.

Responsibilities:

- Classify preview kind from item type, MIME type, and file name.
- Build `DriveBrowserItemDto` from a Drive item and access context.
- Build breadcrumbs and browser/download URLs.
- Enforce text preview byte limits.

Classification rules:

```text
folder                    -> download-only item, no preview panel
image/* file              -> image
text/* file               -> text
*.txt, *.md, *.json, *.csv -> text
*.html, *.htm             -> html-source
zip/tar/gzip/rar/7z       -> download-only
other file                -> download-only
```

Add tests in `server/src/drive/drive-browser.spec.ts`:

- HTML is `html-source`.
- Image MIME type is `image`.
- Text file name fallback works when MIME type is missing.
- Archive MIME/name is `download-only`.
- Owner HTML item includes `visitUrl`; share HTML item does not.
- Owner child browser URL is built as `/drive/items/:rootItemId/items/:browserItemId`.
- Console child browser URL is built as `/console/drive/items/:rootItemId/items/:browserItemId`.

### Task 3.2: Add owner browser service methods

Modify `server/src/drive/drive.service.ts`.

Add methods:

```ts
async getOwnerBrowserSnapshot(input: {
  readonly userId: string
  readonly rootItemId: string
  readonly currentItemId?: string | null
  readonly surface: "standalone" | "console"
}): Promise<DriveBrowserSnapshotDto>

async getOwnerConsoleRootBrowserSnapshot(userId: string): Promise<DriveBrowserSnapshotDto>

async createDownloadUrlForOwnerBrowserItem(input: {
  readonly userId: string
  readonly rootItemId: string
  readonly currentItemId?: string | null
}): Promise<{ readonly url: string; readonly fileName: string }>

async createFolderZipEntriesForOwnerBrowserItem(input: {
  readonly userId: string
  readonly rootItemId: string
  readonly currentItemId?: string | null
}): Promise<readonly DriveFolderZipEntry[]>

async resolveOwnerHtmlRenderAccess(input: {
  readonly userId: string
  readonly rootItemId: string
  readonly currentItemId?: string | null
}): Promise<PublishedAssetAccess>
```

Implementation notes:

- Use existing `requireOwnedItem`, `isDescendantOf`, storage status checks, and zip helpers.
- For `getOwnerBrowserSnapshot`, `currentItemId` defaults to `rootItemId`.
- For standalone owner routes, require current item to equal root item or be a descendant of root item.
- For console item routes, use the same descendant rule with `surface: "console"`.
- `getOwnerConsoleRootBrowserSnapshot` lists `parentId = null` items and uses a virtual root DTO.
- For folders, snapshots list direct children.
- For files, `getOwnerBrowserSnapshot` includes a preview object.
- Text and HTML source previews use storage stream reads with a strict byte cap.
- `resolveOwnerHtmlRenderAccess` only succeeds for an active file that passes `isHtmlDriveItem`.

Tests:

- Owner cannot read another user item.
- Owner folder snapshot lists children.
- Owner child folder snapshot requires the child to be under `rootItemId`.
- Console virtual root snapshot lists current user's root items.
- Owner file snapshot for HTML returns source preview and a non-null `visitUrl`.
- Owner unknown file snapshot returns `download-only`.

### Task 3.3: Add share browser service methods

Modify `server/src/drive/drive.service.ts`.

Add methods:

```ts
async getShareBrowserSnapshot(input: {
  readonly shareId: string
  readonly itemId?: string | null
  readonly password?: string | null
  readonly accessCookie?: string | null
}): Promise<DriveBrowserSnapshotDto>

async createDownloadUrlForShareBrowserItem(input: {
  readonly shareId: string
  readonly itemId?: string | null
  readonly password?: string | null
  readonly accessCookie?: string | null
}): Promise<{ readonly url: string; readonly fileName: string }>

async createFolderZipEntriesForShareBrowserItem(input: {
  readonly shareId: string
  readonly itemId?: string | null
  readonly password?: string | null
  readonly accessCookie?: string | null
}): Promise<readonly DriveFolderZipEntry[]>
```

Implementation notes:

- Reuse `resolvePublicShareAccess`.
- For child items, require `isDescendantOf(root.id, child.id)`.
- Do not expose owner-only `visitUrl`.
- Continue supporting current share password cookie behavior.

Tests:

- Share root file snapshot works.
- Share root folder snapshot lists direct children.
- Share child outside shared root is rejected.
- Share child folder zip uses the same share subtree check.
- Password-protected share returns the same access error before unlock.
- Share HTML source preview has `visitUrl: null`.

Commit after Phase 3:

```bash
git add server/src/drive/drive-browser.ts server/src/drive/drive-browser.spec.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): add file browser access model"
```

---

## Phase 4: Add Server Routes For Browser Data And Direct File Responses

Checklist:

- [ ] Add Drive browser JSON API routes.
- [ ] Add owner direct download, zip, and render routes.
- [ ] Update share direct download routes.
- [ ] Remove server-rendered share browser HTML from page routes.
- [ ] Preserve publish route behavior.
- [ ] Commit Phase 4.

### Task 4.1: Add browser JSON API routes

Modify `server/src/drive/drive.controller.ts` or extract a new controller in the same file:

```ts
@Controller("/api/drive/browser")
export class DriveBrowserApiController {
  @UseGuards(JwtAuthGuard)
  @Get("/owner/root")
  getOwnerConsoleRootSnapshot(...)

  @UseGuards(JwtAuthGuard)
  @Get("/owner/items/:rootItemId")
  getOwnerRootSnapshot(...)

  @UseGuards(JwtAuthGuard)
  @Get("/owner/items/:rootItemId/items/:itemId")
  getOwnerChildSnapshot(...)

  @Get("/shares/:shareId")
  getShareRootSnapshot(...)

  @Get("/shares/:shareId/items/:itemId")
  getShareItemSnapshot(...)

  @Post("/shares/:shareId/access")
  unlockShare(...)
}
```

Behavior:

- Owner route uses `request.user!.id`.
- Owner console root route returns the virtual root snapshot for `/console/drive`.
- Owner child route verifies the child is under `rootItemId`.
- Share routes use password body or the existing access cookie.
- Password unlock route sets the existing `synapse_drive_access` cookie and returns the browser snapshot.
- JSON API returns a typed password-required error for the dashboard client to render the password form.

### Task 4.2: Add owner direct response routes

Add non-API routes:

```ts
@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/download")
downloadOwnerItem(...)

@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/zip")
downloadOwnerFolderZip(...)

@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/render")
renderOwnerHtmlItem(...)

@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/items/:itemId/download")
downloadOwnerChildItem(...)

@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/items/:itemId/zip")
downloadOwnerChildFolderZip(...)

@UseGuards(JwtAuthGuard)
@Get("/drive/items/:rootItemId/items/:itemId/render")
renderOwnerChildHtmlItem(...)
```

Behavior:

- File download redirects to storage signed URL.
- Folder zip streams archive entries.
- Render only streams owner-owned HTML files.
- Child direct routes validate `itemId` under `rootItemId` before download, zip, or render.
- Render uses HTML content type and the existing security headers pattern from publish rendering where applicable.

### Task 4.3: Update share direct response routes

Modify current share routes:

- Keep `GET /files/:shareId/download`.
- Replace `GET /files/:shareId/:itemId/download` with canonical `GET /files/:shareId/items/:itemId/download`.
- Keep the old `GET /files/:shareId/:itemId/download` as compatibility redirect or alias during migration.
- Keep `GET /files/:shareId/zip`.
- Add `GET /files/:shareId/items/:itemId/zip` for child folders.
- Remove server-rendered share file/folder HTML for `GET /files/:shareId`; this path will be served by the dashboard bundle through Nginx/Vite.

Tests:

- Owner direct download rejects unauthenticated users.
- Owner direct render rejects non-HTML files.
- Owner child direct routes reject items outside `rootItemId`.
- Share child download canonical route works.
- Share child zip canonical route works.
- Legacy share child download route still works or redirects.
- Publish `/pages/:publishId` and `/sites/:publishId/*` behavior remains unchanged.

Commit after Phase 4:

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): expose file browser routes"
```

---

## Phase 5: Serve The SPA At Console, Owner Browser, And Share Browser Routes

Checklist:

- [ ] Update production Nginx route ownership.
- [ ] Update Vite dev proxy route ownership.
- [ ] Add route ownership assertions.
- [ ] Commit Phase 5.

### Task 5.1: Update production Nginx route ownership

Modify `server/nginx.conf`.

Keep direct server proxy routes before SPA fallbacks:

```nginx
location ~ ^/drive/items/[^/]+/(download|zip|render)$ {
  proxy_pass http://127.0.0.1:3001;
}

location ~ ^/drive/items/[^/]+/items/[^/]+/(download|zip|render)$ {
  proxy_pass http://127.0.0.1:3001;
}

location ~ ^/files/[^/]+/(download|zip)$ {
  proxy_pass http://127.0.0.1:3001;
}

location ~ ^/files/[^/]+/items/[^/]+/(download|zip)$ {
  proxy_pass http://127.0.0.1:3001;
}
```

Serve the dashboard bundle for browser page routes:

```nginx
location /drive/items/ {
  alias /app/dashboard/dist/;
  try_files $uri $uri/ /console/index.html;
}

location /files/ {
  alias /app/dashboard/dist/;
  try_files $uri $uri/ /console/index.html;
}
```

`/console/drive*` is already covered by `/console/` static hosting. Keep `/pages/` and `/sites/` proxying to the server.

Update `server/src/deploy-config.spec.ts`:

- Assert direct file response routes proxy to API.
- Assert `/drive/items/` and `/files/` page routes serve the dashboard bundle.
- Assert `/pages/` and `/sites/` still proxy.

### Task 5.2: Update Vite dev proxy route ownership

Modify `dashboard/vite.config.ts`.

Proxy only direct response paths:

```ts
"^/drive/items/[^/]+/(download|zip|render)$": {
  target: "http://localhost:3001",
  changeOrigin: true,
},
"^/drive/items/[^/]+/items/[^/]+/(download|zip|render)$": {
  target: "http://localhost:3001",
  changeOrigin: true,
},
"^/files/[^/]+/(download|zip)$": {
  target: "http://localhost:3001",
  changeOrigin: true,
},
"^/files/[^/]+/items/[^/]+/(download|zip)$": {
  target: "http://localhost:3001",
  changeOrigin: true,
},
```

Expected:

- `/files/:shareId`, `/files/:shareId/items/:browserItemId`, `/drive/items/:rootItemId`, and `/drive/items/:rootItemId/items/:browserItemId` are handled by Vite SPA fallback in development.
- Download/render links still hit the Nest server.

Commit after Phase 5:

```bash
git add server/nginx.conf server/src/deploy-config.spec.ts dashboard/vite.config.ts
git commit -m "feat(drive): serve browser pages from dashboard app"
```

---

## Phase 6: Build The Reusable Dashboard FileBrowser

Checklist:

- [ ] Add centralized Drive browser API client methods.
- [ ] Add owner, share, and console route files.
- [ ] Add user sidebar `网盘` entry.
- [ ] Implement `useDriveBrowser`.
- [ ] Implement FileBrowser layout.
- [ ] Keep management actions out of browser pages.
- [ ] Add FileBrowser component tests.
- [ ] Commit Phase 6.

### Task 6.1: Add centralized API client methods

Modify `dashboard/src/lib/api.ts`.

Add exported methods without introducing component-local `fetch`:

```ts
export const driveBrowserApi = {
  getOwnerRoot: (rootItemId: string) =>
    request<DriveBrowserSnapshotDto>(`/api/drive/browser/owner/items/${encodeURIComponent(rootItemId)}`),

  getOwnerChild: (rootItemId: string, itemId: string) =>
    request<DriveBrowserSnapshotDto>(
      `/api/drive/browser/owner/items/${encodeURIComponent(rootItemId)}/items/${encodeURIComponent(itemId)}`
    ),

  getConsoleRoot: () =>
    request<DriveBrowserSnapshotDto>('/api/drive/browser/owner/root'),

  getShareRoot: (shareId: string) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `/api/drive/browser/shares/${encodeURIComponent(shareId)}`
    ),

  getShareItem: (shareId: string, itemId: string) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `/api/drive/browser/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}`
    ),

  unlockShare: (shareId: string, password: string) =>
    request<DriveBrowserSnapshotDto>(`/api/drive/browser/shares/${encodeURIComponent(shareId)}/access`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
}
```

Add tests:

- Owner root API uses `/api/drive/browser/owner/items/:rootItemId`.
- Owner child API encodes both root and child ids.
- Console root API uses `/api/drive/browser/owner/root`.
- Share child API encodes both ids.
- Unlock sends POST JSON.

### Task 6.2: Add public routes

Add route files:

```text
dashboard/src/routes/drive/items/$rootItemId.tsx
dashboard/src/routes/drive/items/$rootItemId/items/$browserItemId.tsx
dashboard/src/routes/_authenticated/drive/index.tsx
dashboard/src/routes/_authenticated/drive/items/$rootItemId.tsx
dashboard/src/routes/_authenticated/drive/items/$rootItemId/items/$browserItemId.tsx
dashboard/src/routes/files/$shareId.tsx
dashboard/src/routes/files/$shareId/items/$browserItemId.tsx
```

Each route should render `DriveBrowserPage` with explicit context:

```tsx
<DriveBrowserPage context="owner" surface="standalone" rootItemId={rootItemId} />
<DriveBrowserPage context="owner" surface="standalone" rootItemId={rootItemId} itemId={browserItemId} />
<DriveConsolePage />
<DriveBrowserPage context="owner" surface="console" rootItemId={rootItemId} />
<DriveBrowserPage context="owner" surface="console" rootItemId={rootItemId} itemId={browserItemId} />
<DriveBrowserPage context="share" shareId={shareId} />
<DriveBrowserPage context="share" shareId={shareId} itemId={browserItemId} />
```

Run the route generator command already used by the dashboard toolchain. If no standalone script exists, running `pnpm --filter @synapse/dashboard run tsc` or `pnpm --filter @synapse/dashboard run build` should regenerate `dashboard/src/routeTree.gen.ts` through the TanStack Router plugin.

### Task 6.3: Implement `useDriveBrowser`

Create `dashboard/src/features/drive-browser/use-drive-browser.ts`.

Responsibilities:

- Choose owner/share/console query function from context, surface, root item, and current item.
- Surface states:
  - `loading`
  - `error`
  - `passwordRequired`
  - `ready`
- Expose `unlock(password)` mutation for share password form.
- Never include share/publish management actions.

### Task 6.4: Add console Drive shell and sidebar entry

Create `dashboard/src/features/drive-browser/drive-console-page.tsx`.

Responsibilities:

- Render inside authenticated console layout through `_authenticated/drive`.
- Use `DriveBrowserPage` for the browser and preview body.
- Allow management actions only outside FileBrowser. Initial implementation may include the already available browse/download behavior and leave upload/share/publish wiring to existing management modules if those APIs are not yet exposed in dashboard.
- Do not duplicate PreviewRenderer logic.

Modify `dashboard/src/components/layout/data/sidebar-data.ts`:

```ts
{
  title: '网盘',
  url: '/drive',
  icon: HardDrive,
}
```

Modify `dashboard/src/components/layout/data/sidebar-data.test.ts`:

- User sidebar contains `/drive` with label `网盘`.
- Admin sidebar still contains `/admin-drive` with label `云盘管理`.
- User sidebar does not contain `/admin-drive`.

### Task 6.5: Implement FileBrowser layout

Create the UI files under `dashboard/src/features/drive-browser/`.

Use existing UI primitives only:

- `Button`
- `Input`
- `Table`
- `Badge`
- `Skeleton`
- `Alert`
- `ScrollArea`

Use lucide icons:

- `Folder`
- `File`
- `Image`
- `FileText`
- `Archive`
- `Download`
- `ExternalLink`

Do not add custom colors or inline styles.

Layout:

```text
+----------------------------------------------------------------+
| Breadcrumbs                                      [下载] [访问] |
+------------------------------+---------------------------------+
| Name                         | Preview                         |
| Type / size / updated        |                                 |
|------------------------------| image/text/source/download-only |
| child rows when folder       |                                 |
|                              |                                 |
+------------------------------+---------------------------------+
```

Rules:

- Folder: left side shows child rows; preview panel empty or compact state.
- Image: preview panel uses `<img>` with `src = preview.imageUrl`.
- Text and HTML source: preview panel uses `<pre>` inside `ScrollArea`.
- Download-only: preview panel shows a short necessary message and a download button.
- Owner HTML source with `preview.visitUrl`: show a button with text `访问`.
- Share HTML source: no `访问` button.
- Console owner HTML source follows owner capability rules and can show `访问`.
- Empty folder text: `暂无文件`.
- Loading text: `加载中...`.
- Error text: use the returned API message.

### Task 6.6: Keep management actions out of browser pages

Do not import or render these management actions in `drive-browser`:

- create share
- disable share
- publish page
- publish site
- redeploy publication
- disable publication
- delete file
- rename file
- move file

The FileBrowser allowed actions are only:

- open folder/file browser URL
- download file
- zip folder
- owner-only HTML `访问`

Console shell management actions are outside FileBrowser. If upload/share/publish controls are added in the console shell, they must consume the same selected/current item state from the browser snapshot instead of duplicating folder navigation or preview logic.

Tests:

- Owner HTML page renders `访问`.
- Console owner HTML page renders `访问`.
- Share HTML page does not render `访问`.
- Download-only file renders download action.
- Folder renders child rows.
- Owner child route and share child route generate the same root + `/items/:browserItemId` navigation pattern.
- Password-required share renders password form and unlock calls the API.

Commit after Phase 6:

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/components/layout/data/sidebar-data.test.ts dashboard/src/routes/drive/items dashboard/src/routes/files dashboard/src/routes/_authenticated/drive dashboard/src/features/drive-browser dashboard/src/routeTree.gen.ts
git commit -m "feat(drive): add reusable file browser UI"
```

---

## Phase 7: Update Release Notes And Verify

Checklist:

- [ ] Update pending release notes.
- [ ] Run focused verification commands.
- [ ] Run manual browser checks.
- [ ] Commit release notes.

### Task 7.1: Update release notes

Modify `RELEASE_NOTES_PENDING.md`.

Add user-facing bullets:

```md
- 云盘文件现在可以直接打开承接页预览，用户无需先创建分享链接即可浏览自己的文件夹、查看图片和文本内容，并下载不支持预览的文件。
- Web 控制台新增 `网盘` 入口，用户可以在控制台中浏览自己的云盘内容。
- 分享链接统一使用新的文件浏览器体验；发布网页和发布站点仍保持直接打开网页效果。
- Web 管理入口从 `/dashboard/` 规范为 `/console/`，旧链接会跳转到新入口。
```

### Task 7.2: Run focused verification

Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/server run test -- drive
pnpm --filter @synapse/server run test -- deploy-config invitations admin
pnpm --filter @synapse/dashboard exec vitest run dashboard/src/lib/api.test.ts dashboard/src/lib/dashboard-redirect.test.ts dashboard/src/lib/dashboard-sign-out.test.ts dashboard/src/features/drive-browser/drive-browser.test.tsx
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
```

If route generation changes `dashboard/src/routeTree.gen.ts`, include it in the final commit.

### Task 7.3: Manual browser checks

Start the minimum server scope:

```bash
pnpm dev:server
```

Open in the in-app browser:

```text
http://localhost:3000/console/
http://localhost:3000/console/drive
http://localhost:3000/console/drive/items/<owned-folder-id>/items/<child-item-id>
http://localhost:3000/drive/items/<owned-item-id>
http://localhost:3000/drive/items/<owned-folder-id>/items/<child-item-id>
http://localhost:3000/files/<share-id>
http://localhost:3000/files/<share-id>/items/<child-item-id>
http://localhost:3000/pages/<publish-id>
http://localhost:3000/sites/<publish-id>/
```

Verify:

- `/dashboard/drive` redirects to `/console/drive`.
- `/console/drive` shows the user `网盘` page.
- Admin global Drive management is available at the migrated admin route.
- `/drive/items/:rootItemId` shows browser/download only.
- `/drive/items/:rootItemId/items/:browserItemId` and `/files/:shareId/items/:browserItemId` use the same down-drill pattern.
- Owner HTML source shows `访问`.
- Console owner HTML source shows `访问`.
- Share HTML source does not show `访问`.
- `/pages/:publishId` directly renders the published page.
- `/sites/:publishId/` directly renders the published site.

Commit after Phase 7:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: update pending release notes"
```

---

## Final Verification

Before marking the task complete:

```bash
git status --short
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/server run test
pnpm --filter @synapse/dashboard run build
```

Acceptable final state:

- Working tree is clean except for user-owned unrelated changes.
- `/console/` is the canonical Web console route.
- `/api/console/*` is canonical and `/api/dashboard/*` still works.
- Owner and share file browser pages use the same React component.
- Console `网盘` uses the same FileBrowser and PreviewRenderer as standalone owner and share pages.
- Owner, console, and share down-drill URLs use the context root + `/items/:browserItemId` model.
- FileBrowser has no share/publish/delete/rename/move management actions.
- Published pages/sites still render directly.
