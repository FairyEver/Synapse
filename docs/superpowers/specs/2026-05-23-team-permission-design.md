# Team Permission and Desktop Login Design

> Retired on 2026-07-31. The remaining team relationship domain was removed from the product and database; this document is retained only as a historical decision record.
>
> Superseded on 2026-05-25 by `docs/superpowers/specs/2026-05-25-personal-module-permissions-design.md`.
> Team-based permissions are no longer the product direction. Product access is granted directly to individual users through `module.*` permissions.

## Context

Synapse already has a server-side account system with user signup invitations, user login, refresh tokens, teams, team invitations, and an Admin dashboard. The desktop app currently relies on a local identity gate for repository authorship and local workspace identity, but it does not require a server account before use and does not consume server-managed product permissions.

The long-term goal is to require desktop users to log in, allow platform administrators to open a team's available capabilities, and allow team administrators to maintain team-local roles that decide which members can use which capabilities.

## Goals

- Require a server-authenticated user before the desktop app's main features are used.
- Model permissions by stable capability keys, not by page names or UI routes.
- Let platform administrators define the permissions available to each team.
- Let team administrators define team-local roles and assign roles to members.
- Let desktop and server code derive a user's effective permissions from team entitlements and assigned roles.
- Start with module-level permissions plus a few sensitive management permissions, while leaving room for finer operation-level and resource-scoped permissions later.
- Keep the existing local desktop identity model for repository authorship and local content workflows.

## Non-Goals

- Full cloud-provider-style IAM in the first release.
- Per-resource permission UI in the first release.
- Personal member overrides in the first release.
- Real-time permission push in the first release.
- Replacing the desktop local identity with the server user id in the first release.

## Permission Model

Permissions are product capability identifiers. UI modules are one consumer of those identifiers, but the identifiers are not routes, tabs, or Chinese labels.

Permission keys use:

```text
<domain>.<feature-or-resource>.<action>
```

The key contract is intentionally stable:

- Keys are English identifiers and are not derived from UI copy.
- Segments use lowercase kebab-case when a segment needs multiple words.
- Published keys are never reused for a different meaning.
- Deprecated keys stay in the registry with a deprecated status until migrated away.
- Display labels, groups, sort order, and descriptions come from the permission registry and can change without changing the key.

Recommended first-release keys:

```text
content.rule.use
content.skill.use
content.prompt.use

agent.chat.use
agent.provider.manage
agent.permission-mode.manage

database.use

scheduler.use

workflow.use

local.ide-scan.view

usage.view

team.member.manage
team.role.manage
team.invitation.manage
```

Future keys can refine sensitive behavior without changing existing module-level keys:

```text
database.query
database.schema.manage
database.export

workflow.run
workflow.manage

scheduler.task.manage
scheduler.task.run
```

## Effective Permission Rule

First release:

```text
effective permissions = team entitlements ∩ union(assigned role permissions)
```

Future release with member overrides:

```text
effective permissions = team entitlements ∩ (union(role permissions) + member grants - member denies)
```

The first release should not expose member overrides. The schema should not block adding them later.

## Permission Registry

Permission definitions live in server code, not as editable database rows. Database rows store grants and assignments only.

Each registry entry should contain:

```text
key
label
description
group
level: module | action | management
status: active | deprecated
clientVisibility: visible | hidden
```

The Admin dashboard and team role UI should render permission labels and grouping from this registry. All write APIs must reject unknown keys and deprecated keys unless a migration path explicitly allows them.

## Data Model

### TeamEntitlement

Represents the platform-level permission ceiling for a team.

```text
id
teamId
permissionKey
source: manual | plan | migration
grantedByAdminId nullable
grantedAt
expiresAt nullable
```

Constraints:

- Unique by `teamId, permissionKey`.
- `permissionKey` must exist in the active permission registry.
- Expired entitlements are not included in effective permissions.

### TeamAccessRole

Represents a role maintained inside one team.

```text
id
teamId
name
description nullable
kind: system | custom
locked boolean
sortOrder
createdAt
updatedAt
```

Each team should get system roles during team creation or migration:

```text
团队管理员
普通成员
```

System roles may be edited only within safe boundaries. Locked roles cannot be deleted.

### TeamAccessRolePermission

Represents permissions granted to a team role.

```text
id
roleId
permissionKey
createdAt
```

Constraints:

- Unique by `roleId, permissionKey`.
- `permissionKey` must exist in the active permission registry.
- `permissionKey` must be included in the parent team's current entitlements.

### TeamMemberAccessRole

Represents a member's role assignment.

```text
id
teamMembershipId
roleId
assignedByUserId nullable
assignedAt
```

The database should support multiple roles per member from the start. The first UI can present a single primary role if that keeps the product simpler.

### Future Scope Fields

The first release is team-scoped. Future releases may need permissions for a repository, workflow, database table, or other resource. Do not expose this in the first UI, but keep the grant model compatible with adding scope later.

Recommended scope shape for future grant tables or additive columns:

```text
scopeType: team | repository | workflow | database-table | resource
scopeId nullable
```

First-release grants are equivalent to:

```text
scopeType = team
scopeId = teamId
```

### Existing TeamMembership Role

The existing `TeamMembership.role` enum should remain as team ownership or membership identity for now. It should not become the full authorization model. Product authorization should come from `TeamAccessRole` and role permissions.

## Server API

### User Session

