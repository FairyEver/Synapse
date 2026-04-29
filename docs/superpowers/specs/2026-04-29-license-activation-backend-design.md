# License Activation Backend Design

## Goal

Add a first Synapse backend module for commercial licensing.

The first closed loop must support:

- Email + activation code activation.
- One activation code binds to one email account.
- Default one device per license.
- Server-side revocation, expiration, and device limit enforcement.
- A 7-day signed local license lease for offline desktop use.
- A minimal built-in admin UI for managing activation codes, accounts, licenses, and devices.
- Docker deployment with PostgreSQL.

This backend should be the beginning of a future Synapse cloud service. Licensing is the first module, but the structure should leave room for users, subscriptions, sync, and a richer admin console.

## Decisions

- Add a new `server/` pnpm workspace package.
- Use NestJS + Prisma + PostgreSQL.
- Keep the admin UI inside the `server` package, served by NestJS as static assets.
- Use shadcn/ui for the admin UI and base the shell on the official `sidebar-07` block.
- Use a single administrator account in the first version.
- Block the desktop app when no valid license is available.
- Use a random local device ID as the binding identity, with device name, platform, and app version stored for admin display.
- Use online activation plus a 7-day signed offline lease.

## Out Of Scope

- Payment providers.
- Subscription plans and billing.
- Multi-admin roles.
- Team seats shared by multiple email accounts.
- Password login for normal end users.
- Hardware fingerprinting.
- A standalone `admin` workspace package.
- Website changes.

## Monorepo Shape

The root workspace should add `server` to `pnpm-workspace.yaml`.

Root scripts should delegate into the package, following the existing desktop and website pattern:

```text
server:dev
server:build
server:test
server:typecheck
server:prisma:migrate
server:docker:up
```

The `server/` package should own:

- NestJS API source.
- Prisma schema and migrations.
- Admin UI source.
- Dockerfile.
- `server/compose.yml` for local Docker deployment.

Desktop activation integration belongs in `desktop/` and is part of the same closed loop. Implement the server APIs first, then wire the desktop gate to those APIs.

## Server Modules

`auth`

- Administrator login, logout, password verification, and admin session/JWT handling.
- Reads the initial admin account configuration from environment variables or a seed command.

`accounts`

- Stores email accounts created during activation.
- No user password in the first version.
- Email lookup should be case-insensitive.

`licenses`

- Owns activation codes, redeemed licenses, license statuses, device limits, and lease signing.
- Enforces one activation code to one account.

`devices`

- Stores bound devices for a license.
- Enforces the default one-device limit.
- Supports admin revocation.

`leases`

- Records each signed license issue or renewal.
- Keeps enough data for support and audit: account, license, device, issued time, expiry time, and token ID.

`admin`

- Serves the built-in admin UI.
- Exposes admin-only API endpoints.

`health`

- Exposes Docker health checks and basic runtime status.

## Data Model

`Account`

- `id`
- `email`
- `status`: `active`, `disabled`
- `createdAt`
- `updatedAt`

`ActivationCode`

- `id`
- `codeHash`
- `status`: `active`, `disabled`, `revoked`, `expired`
- `maxDevices`, default `1`
- `expiresAt`, nullable
- `boundAccountId`, nullable
- `redeemedAt`, nullable
- `createdAt`
- `updatedAt`

`License`

- `id`
- `accountId`
- `activationCodeId`
- `status`: `active`, `disabled`, `revoked`, `expired`
- `maxDevices`, default `1`
- `expiresAt`, nullable
- `createdAt`
- `updatedAt`

`Device`

- `id`
- `licenseId`
- `deviceIdHash`
- `name`
- `platform`
- `appVersion`
- `status`: `active`, `revoked`
- `firstSeenAt`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

`Lease`

- `id`
- `licenseId`
- `deviceId`
- `tokenId`
- `issuedAt`
- `expiresAt`
- `statusSnapshot`
- `createdAt`

`AdminUser`

- `id`
- `email`
- `passwordHash`
- `status`: `active`, `disabled`
- `createdAt`
- `updatedAt`

Activation codes and device IDs must not be stored in plaintext. Store hashes for lookup and comparison. Device ID hashes should be deterministic SHA-256 hashes of the local random device ID so the desktop app can compare its current device to the signed lease without knowing any server secret.

## License Lease Format

The server signs a compact JSON license with a server private key. The desktop app verifies it with an embedded public key.

Payload fields:

- `tokenId`
- `accountId`
- `email`
- `licenseId`
- `deviceIdHash`
- `issuedAt`
- `expiresAt`
- `maxDevices`
- `licenseStatus`
- `keyId`

Use Ed25519 through Node's standard crypto support. The desktop app must not contain the private key.

The client should treat server-signed `expiresAt` as authoritative. Local system time can only decide whether the signed lease is still inside its validity window.

## Client API

`GET /v1/license/config`

- Returns public key metadata, lease duration, and server time.

`POST /v1/activations/redeem`

- Request: email, activation code, device ID, device name, platform, app version.
- Behavior:
  - Hash and validate activation code.
  - Create or reuse the email account.
  - Bind an unused activation code to the account.
  - Allow an already-bound activation code only when the email matches the bound account.
  - Create a license if needed.
  - Bind the device if device capacity allows it.
  - Return a 7-day signed license lease.

