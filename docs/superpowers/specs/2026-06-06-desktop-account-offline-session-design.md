# Desktop Account Offline Session Design

## Summary

Synapse Desktop account login must survive app restarts, software updates, and short server outages. The desktop app already stores the user refresh token in encrypted local storage and keeps the access token only in memory. The missing behavior is a durable offline account state: when the server is temporarily unavailable, Desktop should keep the local account profile and refresh token, show the account as offline, and retry automatically until the server recovers.

Server-side invalidation still wins. If the server explicitly rejects the refresh token or current user, Desktop clears local credentials and becomes unauthenticated.

## Current Context

Desktop account state is owned by `desktop/electron/services/account-service.ts`.

- It persists `refreshToken`, `lastProfile`, and active browser login attempts in the encrypted `core.account` namespace.
- It keeps `accessToken` in memory only.
- Renderer receives account state through the typed account bridge and never receives token values.
- On startup, main process calls `accountService.refreshFromStorage()` unless it is handling an auth callback.
- Today, `refreshFromStorage()` clears the stored refresh token on any refresh failure. This treats server redeploys, network loss, and actual credential invalidation the same way.

The server already supports the desired remote semantics:

- `POST /api/auth/refresh` rotates the refresh token and extends `UserSession.expiresAt`.
- Refresh is rejected when the session is revoked, expired, race-lost, or the user is disabled.
- `GET /api/auth/me` verifies the access token through `UserAuthGuard`.
- Default refresh lifetime is controlled by `USER_REFRESH_TOKEN_DAYS`.

## Goals

- Preserve account login across app quit, update, and restart.
- Preserve account login across temporary server downtime or deployment.
- Add a stable offline account state with local user information.
- Automatically retry and recover online status after server recovery.
- Keep server-side invalidation effective for disabled users, revoked sessions, expired refresh tokens, and password-reset revocations.
- Keep tokens out of renderer state and UI.

## Non-Goals

- Do not change the browser login handoff or PKCE flow.
- Do not expose refresh tokens or access tokens to renderer code.
- Do not add registration or account management flows.
- Do not add a broad offline feature system for every server-backed workflow in this change.
- Do not add new dependencies.

## Account State Model

Update `SynapseAccountState` to distinguish account identity from online availability:

```ts
type SynapseAccountState =
  | { status: "unauthenticated" }
  | { status: "authenticating"; loginUrl?: string }
  | {
      status: "authenticated"
      connectivity: "online" | "offline"
      profile: SynapseAccountProfile
      offlineReason?: SynapseAccountOfflineReason
      retry?: SynapseAccountRetryState
    }
  | { status: "error"; message: string; profile?: SynapseAccountProfile }
```

`unauthenticated` means there is no usable local account identity. It is reached after user logout or explicit server-side invalidation.

`authenticated` with `connectivity: "online"` means the server recently accepted refresh or `/auth/me`.

`authenticated` with `connectivity: "offline"` means Desktop has a local `lastProfile` and refresh token, but the server cannot currently be confirmed. This is the state for server redeploys, transient network failures, timeouts, and 5xx responses.

`error` remains a short-lived user-action result for failed login callback or failed local logout cleanup. It should not be used as the steady state for server downtime.

Renderer should expose helpers so future product logic does not reimplement this distinction:

```ts
hasAccountProfile(state): boolean
isAccountOnline(state): boolean
isAccountUnavailable(state): boolean
```

`isAccountUnavailable` returns true for both `unauthenticated` and `authenticated/offline`.

## Failure Classification

Account refresh and profile sync must classify failures before mutating local credentials.

Temporary unavailable failures:

- Network errors thrown by `fetch`.
- Abort/timeout errors.
- DNS or connection errors.
- HTTP 500, 502, 503, 504, and other 5xx responses.
- Malformed or unreadable server responses from refresh or `/auth/me`.

Temporary unavailable failures must not clear `refreshToken`. If a `lastProfile` exists, Desktop enters `authenticated/offline` and starts retrying.

Explicit authentication failures:

