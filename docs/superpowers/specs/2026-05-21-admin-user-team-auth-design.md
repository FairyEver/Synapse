# Admin User Team Auth Design

> Retired on 2026-07-31. Teams, memberships and team invitations were removed from the product and database; this document is retained only as a historical decision record.
>
> Partially superseded on 2026-05-25 by `docs/superpowers/specs/2026-05-25-personal-module-permissions-design.md`.
> Keep the administrator, normal user, session, team, and team invitation foundation. Replace administrator-issued user signup invitations and team-based permission design with open registration and personal `module.*` permissions.

Date: 2026-05-21
Scope: `/Users/liyang/Documents/code/github/Synapse/server`

## Goal

Replace the old server authorization direction with a new account foundation for Synapse. This phase only designs the server-side account and team base needed before Synapse clients require login.

The first implementation should support:

- One platform administrator account.
- Administrator-issued one-time signup invitations.
- Normal user registration and login through API only.
- User-owned teams with one owner and members.
- Team-issued one-time join invitations.
- Access-token and refresh-token sessions for normal users.

## Product Rules

- The platform has exactly one administrator account.
- The administrator does not belong to any team.
- The administrator can create one-time signup invitation links.
- A signup invitation can register exactly one normal user account.
- Every normal user can create at most one team.
- Every normal user can belong to at most one team.
- Every normal user can join another user's team through a team invitation link.
- A team invitation can be used exactly once.
- Signup and team invitations expire after seven days.
- Team roles are limited to `owner` and `member` in this phase.
- Normal user web pages are out of scope; normal user capabilities are API-only.

## Data Model

### AdminUser

Represents the single platform administrator.

Fields:

- `id`
- `email`
- `passwordHash`
- `createdAt`
- `updatedAt`

Rules:

- The table must contain at most one row.
- On first server startup, create the administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if no administrator exists.
- If an administrator already exists, startup must not overwrite the email or password.
- The administrator has no team membership.

### User

Represents a normal Synapse account.

Fields:

- `id`
- `email`
- `passwordHash`
- `status`: `active` or `disabled`
- `createdAt`
- `updatedAt`

Rules:

- `email` is unique.
- A disabled user cannot log in or refresh sessions.
- Normal users are created only through valid signup invitations.

### Team

Represents a user-created team.

Fields:

- `id`
- `name`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Rules:

- `createdByUserId` is unique, so each user can create at most one team.
- Creating a team also creates an `owner` membership for the creator.
- The team owner is the user referenced by `createdByUserId`; owner membership must stay aligned with that value.

### TeamMembership

Represents the single team membership of a normal user.

Fields:

- `id`
- `teamId`
- `userId`
- `role`: `owner` or `member`
- `createdAt`

Rules:

- `userId` is unique, so each user can belong to at most one team.
- A user who already owns a team cannot join another team.
- A user who already joined a team cannot create another team.
- A team has one owner in this phase, and that owner is `Team.createdByUserId`.

### Invitation

Stores both administrator signup invitations and team join invitations.

Fields:

- `id`
- `type`: `user_signup` or `team_join`
- `tokenHash`
- `expiresAt`
- `usedAt`
- `createdByAdminId`
- `createdByUserId`
- `teamId`
- `acceptedByUserId`
- `createdAt`

Rules:

- The plaintext token is returned only once when the invitation is created.
- The database stores only `tokenHash`.
- `user_signup` invitations are created by the administrator.
- `team_join` invitations are created by a team owner and point to that owner's team.
- Invitation acceptance must happen in one database transaction with account creation or membership creation.

### UserSession

Stores refresh-token sessions for normal users.

Fields:

- `id`
- `userId`
- `refreshTokenHash`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `lastUsedAt`

Rules:

- Access tokens are short-lived JWTs and are not stored.
- Refresh tokens are stored as hashes.
- Refreshing rotates the refresh token and updates the session.
- Logout revokes the current refresh session.

## API Design

### Administrator

Routes remain under `/admin` and `/admin/api`.

- `POST /admin/login`
- `POST /admin/logout`
- `GET /admin/session`
- `POST /admin/api/invitations`
- `GET /admin/api/invitations`
- `GET /admin/api/users`
- `PATCH /admin/api/users/:id/status`
- `GET /admin/api/teams`
- `GET /admin/api/audit-logs`

Behavior:

- `POST /admin/api/invitations` creates a one-time normal-user signup invitation and returns the plaintext token once.
- User listing includes email, status, team name when present, and creation time.
- Team listing includes team name, owner email, member count, and creation time.
- Team management is read-only for the administrator in this phase.

