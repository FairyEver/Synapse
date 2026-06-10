# Content Store Dashboard Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Dashboard-side Content Store browsing, detail, copy, install entry, "My Content" management shell, and admin governance pages against the existing server Content Store APIs.

**Architecture:** Extend the existing Dashboard TanStack Router app. Keep all HTTP calls inside `dashboard/src/lib/api.ts`, build feature UI under `dashboard/src/features/content-store/`, add authenticated routes for store and owned content, and add an admin route for featured/removed moderation. This plan deliberately does not implement the editor; create/edit routes can link to the later editor plan.

**Tech Stack:** React 19, TanStack Router, TanStack Table, shadcn/Radix components, Tailwind theme tokens, lucide-react, Vitest, `@synapse/shared`.

---

## Dependencies

This plan depends on:

- `docs/superpowers/plans/2026-06-09-content-store-server-foundation.md` being implemented.

This plan must finish before:

- `docs/superpowers/plans/2026-06-09-content-store-dashboard-editor.md`
- `docs/superpowers/plans/2026-06-09-content-store-desktop-install.md`

## Hard Rules

- Do not add icon upload, default icons, categories, summary, stars, comments, history UI, release notes, public anonymous browsing, Prompt install, or auto-update UI.
- Store and My Content are both under Dashboard and require login.
- Prompt only supports copy. Skill and Rule support protocol install.
- List pages must use `dashboard/src/components/data-table/server-data-table.tsx` and `DataTableColumnHeader`.
- UI must use existing dashboard shadcn/Radix components and Tailwind theme tokens. Do not add custom colors, inline styles, card nesting, marketing copy, or explanatory filler text.
- Public Skill detail may show file tree and text file contents. Binary files show name, size, and no preview.
- Do not display historical versions.

## Files

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Create: `dashboard/src/features/content-store/content-store-display.ts`
- Create: `dashboard/src/features/content-store/content-store-display.test.ts`
- Create: `dashboard/src/features/content-store/content-store-search.ts`
- Create: `dashboard/src/features/content-store/content-store-search.test.ts`
- Create: `dashboard/src/features/content-store/content-store-actions.ts`
- Create: `dashboard/src/features/content-store/content-store-actions.test.ts`
- Create: `dashboard/src/features/content-store/content-store-list.tsx`
- Create: `dashboard/src/features/content-store/content-store-detail.tsx`
- Create: `dashboard/src/features/content-store/my-content-list.tsx`
- Create: `dashboard/src/features/content-store/my-content-detail.tsx`
- Create: `dashboard/src/features/content-store/content-store-admin.tsx`
- Create: `dashboard/src/features/content-store/content-store-install-fallback.tsx`
- Create: `dashboard/src/features/content-store/index.ts`
- Create: `dashboard/src/routes/_authenticated/content-store/index.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store/$contentId.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store/install.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/index.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/$contentId.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store-admin/index.tsx`

## Server Contract Used

Use the already implemented endpoints:

- `GET /api/content-store/items`
- `GET /api/content-store/mine`
- `GET /api/content-store/items/:id`
- `POST /api/content-store/items/:id/copy`
- `POST /api/content-store/items/:id/visibility`
- `DELETE /api/content-store/items/:id`
- `POST /api/content-store/items/:id/install-sessions`
- `GET /api/admin/content-store/items`
- `GET /api/admin/content-store/items/:id`
- `POST /api/admin/content-store/items/:id/featured`
- `POST /api/admin/content-store/items/:id/removed`

Use query parameters consistently:

```ts
type ContentStoreListQuery = {
  page?: number
  pageSize?: number
  sortBy?: "createdAt" | "updatedAt" | "installCount"
  sortOrder?: "asc" | "desc"
  type?: "skill" | "rule" | "prompt"
  query?: string
}
```

---

