# Personal Module Permissions Design

Date: 2026-05-25
Scope: `server/`, `dashboard/`, future desktop permission consumption

## Status

Superseded on 2026-06-13.

The current module-permission implementation has been withdrawn from the product surface: dashboard entry points, admin APIs, and session payloads no longer expose module permissions. If Synapse needs module permissions later, redesign the full enforcement chain before reintroducing configuration UI or APIs. This document remains only as historical context for the removed approach.

The remaining team relationship and team invitation model described below was retired on 2026-07-31 and removed from the product and database.

This design supersedes the team permission direction in:

- `docs/superpowers/specs/2026-05-23-team-permission-design.md`
- `docs/superpowers/specs/2026-05-22-signup-invitation-flow-design.md`
- The invitation and permission parts of `docs/superpowers/specs/2026-05-21-admin-user-team-auth-design.md`

## Goal

Replace the current team-based permission design with a personal module permission model.

The first implementation focuses on the management dashboard:

- One login page for administrators and normal users.
- Open registration for normal users.
- No user signup invitations.
- Teams remain only as a relationship model for creation, invitations, joining, and member display.
- Platform administrators grant module-level product access directly to individual users.
- Normal users can log in to the dashboard and see only their own account, current team, and settings.

Desktop app enforcement is not part of this first implementation, but the permission model must be ready for a later desktop login gate and top-level tab filtering.

## Product Decisions

- Personal permissions are the only product authorization model.
- Team permissions are deleted, not hidden or kept as a compatibility layer.
- A normal user who registers directly starts with no module permissions.
- Settings are always available and are not represented by a permission key.
- Normal users do not see their own module permission list in the dashboard.
- Team invitation flow is decoupled from login and registration. If a user opens a team invitation while logged out, the app sends them to login. After logging in or registering, the user must open the invitation link again.
- First release permissions are module-level only. No action-level, role-level, resource-level, or sensitive-operation permissions are included.

## Non-Goals

- Team entitlement, team access role, or team member access role support.
- Per-resource permissions.
- Action-level permissions such as workflow run, database export, or scheduler task run.
- Desktop login and desktop tab filtering in this implementation phase.
- Automatic invitation return after login or registration.
- Password reset, email verification, two-factor authentication, or multi-admin management.

## Architecture

The server owns identity, sessions, teams, and personal module permissions.

Dashboard routing has two authenticated surfaces:

- Administrator surface: users, teams, team invitations, audit, backup, logs, system pages, and user module permission management.
- Normal user surface: account information, team information, and settings.

Permission checks flow through one server-side permission boundary:

```text
User -> UserModulePermission -> module permission key
```

The team relationship model remains separate:

```text
Team -> TeamMembership -> User
Invitation(type = team_join)
```

No feature should derive product access from `Team`, `TeamMembership.role`, or team invitation state.

## Permission Registry

The permission registry remains code-owned, not database-owned.

Permission keys for this phase are stable module entry keys:

```text
module.skill
module.rule
module.prompt
module.agent
module.database
module.scheduler
module.workflow
module.tools
module.local
module.usage
```

Each registry entry should include:

```text
key
label
group
sortOrder
status: active | deprecated
```

The registry must reject unknown keys on writes. Deprecated keys should not be grantable.

The old action-style keys such as `content.skill.use`, `workflow.use`, and `team.role.manage` are not part of the new first-release model.

## Data Model

Keep:

- `AdminUser`
- `User`
- `UserSession`
- `Team`
- `TeamMembership`
- `Invitation`, only for `team_join`
- `AuditLog`

Change:

- `Invitation.type = user_signup` is removed from the product flow.
- `POST /api/auth/register` no longer consumes an invitation.

Add:

### UserModulePermission

Represents one module permission granted to one normal user.

```text
id
userId
permissionKey
grantedByAdminId
grantedAt
updatedAt
```

Constraints:

- Unique by `userId, permissionKey`.
- `permissionKey` must exist in the active module permission registry.
- `grantedByAdminId` references the platform administrator that last granted or replaced the permission set when available.

Delete:

- `TeamEntitlement`
- `TeamAccessRole`
- `TeamAccessRolePermission`
- `TeamMemberAccessRole`