### Normal User Auth

Routes live under `/api/auth`.

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Behavior:

- Register requires `invitationToken`, `email`, and `password`.
- Register validates an unused, unexpired `user_signup` invitation.
- Register creates the user, marks the invitation used, and returns access and refresh tokens.
- Login returns access and refresh tokens.
- Refresh rotates the refresh token.
- Logout revokes the current refresh session.
- `me` returns the user plus team membership and role when present.

### Teams

Routes live under `/api/teams`.

- `POST /api/teams`
- `GET /api/teams/me`
- `POST /api/teams/invitations`
- `POST /api/teams/join`
- `GET /api/teams/members`
- `DELETE /api/teams/members/:userId`

Behavior:

- `POST /api/teams` creates a team for a user with no existing team membership.
- Team creation creates an owner membership in the same transaction.
- `POST /api/teams/invitations` requires the caller to be the team owner.
- `POST /api/teams/invitations` returns the plaintext team invitation token once.
- `POST /api/teams/join` requires an authenticated user with no existing team membership.
- Team join validates an unused, unexpired `team_join` invitation and creates a member membership in the same transaction.
- Team owner can remove members.
- Team owner cannot remove themselves in this phase.

## Authorization Rules

- Administrator routes use the administrator session cookie.
- Normal user routes use bearer access tokens.
- The administrator cannot call normal user team APIs.
- Normal users cannot call administrator APIs.
- Disabled users cannot log in, refresh sessions, or use authenticated normal-user APIs.
- Only team owners can create team invitations.
- Owners and members can view their current team and member list.
- Only owners can remove members.

## Error Handling

Return business-safe errors instead of leaking database constraint details.

- Invalid, expired, or used invitation: `邀请无效或已过期。`
- Existing email: `邮箱已注册。`
- Login failure: `邮箱或密码错误。`
- Disabled account: `账号已停用。`
- Creating or joining a team when already assigned: `账号已属于一个团队。`
- Non-owner team management: HTTP 403.
- Invalid, expired, or revoked refresh token: HTTP 401.

## Audit And Logging

Audit log entries should be added for:

- Administrator login success and failure.
- Administrator signup invitation creation.
- Administrator enabling or disabling a user.
- User registration success.
- User login success and failure.
- User team creation.
- Team invitation creation.
- User joining a team.
- Owner removing a team member.

Refresh-token anomalies can be structured warnings first; they do not need to be admin-visible audit entries in this phase.

## Admin Frontend Scope

The administrator frontend should stay small and operational.

Pages:

- Users: list normal users, show status and team, enable or disable users, create signup invitation.
- Teams: list teams, show owner and member count, inspect members.
- Invitations: list administrator signup invitations and create a new invitation.

Out of scope:

- Normal-user web pages.
- Team relationship editing by administrator.
- Password reset.
- Email verification.
- Two-factor authentication.
- Multi-administrator support.
- Multi-use invitation links.
- Team join approval workflow.
- Complex permission matrix.

## Implementation Boundaries

- Do not reuse old license, activation, device, or lease semantics.
- Keep administrator identity separate from normal user identity.
- Keep normal user business logic out of React components.
- Keep API request validation close to controllers and business rules in services.
- Use Prisma transactions for invitation acceptance, user registration, team creation, and team join.
- Store only hashed invitation tokens and hashed refresh tokens.
- Use the existing server stack: NestJS, Prisma, PostgreSQL, and the existing admin React stack.

## Verification

Server verification should include:

- Prisma schema validation and generation.
- Unit tests for administrator initialization.
- Unit tests for signup invitation creation and consumption.
- Unit tests for user registration, login, refresh rotation, logout, and disabled-user rejection.
- Unit tests for team creation, duplicate team rejection, team invitation creation, team join, duplicate membership rejection, and non-owner rejection.
- Admin API tests for invitation creation, user listing, status updates, and team listing.
- `pnpm --filter @synapse/server run typecheck`
- `pnpm --filter @synapse/server run test`
- `pnpm --filter @synapse/server run build`

## Risks

- The existing server cleanup work may delete old files while this design is being implemented, so the implementation should start from the post-cleanup server state.
- A database-level constraint is required for one team membership per user; service-level checks alone are not enough.
- Invitation consumption must be transactional to avoid double registration or double join under concurrent requests.
- Refresh-token rotation must be tested carefully to avoid accepting a reused token after rotation.
- The administrator initialization path must avoid overwriting production credentials after the first boot.
