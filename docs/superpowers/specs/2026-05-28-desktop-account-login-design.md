# Desktop Account Login Design

## Summary

Synapse Desktop will add an optional global account login module backed by the existing Synapse server user authentication system. Login opens the user's system browser, completes authentication on the dashboard, and returns to the desktop app through a custom `synapse://auth/desktop/callback` protocol. The callback carries only a short-lived one-time code and `state`; Desktop exchanges that code plus its PKCE verifier for tokens through the server, then separately calls `/api/auth/me` to load user information.

The feature is optional. Existing local repositories, Agent workflows, content browsing, and the current local identity ID continue to work without a remote account.

## Decisions

- Use the existing Synapse server auth source.
- Do not add registration to Desktop in the first version.
- Development Desktop defaults to public app root `http://localhost:3000` and derives API base `/api`.
- Packaged Desktop embeds the public app root from `SYNAPSE_DESKTOP_PUBLIC_APP_URL` at build time and derives API base `/api`.
- Login uses the system browser, not an Electron embedded login page.
- Browser callback uses `synapse://auth/desktop/callback`.
- Browser login starts at the dedicated dashboard authorization route `/dashboard/auth/desktop`, not the ordinary sign-in route.
- Desktop authorization uses PKCE with `code_challenge_method=S256`.
- Cold-start callback is supported.
- Remote account and local identity are not automatically bound.
- Login/exchange only obtains credentials; user information always comes from a separate `/api/auth/me` request.

## Existing Context

Desktop already has a local identity module:

- `desktop/src/app-shell/identity-context.tsx`
- `desktop/electron/services/user-identity-service.ts`
- `desktop/src/types/identity.ts`

That identity is a local author identity used for content resources and repository profiles. It is not a remote account. The new account module must not replace it or rewrite repository author history.

The server already exposes normal user auth:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Protected server APIs accept Bearer access tokens through `UserAuthGuard`.

## Architecture

### Server

Add a desktop login handoff flow. The server must never put long-lived tokens in the deep link URL.

Add a `DesktopLoginCode` model with these fields:

- `id`
- `codeHash`
- `userId`
- `clientId`
- `redirectUri`
- `state`
- `codeChallenge`
- `codeChallengeMethod`
- `expiresAt`
- `usedAt`
- `createdAt`
- `ipAddress`
- `userAgent`

Add endpoints:

`POST /api/auth/desktop/authorize`

- Called by the dedicated dashboard desktop auth route after the user is authenticated.
- Requires an authenticated user session.
- Accepts `clientId`, `redirectUri`, `state`, `codeChallenge`, and `codeChallengeMethod`.
- Creates a high-entropy one-time code.
- Stores only `codeHash`.
- Returns the plain code once and the deep link URL.

`POST /api/auth/desktop/token`

- Called by Desktop main process.
- Accepts `code`, `state`, and `codeVerifier`.
- Hashes and looks up the code.
- Requires exact state match.
- Requires `S256(codeVerifier)` to match the stored `codeChallenge`.
- Rejects expired, missing, or already used codes.
- Marks the code used atomically.
- Returns `accessToken` and `refreshToken`.
- Does not return user profile data.

`GET /api/auth/me`

- Remains the only source for current user information.
- Desktop calls it after exchange and after refresh recovery.

Security requirements:

- Code TTL is 5 minutes.
- Code plaintext is never logged or persisted.
- Token values are never logged.
- Exchange is one-time use.
- Audit logs record success/failure without leaking code, token, or password material.

### Dashboard

The dashboard exposes a dedicated desktop authorization route:

```text
/dashboard/auth/desktop?client_id=synapse-desktop&redirect_uri=synapse://auth/desktop/callback&response_type=code&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
```

After the user completes browser login:

1. If unauthenticated, dashboard redirects to `/dashboard/sign-in` with a safe internal return path back to `/auth/desktop`.
2. Dashboard calls `POST /api/auth/desktop/authorize`.
2. Dashboard renders a minimal handoff page.
3. The page automatically navigates to:

```text
synapse://auth/desktop/callback?code=<code>&state=<state>
```

4. The page also keeps an "打开 Synapse" retry button using the same deep link.
5. Admin dashboard sessions are rejected for desktop login and return `unsupported_account` to Desktop.

Plain dashboard login remains unchanged.

### Desktop Main Process

Add an account service responsible for credentials, state, server communication, and protocol callback processing.

The service owns:

- Current auth attempt.
- Refresh token persistence.
- Access token memory cache.
- `/api/auth/me` user profile cache.
- Login, callback exchange, refresh, logout, and account-state event emission.

Persist only:

- `refreshToken`
- access token expiry timestamp when available
- last known account summary from `/api/auth/me`
- pending login attempt state needed for cold-start callback validation

Do not persist the access token.

Use DataRepository namespace:

```text
core.account
```

Renderer receives account state through a typed preload bridge. Renderer never receives `refreshToken` or `accessToken`.

Account state shape distinguishes:

- `unauthenticated`
- `authenticating`
- `authenticated`
- `error`

Authenticated state includes `/me` data, not token data.

Protocol handling:

- Register `synapse://` as the app protocol.
- Support warm callbacks while the app is already running.
- Support cold-start callbacks before the main window exists.
- Support second-instance callback forwarding to the primary instance.
- Ignore non-auth `synapse://` URLs and log a sanitized warning.