The implementation should remove these Prisma models, service methods, controller routes, dashboard UI paths, and tests. A database migration should drop the tables. Existing rows are not migrated because the team permission model is no longer part of the product.

## API Design

### Dashboard Session API

`/login` is the single dashboard login page. It must use a single dashboard session boundary instead of storing user access or refresh tokens in browser storage.

Add:

```text
POST /api/dashboard/login
POST /api/dashboard/logout
GET  /api/dashboard/session
```

`POST /api/dashboard/login` accepts `email` and `password`, authenticates either the administrator or a normal user, sets HttpOnly session cookies, and returns:

```ts
{
  role: "admin" | "user"
  email: string
}
```

Normal user registration must reject the administrator email. If legacy data already contains the same email in both administrator and normal user records, administrator credentials take precedence during dashboard login.

`POST /api/dashboard/logout` clears whichever dashboard session cookies are present.

`GET /api/dashboard/session` returns the current dashboard session role and minimal profile, or 401 when logged out.

Normal user dashboard requests should be authenticated through the dashboard session cookie. They should not require React code to attach bearer tokens and should not store tokens in `localStorage` or `sessionStorage`.

After login:

- Administrator goes to the administrator dashboard.
- Normal user goes to the normal user account page.

### Normal User Auth

Change:

```text
POST /api/auth/register
```

Input:

```text
email
password
```

No `invitationToken` is required.

Keep:

```text
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

These token-based APIs remain useful for non-browser clients and future desktop login. The dashboard should prefer the dashboard session API and cookie-authenticated dashboard user endpoints.

Add or expose a cookie-authenticated dashboard user profile endpoint for the normal user dashboard:

```text
GET /api/dashboard/me
```

`GET /api/dashboard/me` returns user and team relationship data. It should not return a visible permissions list for the normal user dashboard.

Suggested shape:

```ts
{
  user: {
    id: string
    email: string
    status: "active" | "disabled"
  }
  teams: Array<{
    id: string
    name: string
    membershipId: string
    membershipRole: "owner" | "member"
  }>
}
```

A later desktop auth endpoint or mode may include module permission keys, but the normal user dashboard should not render them.

### Admin APIs

Add:

```text
GET /api/admin/module-permissions
GET /api/admin/users/:id/module-permissions
PUT /api/admin/users/:id/module-permissions
```

`GET /api/admin/module-permissions` returns the active module permission registry.

`GET /api/admin/users/:id/module-permissions` returns:

```ts
{
  permissionKeys: string[]
}
```

`PUT /api/admin/users/:id/module-permissions` replaces the user's full module permission set:

```ts
{
  permissionKeys: string[]
}
```

The replace operation should run in one transaction:

1. Validate the user exists.
2. Validate all permission keys are active module keys.
3. Delete permissions not in the new set.
4. Insert missing permissions.
5. Record an audit log entry.

Change:

```text
GET /api/admin/users
```

Include team relationship summary and personal module permission summary for administrator use.

Remove:

```text
POST /api/admin/invitations
GET  /api/admin/invitations for user_signup management
GET  /api/admin/teams/:teamId/entitlements
PUT  /api/admin/teams/:teamId/entitlements
PUT  /api/admin/teams/:teamId/permissions
GET  /api/admin/teams/:teamId/access-roles
PUT  /api/admin/teams/:teamId/access-roles/:roleId/permissions
GET  /api/admin/teams/:teamId/members/:membershipId/access-roles
POST /api/admin/teams/:teamId/members/:membershipId/access-roles
PUT  /api/admin/teams/:teamId/members/:membershipId/access-roles
DELETE /api/admin/teams/:teamId/members/:membershipId/access-roles/:roleId
```

Team invitation APIs can remain where they belong to the normal team owner flow. The administrator dashboard should not present user signup invitation creation.

### Team APIs

Keep team relationship APIs:

```text
POST /api/teams
GET  /api/teams/me
POST /api/teams/invitations
POST /api/teams/join
GET  /api/teams/members
DELETE /api/teams/members/:userId
DELETE /api/teams/me
```

Team invitations remain one-time and expire as currently designed.

For browser dashboard usage, these routes must accept the normal user dashboard session cookie. React components should not hand-roll bearer auth.

## Dashboard Design

Use the existing dashboard component stack and styling conventions. Do not introduce custom colors, custom CSS systems, marketing copy, or card-heavy decorative pages.

### Login

`/login` contains one form for both administrators and normal users.

Visible text stays minimal:

- Email
- Password
- Login action
- Register link
- Short error state

### Register

`/register` is public and creates a normal user.

It requires:

- Email
- Password

After success, show a short success state and a login action. Do not auto-login in this phase.

### Admin Users Page

The administrator users page should show:

- Email
- Status
- Team summary
- Enabled module summary
- Created time
- Updated time
- Actions

Actions:

- Enable or disable user.
- Open module permission editor.

The module permission editor should be a modal or sheet with the active module permission registry. Saving replaces the full permission set.

### Admin Teams Page

The administrator teams page should show teams, owners, members, and timestamps.

Remove:

- Team permission editor.
- Access role editor.
- Member access role editor.

### Admin Invitations Page

Remove user signup invitation creation and listing from the main product flow.

If the existing invitation list remains for operational visibility, it should not offer user signup creation and should make team invitations distinct. The cleaner first implementation is to remove the page if it only exists for user signup invitations.

### Normal User Dashboard

Normal user routes show:

- Account information.
- Current team information.
- Settings.

They do not show:

- Administrator navigation.
- Module permission list.
- Team permission or role management.

## Team Invitation Flow

Team invitation links stay separate from registration.

Flow:

1. User opens `/team-invite?token=...`.
2. If logged out, the page sends the user to `/login`.
3. Login and registration do not store or replay the invitation token.
4. The user manually opens the original invitation link again.
5. If logged in, the page shows a confirmation action.
6. Confirming calls `POST /api/teams/join`.

This keeps team joining decoupled from identity creation.

## Error Handling

Return business-safe errors:

- Registration duplicate email: `邮箱已注册。`
- Login failure: `邮箱或密码错误。`
- Disabled account login: use the same login failure message.
- Normal user accessing administrator routes: HTTP 403.
- Administrator saving an unknown module key: HTTP 400.
- Team invitation invalid, expired, or used: `邀请无效或已过期。`
- Joining when already in a team: `账号已属于一个团队。`

Avoid leaking whether an account exists during login.

## Audit

Record audit entries for:

- User registration success.
- User login success and failure.
- Administrator changing user status.
- Administrator replacing a user's module permissions.
- Team invitation creation.
- User joining a team.
- Team member removal.

The user module permission audit entry should include:

```text
actor admin id/email
target user id
before permission keys
after permission keys
ipAddress
createdAt
```

## Testing

Server tests:

- Registration succeeds without an invitation token.
- Registration rejects duplicate email.
- New users have no `UserModulePermission` rows.
- `POST /api/dashboard/login` routes administrators and normal users correctly.
- Admin can list module permissions.
- Admin can replace a user's module permissions.
- Unknown module keys are rejected.
- Deleted team permission APIs are removed or return 404.
- `GET /api/dashboard/me` returns user and team relationships without team access roles.
- Team invitation still requires login and still joins a team when submitted by an authenticated user.

Dashboard tests:

- Login page supports administrator and normal user outcomes.
- Register page does not require invitation query params.
- Admin user page opens and saves module permissions.
- Admin team page has no permission management action.
- Normal user dashboard has no admin navigation and no module permission list.
- Team invitation page sends logged-out users to login and lets logged-in users confirm join.

Migration checks:

- `UserModulePermission` table is created with a unique `userId, permissionKey` constraint.
- `TeamEntitlement`, `TeamAccessRole`, `TeamAccessRolePermission`, and `TeamMemberAccessRole` tables are dropped.
- Existing `user_signup` invitation rows are deleted.

Recommended verification commands:

```text
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test
pnpm --filter @synapse/server run build
pnpm --filter @synapse/dashboard run typecheck
pnpm --filter @synapse/dashboard run build
```

## Rollout Plan

1. Update Prisma schema and migrations.
2. Replace permission registry with `module.*` keys.
3. Rewrite `PermissionsService` around user module permissions.
4. Update normal user registration to be open registration.
5. Add admin user module permission APIs.
6. Remove team permission and access role APIs.
7. Update dashboard login, registration, users, teams, invitations, and normal user pages.
8. Add tests and run verification.
9. Later, use the same `module.*` permissions for desktop login and top-level tab filtering.