### Task 1: API Client

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`

- [x] Import Content Store DTOs from `@synapse/shared`.
- [x] Add `ContentStoreListQuery`, `AdminContentStoreListQuery`, `CreateContentStoreInstallSessionInput`, and small request payload types near existing dashboard API types.
- [x] Add `contentStoreQuerySuffix(options)` that includes pagination, type, query, visibility, moderationStatus, sortBy, and sortOrder. Reuse `querySuffix` if it covers all required keys cleanly.
- [x] Add user methods to `dashboardApi`:
  - `listContentStoreItems(options)`
  - `listMyContentStoreItems(options)`
  - `getContentStoreDetail(id)`
  - `copyContentStoreItem(id)`
  - `setContentStoreVisibility(id, visibility)`
  - `deleteContentStoreItem(id)`
  - `createContentStoreInstallSession(id)`
- [x] Add admin methods to `adminApi`:
  - `listContentStoreItems(options)`
  - `getContentStoreDetail(id)`
  - `setContentStoreFeatured(id, value)`
  - `setContentStoreRemoved(id, value)`
- [x] Add API tests proving query serialization and auth-expired handling still work for `/api/content-store` and `/api/admin/content-store`.

### Task 2: Display Helpers

**Files:**
- Create: `dashboard/src/features/content-store/content-store-display.ts`
- Create: `dashboard/src/features/content-store/content-store-display.test.ts`
- Create: `dashboard/src/features/content-store/content-store-search.ts`
- Create: `dashboard/src/features/content-store/content-store-search.test.ts`
- Create: `dashboard/src/features/content-store/content-store-actions.ts`
- Create: `dashboard/src/features/content-store/content-store-actions.test.ts`

- [x] Implement type labels: `Skill`, `Rule`, `Prompt`.
- [x] Implement route-level icon mapping with lucide icons by type. The icon is chosen from `type`; do not store or request icons from the API.
- [x] Implement `formatContentStoreSize(size)` for file sizes using neutral units.
- [x] Implement `canInstallContent(item)` returning true only for Skill/Rule with `latestVersionId`, public-or-owned visibility from the current detail payload, and `moderationStatus === "normal"`.
- [x] Implement `canCopyContent(item)` returning true for Skill/Rule/Prompt when not removed and a latest version exists.
- [x] Implement `buildContentStoreSearch(search)` and parse helpers for route search state: page, pageSize, type, query, sortBy, sortOrder.
- [x] Test all action predicates, especially Prompt copy-only and removed content disabled.

### Task 3: Sidebar and Route Entries

**Files:**
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Create route files listed above.

- [x] Add user account nav items:
  - `内容商店` -> `/content-store`
  - `我的内容` -> `/my-content`
- [x] Add admin nav item:
  - `内容商店` -> `/content-store-admin`
- [x] Use lucide icons such as `Store`, `FolderKanban`, or another existing lucide icon that is semantically clear.
- [x] Add route files with `requireDashboardUser` for store/my-content and `requireDashboardAdmin` for admin.
- [x] Ensure command menu picks up the new sidebar entries automatically through `getSidebarData`.
- [x] Update sidebar tests for admin/user visible routes.

### Task 4: Store List Page

**Files:**
- Create: `dashboard/src/features/content-store/content-store-list.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store/index.tsx`

- [x] Build `ContentStoreListPage` using `ServerDataTable`.
- [x] Columns: title, type, author display name, updated time, install count, actions.
- [x] Filters: type select and search input. Search placeholder can be concise: `搜索`.
- [x] Default sort follows server default unless route search explicitly provides sort.
- [x] Row click navigates to `/content-store/$contentId`.
- [x] Actions:
  - Skill/Rule: `安装` creates install session, opens `deepLinkUrl`, and navigates to `/content-store/install?session=<id>` if browser protocol launch cannot be detected.
  - Skill/Rule/Prompt: `复制` calls copy API and navigates to `/my-content/$newId`.
- [x] Empty, loading, and error states use existing components and only necessary text.

### Task 5: Store Detail Page

**Files:**
- Create: `dashboard/src/features/content-store/content-store-detail.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store/$contentId.tsx`

- [x] Load detail via `dashboardApi.getContentStoreDetail`.
- [x] Header shows title, type, author display name, visibility, install count, updated time, and action buttons.
- [x] Skill detail shows a file tree and selected text file content. Binary rows show file name and formatted size only.
- [x] Rule and Prompt detail show body text in a read-only textarea or preformatted text surface using theme tokens.
- [x] Hide historical versions completely.
- [x] Do not show icon, category, summary, release notes, star count, comments, or fork language.
- [x] Copy action handles all three types.
- [x] Install action is only visible for Skill/Rule.
- [x] Removed content should show an unavailable state if the API returns 404/403.

### Task 6: My Content Pages

**Files:**
- Create: `dashboard/src/features/content-store/my-content-list.tsx`
- Create: `dashboard/src/features/content-store/my-content-detail.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/index.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/$contentId.tsx`

- [x] Build `MyContentListPage` using `ServerDataTable`.
- [x] Columns: title, type, visibility, version number, updated time, install count, actions.
- [x] Actions:
  - open detail
  - edit link to `/my-content/$contentId/edit` disabled until the editor plan lands
  - set public/private
  - delete only when private
- [x] `MyContentDetailPage` loads owned detail and renders the same body/file viewer as store detail.
- [x] Public action validates server response and surfaces "公开内容必须填写描述。" from API without client-side duplication.
- [x] Delete action uses the existing confirm dialog component and does not silently delete public content.

### Task 7: Install Fallback Page

**Files:**
- Create: `dashboard/src/features/content-store/content-store-install-fallback.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store/install.tsx`

- [x] Accept `session` query parameter.
- [x] Render a simple fallback page with one primary action to reopen `synapse://content-install?session=<session>`.
- [x] If `session` is missing, show a concise invalid-state message.
- [x] Do not ask the user to choose editor in Dashboard.
- [x] Do not attempt to download packages in Dashboard.

### Task 8: Admin Governance Page

**Files:**
- Create: `dashboard/src/features/content-store/content-store-admin.tsx`
- Create: `dashboard/src/routes/_authenticated/content-store-admin/index.tsx`

- [x] Build the admin list with `ServerDataTable`.
- [x] Columns: title, type, owner display name, visibility, moderationStatus, featured, install count, updated time, actions.
- [x] Filters: type, visibility, moderationStatus, search.
- [x] Actions:
  - set/unset featured
  - set removed
  - restore from removed
  - open detail sheet or detail area using `adminApi.getContentStoreDetail`
- [x] Make removed state resource-level and content-level: removed content is hidden from public store, cannot be copied, cannot be installed.
- [x] Do not add report/review queues in this phase.

### Task 9: Verification

- [x] Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/components/layout/data/sidebar-data.test.ts src/features/content-store
```

- [x] If TanStack route generation updates `dashboard/src/routeTree.gen.ts`, include it.
- [x] Manually inspect source for forbidden UI patterns:

```bash
rg "style=\\{\\{|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|from-|to-|via-|shadow.*border|✨|🚀|⚡" dashboard/src/features/content-store dashboard/src/routes/_authenticated/content-store dashboard/src/routes/_authenticated/my-content dashboard/src/routes/_authenticated/content-store-admin
```

- [x] Update `RELEASE_NOTES_PENDING.md` because this adds user-visible Dashboard pages.
- [x] Commit:

```bash
git add dashboard/src RELEASE_NOTES_PENDING.md
git commit -m "feat(dashboard): add content store browsing"
```