`POST /v1/licenses/renew`

- Request: current signed lease, device ID, device metadata.
- Behavior:
  - Verify the lease signature and device.
  - Check account, license, activation code, and device status in the database.
  - Return a fresh 7-day lease when valid.
  - Return a clear revoked, disabled, expired, or device-limit error when invalid.

`GET /health`

- Returns process and database health for Docker.

## Admin API

The admin API requires an authenticated administrator session.

- `POST /admin/login`
- `POST /admin/logout`
- `GET /admin/activation-codes`
- `POST /admin/activation-codes`
- `PATCH /admin/activation-codes/:id`
- `GET /admin/accounts`
- `GET /admin/accounts/:id`
- `PATCH /admin/licenses/:id`
- `PATCH /admin/devices/:id`

Admin write actions should be explicit and auditable in the database where useful. Revoking a device or license should affect the next renewal immediately and force local users out when they are online.

## Admin UI

The admin UI lives inside the `server` package and is served by NestJS. It should use shadcn/ui and the official `sidebar-07` block as the application shell.

First-version pages:

- Login.
- Activation codes.
- Accounts and licenses.
- Account detail.
- Devices.
- System status.

Navigation:

- Activation codes.
- Accounts.
- Devices.
- System.

UI rules:

- Use the shadcn `sidebar-07` structure for the collapsible sidebar.
- Use shadcn components for buttons, inputs, tables, badges, dialogs, separators, and forms.
- Do not introduce custom colors, gradients, decorative effects, or marketing copy.
- Keep product copy short and operational.
- Use tables for lists and dialogs for create, revoke, disable, and confirm actions.

The first admin UI does not need a dashboard chart page.

## Desktop Activation Flow

The desktop app should keep authorization logic in Electron main-process services. React should render activation state and submit user input through typed preload APIs.

Startup:

1. Read or create the local random `deviceId`.
2. Read the local signed license lease.
3. Verify signature, device binding, and expiry.
4. If valid, enter the main app.
5. If missing, invalid, mismatched, or expired, show only the activation UI.
6. When online, attempt renewal in the background.

Activation:

1. User enters email and activation code.
2. Main process adds device ID and device metadata.
3. Desktop calls `POST /v1/activations/redeem`.
4. Main process stores the returned signed lease.
5. App enters the main UI.

Renewal:

- Try renewal on startup.
- Try renewal once per day while the app is running.
- Try renewal when the lease is close to expiry.
- If renewal fails due to network but the local lease is still valid, continue.
- If renewal returns revoked, disabled, expired, or invalid device, clear the local lease and show activation.
- If the lease is expired and network is unavailable, block usage until online verification succeeds.

## Security Boundaries

- Activation codes are displayed only at creation time, then stored as hashes.
- Device IDs are random application identifiers, not hardware fingerprints.
- The server private signing key is never packaged with the desktop app.
- Admin passwords are hashed.
- Admin endpoints are separate from client endpoints.
- License status is checked on every renewal.
- Offline revocation has a maximum 7-day delay.
- Sensitive server configuration comes from environment variables.

## Docker Deployment

First-version Docker Compose services:

- `server`
- `postgres`

The `server` container should:

- Run Prisma migrations during deployment or through an explicit migration command.
- Serve the NestJS API.
- Serve the built admin UI.
- Expose `/health`.

The root `server:docker:up` script should call `docker compose -f server/compose.yml up`.

Environment variables:

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` or an initial password hash
- `ADMIN_JWT_SECRET`
- `LICENSE_PRIVATE_KEY`
- `LICENSE_PUBLIC_KEY`
- `LICENSE_KEY_ID`
- `LICENSE_LEASE_DAYS`, default `7`

Production should sit behind HTTPS through the deployment's reverse proxy. The Node service itself does not need to terminate TLS in the first version.

## Testing

Server tests:

- Redeem valid activation code.
- Reject invalid activation code.
- Bind first redemption to an email account.
- Reject redemption by another email after binding.
- Enforce one-device limit by default.
- Renew a valid lease.
- Reject renewal after license revocation.
- Reject renewal after device revocation.
- Reject renewal after activation code or license expiry.

Desktop tests:

- Accept valid signed lease.
- Reject invalid signature.
- Reject device mismatch.
- Reject expired lease.
- Continue offline when lease is valid.
- Block when lease is expired and renewal cannot complete.

Admin UI tests:

- Login success and failure.
- Create activation code.
- Disable activation code.
- Revoke license.
- Revoke device.
- Render empty and loading states for tables.

## Acceptance Criteria

- The repo has a `server/` workspace package.
- The server uses NestJS, Prisma, and PostgreSQL.
- Docker Compose can run the server and PostgreSQL.
- An admin can log in through the built-in admin UI.
- The admin UI uses the shadcn `sidebar-07` block as its shell.
- An admin can create an activation code with default one-device capacity.
- A desktop client can redeem email + activation code + device metadata for a signed 7-day lease.
- The same activation code cannot be redeemed by a different email after binding.
- A second device is rejected by default.
- A valid local lease allows offline desktop startup.
- An expired, mismatched, or invalid lease blocks desktop startup.
- Server-side revocation prevents future renewal and forces online clients back to activation.
