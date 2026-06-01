# User Display Name Design

Date: 2026-06-01

## Summary

Add a display name for ordinary user accounts. Users edit their own display name in the web dashboard personal center. The desktop app remains read-only and shows the synced display name after login or account sync.

Avatar upload is out of scope for this phase because object storage configuration does not exist yet.

## Current Context

The current account model has two separate database tables:

```text
AdminUser table  ---- dashboard login ----\
                                           -> synapse_admin cookie -> dashboard session(role)
User table       ---- dashboard login ----/

User table       ---- desktop login/token/me ----> desktop account state
AdminUser        ---- desktop login ----------X-- unsupported_account
```

Important existing behavior:

- `AdminUser` and `User` are separate tables.
- Dashboard login wraps both account types into one `synapse_admin` cookie and distinguishes them by role.
- Desktop login only supports ordinary `User` accounts.
- `/api/auth/me` currently returns user email, status, and teams to desktop.
- `/api/dashboard/me` currently returns user email, status, and teams to the dashboard personal center.
- Desktop already has a top account menu and Settings -> Account panel.
- Dashboard already has `/me` as the personal center.

## Goals

- Let ordinary users set their own display name from the web dashboard.
- Let desktop display the latest display name after login or manual account sync.
- Keep desktop profile editing out of scope.
- Keep admin display name editing out of scope.
- Avoid adding avatar fields or upload UI before object storage exists.

## Non Goals

- Do not merge `AdminUser` and `User` into one table in this phase.
- Do not add avatar upload, avatar preview, or avatar URL fields.
- Do not add a desktop profile editor.
- Do not redesign account login or desktop OAuth.
- Do not change dashboard permission semantics.
- Do not add new dependencies.

## Recommended Approach

Use the existing `User` table as the source of truth for ordinary user display names:

```text
User.displayName
  -> GET /api/dashboard/me
  -> PATCH /api/dashboard/me
  -> GET /api/auth/me
  -> desktop account state
```

This is intentionally smaller than a unified account-profile model. A unified account abstraction may be useful later, but it would touch registration, admin bootstrap, teams, permissions, session guards, desktop login, audit logs, and migrations. The display-name feature does not need that risk.

## Product Surface

### Web Dashboard

`/me` is the only edit surface.

```text
Personal Center
  Account information
    Email
    Status
    Display name [editable input]
    Save

  Teams
    Existing team list
```

Behavior:

- Ordinary users can edit display name.
- Empty display name after trimming is rejected.
- Admin users do not get a display-name editor.
- Keep copy minimal: title, labels, validation errors, and action text only.

### Desktop

Desktop displays the synced account data only.

```text
Top account menu
  primary: displayName if set, otherwise email
  secondary/detail: email
  actions: account settings, sync account, logout

Settings -> Account
  primary: displayName if set, otherwise email
  secondary/detail: email
  actions: sync, logout
```

Desktop should not show a local edit button. Users edit in the dashboard and click sync in desktop, or see the value after the next login/refresh.

### Admin Accounts

Admin accounts remain outside this feature. Dashboard admin identity can keep the existing fixed/admin-oriented display behavior. No admin display-name form is added.

## Data Model

Add one nullable field:

```prisma
model User {
  displayName String? @db.VarChar(40)
}
```

Rules:

- Store the trimmed display name.
- Minimum length: 1 character after trim.
- Maximum length: 40 characters.
- Existing users keep `null` until they set a name.

## API Design

### GET /api/dashboard/me

Return display name in the current user payload:

```ts
{
  user: {
    id: string
    email: string
    status: "active" | "disabled"
    displayName: string | null
  }
  teams: Array<...>
}
```

### PATCH /api/dashboard/me

Request:

```ts
{
  displayName: string
}
```

Validation:

- Trim input.
- Reject empty display name.
- Reject values longer than 40 characters.
- Only ordinary authenticated users can update this endpoint.

Response:

```ts
{
  user: {
    id: string
    email: string
    status: "active" | "disabled"
    displayName: string | null
  }
  teams: Array<...>
}
```

Audit:

```text
action: user.profile.update
targetType: user
targetId: current user id
detail: { fields: ["displayName"] }
```

### GET /api/auth/me

Return display name in the desktop account payload:

```ts
{
  user: {
    id: string
    email: string
    status: "active" | "disabled"
    displayName: string | null
  }
  teams: Array<...>
}
```

### GET /api/dashboard/session

No required change for this phase. The personal center already loads `/me`, and desktop does not use dashboard session data.

## Implementation Boundaries

Expected files:

```text
server/prisma/schema.prisma
server/prisma/migrations/<timestamp>_user_display_name/migration.sql
server/src/auth/user-auth.service.ts
server/src/auth/user-auth.controller.ts
server/src/dashboard/dashboard.controller.ts

dashboard/src/lib/api.ts
dashboard/src/features/me/index.tsx

desktop/src/types/account.ts
desktop/electron/modules/account/ipc.ts
desktop/src/app-shell/components/account-user-control.tsx

RELEASE_NOTES_PENDING.md
```

Notes:

- Keep all network access through `dashboard/src/lib/api.ts`.
- Use existing dashboard shadcn components and restrained Tailwind layout utilities.
- Do not use inline styles, custom colors, gradients, or custom CSS.
- Keep desktop UI changes surgical: display helper changes only.
- Do not add avatar placeholders or upload text.

## Error Handling

Dashboard:

- Show API validation errors through existing toast/error patterns.
- Keep the current form values if save fails.
- Invalidate or update the `dashboard-me` query after success.

Server:

- Use zod validation at the controller boundary.
- Return a clear bad-request message for invalid display names.
- Record audit only after successful update.

Desktop:

- If sync fails, keep current account error behavior.
- If display name is missing, fall back to email.

## Testing

Server:

- `UserAuthService.getMe` returns `displayName`.
- Dashboard controller or service test covers `PATCH /me`.
- Validation rejects empty and over-length display names.
- Successful update records `user.profile.update`.

Desktop:

- Account IPC schema accepts `displayName: string | null`.
- Account control shows display name as primary label when present.
- Account control falls back to email when display name is null or empty.

Dashboard:

- `/me` renders the display-name input for ordinary users.
- Saving calls the update API and refreshes displayed data.
- Save button is disabled or validation blocks empty trimmed input.

Regression:

- Existing desktop login still works.
- Existing dashboard login for admin and user still works.
- Admin-only dashboard pages remain guarded by admin role.

## Release Note

Add this to pending release notes during implementation:

```text
Ordinary users can set a display name in the web personal center, and the desktop app shows it after account sync.
```

