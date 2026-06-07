# Dashboard Device Pages Design

Date: 2026-06-07
Scope: `server/`, `dashboard/`

## Goal

Extract the existing Live client list from user settings and user management into first-level dashboard device pages.

This feature must support:

- Normal users can open a first-level `我的设备` menu and see their own devices.
- Normal users can rename their own devices.
- Administrators can open a first-level `设备` menu and see all users' devices.
- Administrators cannot rename user devices in this version.
- Device records remain visible after a device goes offline or the server restarts.
- Current online state continues to update from Synapse Live.

## Confirmed Product Decisions

- Use two role-specific menu entries and two route permissions, not one page that changes behavior internally.
- Admin route: `/devices`, guarded by admin-only access.
- Normal user route: `/my-devices`, guarded by normal-user access.
- Admin menu label: `设备`, under the `管理` group.
- Normal user menu label: `我的设备`, under the `账户` group.
- Device rename is a normal-user-only operation.
- Admin device page is read-only.
- Device rename is stored as a server-side display name. It does not push a new hostname or local setting back to the desktop app.
- Historical offline devices are retained as registered device records.

## Non-Goals

- Do not let admins rename devices.
- Do not add device revocation, forced logout, kick, delete, or remote disconnect.
- Do not add desktop protocol changes to push renamed names back to clients.
- Do not introduce Redis, multi-instance presence state, or durable live-event queues.
- Do not add custom dashboard styling, a new UI library, or a separate visual system.
- Do not keep the normal user's device list inside profile settings after the new page exists.

## Product Model

The existing Synapse Live identity remains:

```text
userId -> clientInstanceId -> connectionId
```

The new product model adds a persistent device record for `userId + clientInstanceId`.

The persistent record stores stable dashboard-facing metadata:

- `userId`
- `clientInstanceId`
- `deviceName`: latest name reported by desktop hello.
- `displayName`: optional user-defined name.
- `platform`: latest reported platform.
- `appVersion`: latest reported app version.
- `firstSeenAt`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

Display name rule:

- UI primary device name is `displayName` when present.
- Otherwise use latest reported `deviceName`.
- If both are unexpectedly empty, show `未命名设备`.

Online state rule:

- Current `online`, `stale`, and `offline` status comes from the existing in-memory Live registry.
- If a persistent device has no matching live registry entry, the returned status is `offline`.
- `lastSeenAt` uses the newest known value from the persistent record and live registry.

## Server Data Model

Add a Prisma model:

```prisma
model UserDevice {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientInstanceId String
  deviceName       String   @db.VarChar(120)
  displayName      String?  @db.VarChar(120)
  platform         String
  appVersion       String
  firstSeenAt      DateTime @default(now())
  lastSeenAt       DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([userId, clientInstanceId])
  @@index([userId, lastSeenAt])
  @@index([lastSeenAt])
}
```

`User` gains:

```prisma
devices UserDevice[]
```

`clientInstanceId` is not globally unique because the identity belongs to a user scope.

## Server Architecture

Add a `LiveDeviceService` under `server/src/live/` and register it in `LiveModule`:

- Upserts a `UserDevice` row when `LiveDesktopGateway` accepts a valid hello.
- Keeps `displayName` unchanged during hello upsert.
- Updates latest reported `deviceName`, `platform`, `appVersion`, and `lastSeenAt`.
- Provides user-scoped and admin-scoped list methods that merge persistent rows with current Live registry state.
- Provides normal-user-only rename.

The merge logic should be centralized so admin and user APIs produce the same DTO shape.

## API Design

Normal user APIs:

```text
GET /api/dashboard/devices
PATCH /api/dashboard/devices/:clientInstanceId
```

Patch body:

```ts
{
  displayName: string
}
```

Rules:

- Guarded by `UserAuthGuard`.
- `displayName` is trimmed.
- Length: 1 to 120 characters.
- The authenticated user can update only their own `clientInstanceId`.
- Unknown device returns a clear not-found error.

Admin APIs:

```text
GET /api/admin/devices
```

Rules:

- Guarded by `AdminAuthGuard`.
- Read-only.
- Returns all persisted user devices with user email and current live status.
- Supports server-side pagination and sorting.
- Suggested sort fields: `lastSeenAt`, `firstSeenAt`, `deviceName`, `platform`, `appVersion`.