Extend `GET /api/auth/me` to return teams and effective permissions:

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
    roles: Array<{ id: string; name: string }>
    effectivePermissions: string[]
  }>
}
```

Return teams as an array even if the first release effectively supports one team per user.

### Platform Admin APIs

```text
GET /api/admin/permissions
GET /api/admin/teams/:teamId/entitlements
PUT /api/admin/teams/:teamId/entitlements
```

These APIs are used by platform administrators to inspect the permission registry and update the team's entitlement ceiling.

### Team Admin APIs

Use explicit team-scoped paths:

```text
GET    /api/teams/:teamId/permissions
GET    /api/teams/:teamId/roles
POST   /api/teams/:teamId/roles
PATCH  /api/teams/:teamId/roles/:roleId
DELETE /api/teams/:teamId/roles/:roleId

GET    /api/teams/:teamId/members
PATCH  /api/teams/:teamId/members/:membershipId/roles
```

Required permissions:

```text
team.role.manage        create, edit, delete roles
team.member.manage      assign member roles, remove members
team.invitation.manage  create team invitations
```

The server must prevent a team from losing its last member with enough permissions to manage roles and members.

## Permission Service

Add a server-side permission service:

```text
getEffectivePermissions(userId, teamId)
hasPermission(userId, teamId, permissionKey)
assertPermission(userId, teamId, permissionKey)
```

First release controllers can call this service directly. A Nest decorator or guard such as `@RequirePermission("team.role.manage")` can be added once patterns stabilize.

Caching should be short-lived:

- Effective permissions can be cached for 30-60 seconds.
- Writes to entitlements, role permissions, or member role assignments should invalidate relevant team and user cache entries.
- Desktop clients should refresh permissions after login, after team switching, and after a 403 response.

## Desktop Auth Flow

Desktop startup should become:

```text
ServerAuthGate
  -> IdentityGate
    -> MainApp
```

Startup flow:

```text
read refresh token from main-process secure storage
  -> call /api/auth/refresh
  -> if valid, store fresh access token in memory and call /api/auth/me
  -> if invalid, show login
  -> after login, store refresh token securely and call /api/auth/me
  -> choose or confirm current team
  -> enter the app
```

Token handling:

- Access token lives in memory.
- Refresh token lives in Electron main-process secure storage.
- Renderer should not directly own the refresh token.
- React components should not hand-roll authenticated `fetch` calls.

Renderer should expose an auth and permission context:

```text
user
teams
currentTeam
effectivePermissions
hasPermission(key)
refreshPermissions()
```

## Desktop Module Visibility

`desktop/src/App.tsx` currently builds top-level tabs statically. With server permissions, define all possible tabs and filter them through `hasPermission`.

Initial mapping:

```text
content.skill.use    -> 技能
content.rule.use     -> 规则
content.prompt.use   -> 提示词
agent.chat.use       -> 对话
database.use         -> 数据
scheduler.use        -> 定时
workflow.use         -> 工作流
local.ide-scan.view  -> 本机
usage.view           -> CC / Codex 使用分析
```

If the current active tab becomes unavailable after a permission refresh, the app should move to the first available tab.

Module visibility is a usability feature, not the security boundary.

## Sensitive Operation Enforcement

Security-sensitive actions must be checked outside React visibility:

- Server APIs must assert product permissions before mutating or exposing protected data.
- Electron main-process services should enforce remote product permissions for sensitive IPC and local capabilities.
- Renderer hiding must never be the only protection.

Candidate sensitive permissions:

```text
agent.provider.manage
agent.permission-mode.manage
workflow.run
scheduler.task.run
database.query
team.role.manage
team.member.manage
```

The existing Electron `PermissionGuard` and `AuditSink` infrastructure can be extended with a remote product-permission policy, but product authorization should remain distinct from infrastructure permissions such as `fs.write`, `shell.exec`, and `network.connect`.

## Offline Behavior

First release should require login for main features.

Recommended offline policy:

- Short network interruptions can continue with the most recently verified session and permissions.
- The grace period should be bounded, for example 24 hours.
- After the grace period, the app requires a successful refresh or login.
- Admin and team permission changes are eventually enforced by token refresh, permission refresh, 403 handling, and grace-period expiry.

## Admin and Team UI

### Platform Admin

Add a team entitlement editor in the Admin dashboard:

```text
团队列表
  -> 团队详情
    -> 开通功能
```

The editor renders registry groups and writes `TeamEntitlement` rows.

### Team Management

Team administrators get:

```text
成员
角色
邀请
```

Role management includes:

```text
role name
role description
permission checklist limited to team entitlements
member count
system or custom marker
```

Member management includes:

```text
email
membership identity
assigned access roles
status
```

## Auditing

Audit these events:

```text
platform admin changes team entitlements
team admin creates, edits, or deletes a role
team admin changes role permissions
team admin assigns member roles
team admin creates invitations
permission denial on sensitive server or desktop capability
```

Audit details should include:

```text
actor admin/user id
teamId
action
targetType
targetId
before
after
ipAddress
createdAt
```

## Migration

When the permission tables are introduced:

- Existing teams should receive entitlements that preserve current behavior.
- Existing team owners should receive the team administrator access role.
- Existing team members should receive the ordinary member access role.
- The first platform administrator should retain full Admin dashboard access.
- Tests should cover a migrated team so no current users lose access by default.

## Rollout Plan

1. Add permission registry, Prisma tables, `PermissionService`, team default role initialization, and effective permission tests.
2. Add Admin APIs and UI for team entitlements.
3. Add team role management APIs and UI.
4. Add desktop `ServerAuthGate`, secure token storage, auth context, current team selection, and permission refresh.
5. Filter desktop module entries from effective permissions.
6. Add server and Electron main-process enforcement for sensitive permissions.
7. Later add plans, member overrides, resource scopes, real-time permission updates, and richer role templates.

## Open Decisions

- Exact secure storage implementation for desktop refresh tokens.
- Whether first UI allows multiple assigned roles per member or starts with one primary role while the database supports many.
- Exact grace period for offline use.
- Whether `usage.view` controls both CC and Codex usage analysis or is split in a later phase.