Login flow:

1. Renderer asks main to start login.
2. Main generates high-entropy `state` and PKCE `codeVerifier`.
3. Main persists the active attempt with expiration and `codeVerifier`.
4. Main opens the system browser:

Development:

```text
http://localhost:3000/dashboard/auth/desktop?client_id=synapse-desktop&redirect_uri=synapse://auth/desktop/callback&response_type=code&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
```

Production:

```text
https://synapse.d2.pub/dashboard/auth/desktop?client_id=synapse-desktop&redirect_uri=synapse://auth/desktop/callback&response_type=code&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
```

5. Main handles `synapse://auth/desktop/callback`.
6. Main validates the current state and expiration.
7. Main exchanges the code and `codeVerifier`.
8. Main persists refresh token and stores access token in memory.
9. Main calls `/api/auth/me`.
10. Main emits the authenticated account state and focuses the main window.

Refresh flow:

- On startup, if refresh token exists, call `/api/auth/refresh`, then `/api/auth/me`.
- Refresh before access-token expiry when the expiry timestamp is known.
- On 401 from account-backed future APIs, refresh once and retry once.
- If refresh fails, clear token state and become unauthenticated.

Logout flow:

- Call `/api/auth/logout` with the refresh token when available.
- Clear local refresh token, access token, account profile, and pending attempts.
- If logout network revoke fails, still clear local state and log a sanitized warning.

### Desktop Renderer

Add a global account provider near the existing app shell providers. It consumes the account bridge and exposes:

- account state
- current user and team info
- start login
- logout
- refresh account info

The provider is optional and must not gate the whole app.

Top bar:

- Replace the current right-side repository controls with account UI.
- Unauthenticated state shows `登录`.
- Authenticating state shows a compact loading state.
- Authenticated state shows account identity, such as email.
- Account menu includes only necessary actions:
  - `账号信息`
  - `重新同步`
  - `退出登录`

Settings:

- Add `账号` as the first settings panel/category.
- The account panel shows current login state and actions.
- Keep the existing local identity panel separate.
- Do not imply remote account and local identity are linked.
- Do not add registration UI.

Repository controls:

- Remove repository sync/refresh/switch controls from the global top bar.
- Add one reusable component for content repository actions.
- Use it in the title row of `技能`, `规则`, and `提示词`.
- Do not duplicate separate implementations across the three pages.
- Other pages do not show repository controls.

The reusable component keeps the current repository capabilities:

- sync status
- pending push count
- refresh/sync
- switch repository
- open repository settings

### UI Rules

All Desktop UI follows the current shadcn/Radix baseline:

- Use existing `desktop/src/components/ui/` primitives.
- Use theme tokens and restrained Tailwind layout utilities.
- Do not add custom colors, decorative gradients, glow, or marketing text.
- Do not use card nesting.
- Keep UI copy short and necessary.

## Error Handling

- Missing state: fail login and ask user to retry.
- Expired state: fail login and ask user to retry.
- Reused code: fail login and ask user to retry.
- State mismatch: reject callback, clear attempt, log sanitized warning.
- Network failure during exchange: do not save tokens.
- `/me` failure after exchange: clear access token, try refresh once, then `/me` again.
- Refresh failure: clear account credentials and become unauthenticated.
- Logout revoke failure: clear local state anyway.
- Multiple login clicks: invalidate the older attempt and accept only the newest state.
- Unknown `synapse://` URL: ignore and log sanitized warning.

## Testing

Server tests:

- `authorize` requires authenticated normal user.
- `token` consumes code exactly once.
- Expired code fails.
- State mismatch fails.
- PKCE mismatch fails.
- Replayed code fails.
- Exchange response contains tokens but not user profile.
- Audit/log output does not contain code or token values.

Dashboard tests:

- Desktop authorization query parameters are preserved through login.
- After desktop login success, dashboard calls `authorize`.
- Handoff page builds the expected `synapse://auth/desktop/callback` URL.
- Retry button uses the same generated deep link.
- Normal dashboard login remains unchanged.

Desktop main tests:

- Start login creates and persists a valid attempt.
- New login invalidates old attempt.
- Warm protocol callback exchanges and emits authenticated state.
- Cold-start callback exchanges before or during main-window startup.
- State mismatch does not exchange.
- Refresh token persists; access token does not persist.
- Startup refresh calls `/refresh`, then `/me`.
- Logout clears local state even if revoke fails.

Desktop renderer tests:

- Top bar account UI renders unauthenticated, authenticating, authenticated, and error states.
- `账号` settings panel is first.
- Local identity panel remains separate.
- Repository actions no longer render in global top bar.
- Repository actions render in `技能`, `规则`, and `提示词` title rows.
- The three content pages reuse one repository action component.

## Release Notes

Implementation must update `RELEASE_NOTES_PENDING.md` because users will see:

- A new optional Desktop account login entry.
- Browser-based login that returns to the app.
- Top-bar account state.
- Repository controls moved into content resource pages.

## Non-Goals

- No Desktop registration UI in the first version.
- No embedded Electron webview login.
- No automatic binding between remote account and local identity.
- No remote account requirement for existing local features.
- No token exposure to renderer.
- No replacement of repository identity/profile behavior.