Shared DTO shape:

```ts
type DashboardDeviceRow = {
  userId?: string
  userEmail?: string
  clientInstanceId: string
  deviceName: string
  displayName: string | null
  effectiveName: string
  status: "online" | "stale" | "offline"
  platform: string
  appVersion: string
  firstSeenAt: string
  lastSeenAt: string | null
  connectedAt: string | null
  disconnectedAt?: string
  disconnectReason?: string
}
```

Normal-user responses omit `userEmail`; admin responses include it.

## Dashboard UX

### Normal User: `我的设备`

Route: `dashboard/src/routes/_authenticated/my-devices/index.tsx`

Feature module: `dashboard/src/features/my-devices/`

Layout:

- `Header` title: `我的设备`
- `Main` with a restrained table using existing shadcn/dashboard primitives.
- Each row shows device name, status badge, platform, app version, and last seen time.
- Row action: `重命名`.
- Rename uses an existing `Dialog` or `Sheet`, `Input`, and `Button`.
- Empty state text: `暂无设备`.
- Loading state text: `加载中...`.
- Error state has `加载失败` and `重试`.

The current device list section is removed from profile settings. Profile settings keeps profile fields only.

### Admin: `设备`

Route: `dashboard/src/routes/_authenticated/devices/index.tsx`

Feature module: `dashboard/src/features/devices/`

Layout:

- `Header` title: `设备`
- Use `ServerDataTable`; do not hand-roll table or pagination.
- Columns: user email, device name, status, platform, app version, last seen, first seen.
- No rename action.
- Empty state uses existing table empty state.

The user management page keeps the compact `客户端` aggregate status column for scanning users, but removes the separate client detail action and sheet. The first-level admin `设备` page is the primary detail surface.

## Dashboard State Flow

Both pages use HTTP snapshot for first load and SSE for current status updates.

- Normal user page calls `dashboardApi.listDevices()`.
- Admin page calls `adminApi.listDevices(...)`.
- Existing Live stream subscriptions can be reused.
- Event merge updates status and latest metadata in local query state.
- If an SSE error occurs, invalidate the relevant device query and fall back to snapshot refetch.

Device-specific shared utilities live outside `features/users/` because the feature is no longer user-management-only:

```text
dashboard/src/lib/device-utils.ts
```

## Access Control

Add or extend route guards:

- `requireDashboardAdmin` protects `/devices`.
- A new normal-user guard protects `/my-devices`.
- Admin users should not see `我的设备`.
- Normal users should not see admin `设备`.

Sidebar data follows the same role split:

- Admin nav groups include `设备`.
- Normal user nav groups include `我的设备`.

## Auditing And Logging

- Admin list reads are audited consistently with other admin list endpoints.
- Normal-user rename writes structured server logs. It does not create an `AuditLog` row in this version because the current audit table is admin-oriented.
- Logs must not include tokens, cookies, Authorization headers, or raw secret-bearing payloads.
- Logging device identifiers, user ids, user emails, and display names is acceptable when consistent with existing dashboard/server logs.

## Error Handling

- Rename validation failures return the standard dashboard API error message path.
- Rename conflict is not a distinct error because `displayName` is per device, not unique.
- If the device no longer exists, return not found and keep the dialog open with a toast.
- If SSE is unavailable, the page remains usable with snapshot data and refetch.

## Testing

Server tests:

- Hello upserts a `UserDevice` without clearing `displayName`.
- Admin list returns all persisted devices and merged live status.
- User list returns only the authenticated user's devices.
- User rename updates only the authenticated user's device.
- User rename rejects unknown or other-user devices.
- Server restart-like state, represented by an empty Live registry plus persisted rows, returns devices as offline.

Dashboard tests:

- Sidebar shows `设备` for admins and `我的设备` for normal users.
- Admin device route is blocked for normal users.
- Normal user device route is blocked for admins.
- My Devices rename dialog trims and saves display name.
- Admin device table has no rename action.
- Device utility tests cover snapshot and SSE merge behavior.

Validation commands should include focused server tests, focused dashboard tests, dashboard typecheck, and the repo's relevant server type/test command.

## Release Notes

Implementation should update `RELEASE_NOTES_PENDING.md` because this is user-visible:

- Dashboard gets first-level device pages.
- Normal users can rename their own devices.
- Admins get a read-only all-devices view.
