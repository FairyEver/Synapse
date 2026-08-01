# Separate Admin Access Domain Design

Date: 2026-07-31
Scope: `server/`, `dashboard/`, deployment configuration, authentication and audit documentation

## Summary

Synapse separates the ordinary-user console from platform administration. Ordinary users remain account-backed and use `/console`; platform administration moves to `/admin` and is unlocked with one server-configured access secret. A platform administrator is not a `User`, has no account profile, cannot authenticate the desktop client, and cannot use ordinary-user capabilities without separately signing in as an ordinary user.

This design supersedes the `AdminUser` authentication and mixed Dashboard role model in:

- `docs/superpowers/specs/2026-05-21-admin-user-team-auth-design.md`
- the admin portions of `docs/superpowers/specs/2026-06-01-user-display-name-design.md`
- `docs/adr/0093-let-only-active-admin-users-read-problem-feedback.md`

It preserves the existing `/api/admin/**` authorization boundary and all ordinary-user, Drive, Webhook, desktop-auth and public-share behavior unless explicitly changed below. The subsequent team-domain removal migration retires teams and team invitations across both applications.

## Product Boundaries

- `/console/**` is the ordinary-user application.
- `/admin/**` is the platform-administration application.
- `/admin` resolves to `/admin/system` for an active administrator session and `/admin/access` otherwise.
- `/admin/access` is the only management-secret entry page.
- The root path continues to redirect to `/console/`.
- Public shares, standalone Drive readers, signup, password reset, desktop authorization and `/desktop/update` remain outside the admin application.
- The same browser may hold an ordinary-user session and an administrator session at the same time. The sessions, permissions and logout behavior remain independent.

## Frontend Applications

`dashboard/` remains one workspace package and one deployed artifact, but it has two independent SPA entry points and route trees.

The console application owns:

- ordinary-user sign-in, signup and password reset;
- My Skills and Explore Skills;
- personal Drive;
- user Webhooks and the current user's Webhook history;
- the current user's devices and profile settings;
- existing public and desktop-auth handoff pages.

The admin application owns:

- system overview;
- user and device management;
- Skill repository management;
- global Webhook history;
- audit logs and problem feedback;
- backup, global Drive and system logs.

The admin application has no profile settings. Its identity label is always `平台管理员`; its only account-area action is `退出管理界面`.

The applications may share the existing shadcn primitives, theme providers and identity-neutral request helpers. They do not share navigation, auth stores, route guards or business route composition. Role-based runtime switching is removed.

## Administrator Access Secret

`ADMIN_ACCESS_SECRET` is required in every server environment. It must be an unpadded Base64URL string of at least 43 characters produced from at least 32 random bytes. The example value remains blank; local development and production deployment use different generated values.

The server fails startup when the value is missing or invalid. External authentication responses never distinguish a missing configuration from an incorrect secret.

The system exposes no API or UI to read, copy, generate or change the secret. Rotation happens only through server environment configuration and takes effect on service restart.

The secret-entry value exists only in component memory. It is never written to browser persistence, URLs, logs, errors, telemetry or test snapshots. The password field allows paste and temporary visibility and is cleared after every request.

## Administrator Sessions

The admin session API is:

```text
POST   /api/admin/session
GET    /api/admin/session
DELETE /api/admin/session
```

`POST` accepts `{ accessSecret }`, compares it in constant time and creates an opaque session. Invalid attempts return the same `密钥无效` response, irrespective of configuration state.

`AdminSession` is not related to an account. It stores:

- a non-sensitive session identifier;
- an irreversible, secret-keyed hash of the opaque browser token;
- trusted source IP;
- creation, expiry, revocation and last-use timestamps.

The plaintext token exists only in the `synapse_admin_session` cookie. Database records and logs never contain the token, Cookie, access secret, secret digest or any value usable for authentication.

Sessions have a fixed eight-hour lifetime, no sliding extension and no refresh token. Multiple sessions may coexist. Logout revokes only the current session. Revoked and expired records remain for seven days, then the existing scheduled cleanup path removes them.

An ordinary restart with an unchanged access secret preserves active sessions. The stored token lookup is keyed by `ADMIN_ACCESS_SECRET`, so rotating the secret makes every previous session invalid without storing a secret fingerprint.

The cookie is `HttpOnly`, `Secure` in production, `SameSite=Strict`, and scoped to `/api/admin`. Clearing it uses exactly the same attributes. Admin API write requests also require an `Origin` matching `APP_PUBLIC_URL`; missing or mismatched origins are rejected.

Secret validation is limited to five attempts per minute per trusted client IP. The IP comes from the configured trusted-proxy chain and never from an unconditionally trusted `X-Forwarded-For`. There is no global lockout.

Admin sessions are not hard-bound to IP or User-Agent. Trusted source IP, creation time and last-use time are security metadata, not authentication factors.

## Ordinary User Web Sessions

`/api/console/login`, `/api/console/logout` and `/api/console/session` become ordinary-user-only endpoints. The `/api/dashboard/**` aliases remain for user compatibility and have identical semantics. Neither namespace accepts the management secret or administrator Cookie and neither returns an administrator identity.

The browser uses a `synapse_user_session` HttpOnly opaque token backed by the existing `UserSession` service and retains the current maximum 30-day experience. The browser never receives or persists access and refresh tokens. Existing desktop Bearer access tokens, refresh-token rotation and PKCE authorization remain unchanged.

The legacy `synapse_admin` Cookie is ignored and cleared. Existing Web console sessions therefore require one sign-in after upgrade; desktop sessions remain valid.

The `DashboardRole = admin | user` response and frontend branching are removed. User session responses contain user identity and session data. Administrator session responses contain only the non-sensitive admin session ID and expiry.

## API Authorization

