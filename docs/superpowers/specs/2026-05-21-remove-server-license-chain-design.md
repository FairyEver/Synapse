# Remove Server License Chain Design

Date: 2026-05-21
Scope: `/Users/liyang/Documents/code/github/Synapse/server`

## Goal

Remove the old activation and license system from the server package. Activation keys, license issuance, license renewal, lease validation, old account records, devices, and all related admin screens are no longer product requirements. The database should not retain old authorization tables or data.

Future account work will be designed separately and should not reuse the old `Account` model semantics.

## In Scope

- Delete the public license API under `/v1/license/config`, `/v1/activations/redeem`, `/v1/licenses/renew`, and `/v1/licenses/validate`.
- Remove the Nest license domain module and its helpers:
  - `src/licenses/*`
  - `LicensesModule` import and registration
  - activation risk logic
  - license token signing and validation
  - activation code hashing helpers that are only used by this domain
- Remove old admin authorization management APIs:
  - activation code CRUD, archive, risk lock, replacement, batch update, export, and attempts
  - account listing/detail/status/note APIs backed by the old `Account` table
  - device listing/status/batch APIs backed by the old `Device` table
  - license listing/detail/status APIs
- Remove old admin frontend screens and navigation entries:
  - activation codes
  - accounts
  - account detail
  - devices
- Update the admin default route to a retained screen, preferably `system`.
- Remove Prisma schema models and enums for the old domain:
  - `Account`
  - `ActivationCode`
  - `License`
  - `Device`
  - `Lease`
  - `ActivationAttempt`
  - `AccountStatus`
  - `ManagedStatus`
  - `DeviceStatus`
  - `ActivationAttemptOutcome`
- Add a Prisma migration that drops the old tables, indexes, foreign keys, and enums. Data is intentionally discarded.
- Remove env parsing and examples for `LICENSE_*` and `ACTIVATION_*` settings.
- Remove backup export of license key material.
- Remove cleanup jobs that only manage activation attempt retention.
- Update tests by deleting old authorization tests and adjusting retained admin/system/env/backup expectations.
- Update server README sections that describe license key generation, activation codes, activation-code sync, or license env values.

## Out of Scope

- Designing or implementing the replacement account system.
- Migrating old account, device, activation, license, or lease data.
- Preserving compatibility for old clients that call license or activation endpoints.
- Changing admin authentication (`AdminUser`) or audit logs, except where audit entries referenced removed authorization screens.

## Architecture After Removal

The server keeps only non-authorization infrastructure and admin operations:

- `AdminAuthModule` continues to handle admin login/logout/session.
- `AdminModule` keeps system overview, audit log integration, backups, log files, and other retained operational APIs.
- `BackupModule`, `HealthModule`, `PrismaModule`, throttling, static admin serving, and structured logging remain.
- Prisma keeps `AdminUser` and `AuditLog` plus any non-authorization models that already exist.

There will be no `licenses` domain module and no old end-user authorization API. New account and access behavior must be introduced later as a separate domain with fresh schema and routes.

## Admin UI Behavior

The sidebar should no longer show activation codes, accounts, or devices. The default route should land on `#/system` so an admin opening `/admin` still sees a valid retained page.

Removed routes should fall back to the default retained page rather than rendering deleted components. UI copy should stay minimal and operational.

## Database Migration

The removal migration should drop tables in dependency order:

1. `Lease`
2. `Device`
3. `License`
4. `ActivationAttempt`
5. `ActivationCode`
6. `Account`

Then drop old enums once no table references them.

This migration is destructive by design. Existing old authorization data is not backed up or transformed by this change.

## Verification

Run focused checks from `server`:

- `pnpm test`
- `pnpm build`
- Prisma validation or generation command used by the package, if present
- Admin frontend test/build scripts, if defined in `server/admin/package.json`

Also run text searches to confirm no retained source references old authorization concepts:

- `rg "ActivationCode|ActivationAttempt|License|Lease|activationCode|license|activations|LICENSE_|ACTIVATION_" server`
- Review any remaining matches manually. Benign matches may include unrelated words such as Docker or SSH key documentation; old authorization matches should be gone.

## Risks

- Old clients will receive 404 responses for removed license endpoints.
- Admin pages linked from old bookmarks will route to the retained default page.
- Prisma generated client and tests must be refreshed after schema removal.
- README cleanup needs care because some `key` references are unrelated SSH or backup encryption material and should not be removed blindly.