- HTTP 401 or 403 from `/auth/refresh`.
- HTTP 401 or 403 from `/auth/me` after a refresh/access token attempt.
- Server responses that clearly indicate the refresh session is revoked, expired, disabled, or race-lost.

Explicit authentication failures clear local refresh token and profile, stop retries, and enter `unauthenticated`.

Local storage failures:

- If encrypted storage cannot be read and no trusted in-memory account state exists, Desktop cannot preserve a local identity and should become `unauthenticated`.
- If a local write fails during logout, keep the existing error behavior and do not claim logout succeeded.
- If a local write fails while entering offline, keep the current in-memory state and log a sanitized warning; do not delete credentials as a fallback.

## Retry Policy

Retry runs only when all of these are true:

- State is `authenticated/offline`.
- A stored refresh token still exists.
- The user has not started a new login attempt.
- The user has not logged out.

Retry delay sequence:

```text
10s -> 30s -> 1m -> 2m -> 5m
```

After reaching 5 minutes, continue every 5 minutes.

Immediate retry triggers:

- App startup.
- User clicks "同步账号".
- Main window is activated or focused.
- The offline state is first entered.

Retry success:

- Store the rotated refresh token.
- Store the latest `/auth/me` profile.
- Clear retry metadata.
- Enter `authenticated/online`.

Retry temporary failure:

- Keep local credentials.
- Stay `authenticated/offline`.
- Schedule the next backoff retry.

Retry explicit authentication failure:

- Clear local credentials and profile.
- Stop retry.
- Enter `unauthenticated`.

Logout:

- Stop any pending retry timer.
- Attempt remote logout when a refresh token exists.
- Clear local credentials even if remote logout fails, because logout is user intent.

## UI Behavior

Keep the existing account controls and settings account panel. Do not add custom colors, gradients, or new visual systems.

Top bar:

- Online authenticated: show display name or email.
- Offline authenticated: show display name or email with a short "离线" status.
- Authenticating: show "登录中".
- Unauthenticated: show "登录".

Settings account panel:

- Online authenticated: show account identity and sync/logout actions.
- Offline authenticated: show account identity, "离线", sync action, and logout action.
- Unauthenticated: show login action.

Copy stays short. Do not speculate about the cause of downtime in UI. The UI should not say "服务器正在部署" unless the server provides that exact user-facing state later.

## Implementation Boundaries

Desktop main process remains the owner of token storage, refresh, retry timers, and protocol callback handling.

Renderer only receives account state, retry metadata, and actions through the existing preload account bridge.

The account service should centralize:

- HTTP failure classification.
- Offline state transitions.
- Retry timer scheduling and cancellation.
- Refresh token preservation and clearing rules.

Do not scatter retry timers into React components.

Do not persist access tokens.

Do not change `core.account` storage to plaintext if `safeStorage` is unavailable.

Server refresh behavior does not need a new endpoint for this change. If later product work needs richer invalidation reasons, add sanitized machine-readable error codes without exposing token material.

## Tests

Desktop account service tests must cover:

- Refresh network error keeps refresh token and enters `authenticated/offline`.
- Refresh 5xx keeps refresh token and enters `authenticated/offline`.
- Refresh 401 clears refresh token and enters `unauthenticated`.
- `/auth/me` temporary failure after refresh keeps the new refresh token where safe and enters offline with profile.
- Offline retry success stores the rotated refresh token and enters `authenticated/online`.
- Offline retry temporary failure keeps credentials and schedules the next delay.
- Offline retry 401/403 clears credentials and stops retry.
- Logout stops retry and clears local state.
- Starting a new browser login cancels or supersedes offline retry work.
- Existing race tests still prevent logout from being overwritten by in-flight refresh or callback.

Renderer tests must cover:

- Top bar/panel render online, offline, authenticating, and unauthenticated states.
- "同步账号" is available in offline authenticated state and invokes refresh.
- Business helpers classify unauthenticated and offline as unavailable.

Server tests are only needed if implementation changes server error shape. Existing refresh tests already cover disabled, revoked, expired, and race-lost sessions.