- All `/api/admin/**` routes except the session creation/check/delete endpoints require an active `synapse_admin_session`.
- Admin routes never accept user Cookies or ordinary-user Bearer tokens.
- User routes never accept `synapse_admin_session`.
- Missing, invalid, expired or revoked admin sessions return a generic 401.
- Failed trusted-origin checks return a generic 403.
- Frontend buttons are not authorization controls; guards remain server-side.

When an admin request returns 401, the admin application navigates to `/admin/access` with an allowlisted internal return path. After re-entry it returns to that page but never replays the failed request. Mutating operations require explicit resubmission and confirmation.

## Audit Model

`AuditLog.adminEmail` is replaced by structured actor fields:

```text
actorType: user | platform_admin | system | unknown
actorId
actorLabel
adminSessionId?
```

Ordinary-user records use the user ID and email snapshot. Platform-admin records use the fixed platform-admin actor and the non-sensitive admin session ID. System records use the fixed system actor. Records that cannot be classified reliably migrate as `unknown`; the migration does not guess.

Failed access-secret checks are `unknown`. Successful unlock, logout and subsequent management operations are `platform_admin`. Fixed actions distinguish invalid secret, expired session, revoked session and explicit logout. No audit record contains an access secret, secret digest, Cookie, session token or token hash.

The migration deletes only clearly identifiable legacy administrator authentication and operation records. It preserves ordinary-user and system audit history. Audit filtering, sorting, CSV export and the admin table use the structured actor fields.

## Data Migration

The administrator-domain migration:

1. creates `AdminSession`;
2. adds structured audit actor fields and migrates retained user/system/unknown rows;
3. deletes only actions that are unambiguously legacy administrator actions;
4. removes `UserModulePermission.grantedByAdminId` while preserving all permission rows, keys and timestamps;
5. drops `AdminUser` and `DashboardRevokedToken`.

The old administrator email is no longer reserved and may later register as an ordinary `User`; that grants no administrative authority.

The immediately following team-domain removal migration deletes team- and invitation-attributed audit rows, then drops `Invitation`, `TeamMembership`, `Team` and their enum types. It preserves ordinary users, user sessions, Drive data, Webhooks, Skill repositories, user permissions and unrelated audit history.

## Retired Team Domain

Teams, memberships and team invitations are no longer product concepts. `/api/teams/**`, `/api/admin/teams`, `/api/admin/invitations` and team invitation pages return 404 with no redirect or replacement entry. The user `me` responses retain only a deprecated `teams: []` wire field for one compatibility release; current Dashboard and Desktop clients do not persist or expose it.

## Compatibility Routes

Known legacy admin-only console routes redirect to their `/admin` equivalents and no longer render admin features inside `/console`. Known `/dashboard/**` routes map to `/console` or `/admin` according to an explicit allowlist. Retired team and invitation paths, along with unknown legacy routes, return 404; there is no fuzzy fallback.

The redirect target is always an allowlisted same-site path. Query values cannot produce an external redirect.

## Environment And Deployment

Remove `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_JWT_SECRET` from:

- `server/.env.example`;
- local `server/.env.local`;
- deployment source `server/.env.server`;
- Compose wiring, config validation and deployment documentation.

Add `ADMIN_ACCESS_SECRET` to the same server configuration surfaces. `.env.release.local` is unrelated and remains untouched. Real generated values are never committed, printed or copied into tests.

Dropping `AdminUser`, teams and invitations is not backward-compatible with the previous server. Deployment must create and verify a restorable database backup before applying the migrations. Migration failure stops the switch. Rolling back to the previous server requires restoring both the pre-migration database and the old environment configuration; image-only rollback is invalid. Existing disaster-recovery packages and server logs are retained. This design does not authorize a production migration, deployment or release.

## UI Requirements

The admin access page uses the existing auth layout, Card, Form, PasswordInput and Button components. Required copy is limited to:

- title: `管理密钥`;
- label: `密钥`;
- action: `进入管理界面`;
- invalid state: `密钥无效`.

It introduces no custom colors, gradients, CSS module, inline styles, nested cards, welcome copy or implementation explanation. Keyboard submission, visible focus, disabled/loading state and password visibility remain accessible.

## Non-Goals

- Administrator accounts, profiles, email identity or RBAC.
- Desktop administrator login.
- Management-secret display, recovery or rotation UI.
- API-key or raw-secret authentication on each admin API request.
- Administrator session IP/User-Agent binding.
- Global lockout after invalid access attempts.
- Separate frontend repositories, deployables or services.
- Automatic production migration or release from this implementation task.

## Verification

Server tests must cover:

- environment-secret validation and redaction;
- constant-time secret verification and per-trusted-IP throttling;
- admin session creation, persistence across restart, expiry, revocation and seven-day cleanup;
- secret rotation invalidating existing sessions;
- Cookie attributes and exact clear attributes;
- trusted-origin enforcement for admin writes;
- mutual rejection of user and admin Cookies;
- ordinary-user Web sessions backed by `UserSession` without changing desktop token flows;
- structured audit actors and safe legacy classification;
- migration preservation of users, sessions, permissions, Drive data and unrelated audit rows;
- removal of team and invitation tables, enums, attributed audit history and API modules.

Dashboard tests must cover:

- independent console and admin route trees and auth stores;
- access-secret input lifecycle and redirect allowlist;
- no request replay after session expiry;
- admin-only and user-only navigation inventories;
- known legacy redirects and unknown legacy 404 behavior;
- independent logout behavior when both Cookies exist.
- retired team and invitation navigation, routes and invitation links returning 404.

Build and deployment checks must cover both SPA entry points, Nginx history fallback, `/desktop/update`, public Drive/share routes, API proxying and the destructive-migration backup gate.
