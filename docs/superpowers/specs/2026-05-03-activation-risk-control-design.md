# Activation Risk Control Design

## Goal

Improve the existing Synapse activation code mechanism against:

- Activation code brute force and enumeration.
- Shared activation code abuse after a valid code leaks.

The first version must support both the future official Synapse licensing service and customer self-hosted `server/` deployments. It should be self-contained in PostgreSQL and should not require Redis, cloud WAF features, CAPTCHA, or a third-party risk service.

## Current Baseline

The current licensing loop already has:

- Server-side activation code generation and hashed activation code storage.
- Email + activation code redemption.
- One activation code bound to one email account.
- License and device records with server-side revocation.
- Signed offline desktop license leases.
- Desktop activation and renewal through typed Electron APIs.
- Admin UI pages for activation codes, accounts, licenses, devices, and system status.

This design extends that baseline instead of replacing it.

## Decisions

- Use PostgreSQL as the only persistence and statistics backend.
- Store complete forensic activation attempt records, including raw IP address and User-Agent.
- Keep activation attempt records for a configurable retention period, defaulting to 90 days.
- Configure risk thresholds through environment variables with balanced defaults.
- Add code-level risk locking for suspicious activation codes.
- Risk locking blocks new activation but does not block renewal for already activated devices.
- Keep commercial status separate from risk status.
- Add admin actions to unlock, revoke, and replace risk-locked activation codes.
- Preserve the desktop lease payload format.

## Out Of Scope

- Redis-backed rate limiting.
- Admin UI threshold configuration.
- CAPTCHA or human verification.
- Risk dashboards, charts, or scoring workbenches.
- IP geolocation, ASN lookup, proxy detection, or threat intelligence feeds.
- Third-party fraud detection services.
- Payment, subscription, plan, or billing changes.
- Changes to renewal lease payloads.

## Data Model

### ActivationCode

Add independent risk fields to the existing `ActivationCode` model:

- `riskLockedAt`: nullable timestamp. A non-null value means the code is risk locked.
- `riskLockedReason`: nullable text. Stores the latest lock reason.
- `riskUnlockedAt`: nullable timestamp. Stores the latest unlock time.
- `riskReviewNote`: nullable text. Stores the latest admin review note.
- `replacedByActivationCodeId`: nullable self-reference to the replacement code.

Do not add `locked` to the existing `ManagedStatus` enum. The existing `status` field remains the commercial lifecycle state: `active`, `disabled`, `revoked`, or `expired`.

### ActivationAttempt

Add a new table for complete forensic records:

- `id`
- `activationCodeId`, nullable
- `activationCodeHash`
- `activationCodeHint`, nullable
- `email`
- `deviceIdHash`
- `ipAddress`
- `userAgent`
- `outcome`
- `reason`
- `createdAt`

Suggested `outcome` values:

- `success`
- `invalid_code`
- `bound_conflict`
- `rate_limited`
- `risk_locked`
- `device_limit`
- `blocked`

Indexes should support window queries by `createdAt`, `activationCodeHash`, `activationCodeId`, `email`, `deviceIdHash`, and `ipAddress`.

## Configuration

Add environment parsing for balanced default thresholds:

- `ACTIVATION_ATTEMPT_RETENTION_DAYS`, default `90`
- `ACTIVATION_RATE_WINDOW_MINUTES`, default `15`
- `ACTIVATION_RATE_MAX_FAILURES_PER_IP`, default `20`
- `ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL`, default `8`
- `ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE`, default `8`
- `ACTIVATION_RISK_WINDOW_MINUTES`, default `60`
- `ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE`, default `6`
- `ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE`, default `4`
- `ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE`, default `4`
- `ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE`, default `3`

Failure counts include `invalid_code`, `bound_conflict`, `device_limit`, `risk_locked`, `blocked`, and `rate_limited`. They do not include `success`.

## Server Architecture

Add an `ActivationRiskService` under the server licensing domain. It owns attempt recording, rate-limit checks, code-level risk evaluation, risk locking, unlock support, replacement support, and retention cleanup.

`LicensesService.redeem()` should keep the activation business flow and delegate risk logic at well-defined points:

1. Normalize email and activation code.
2. Build an attempt context with email, activation code hash, device hash, IP address, and User-Agent.
3. Check short-window rate limits before expensive redemption work.
4. Resolve activation code and normal validation state.
5. Record every outcome.
6. Evaluate code-level risk after failed, bound-conflict, device-limit, blocked, or rate-limited outcomes.
7. Proceed to license and device creation only when risk checks pass.

`LicensesService.renew()` must not reject solely because `ActivationCode.riskLockedAt` is set. Renewal continues to enforce account, activation commercial status, license status, device status, and expiry.

## Risk Behavior

### Rate Limiting

Short-window rate limiting applies to new activation attempts using these dimensions:

- IP address.
- Email.
- Device hash.

When rate limited, the server records an attempt with `outcome = rate_limited` and returns a stable error code.

### Code-Level Risk Locking

The server risk-locks an activation code when the configured risk window shows suspicious diversity or repeated conflicts:

- Too many distinct IP addresses for the same code.
- Too many distinct emails for the same code.
- Too many distinct device hashes for the same code.
- Too many attempts against an already-bound code from other emails.

Invalid codes still produce attempt records by hash. They can participate in rate limits, but only existing activation codes can be risk locked.

### Risk-Locked Codes

When an activation code is risk locked:

- New activation attempts are rejected.
- New device activation under the same bound account is rejected.
- Already active devices can continue renewing.
- An already active device that lost its local lease may redeem the same email and code again to recover a lease.

The existing-device recovery exception must be checked before returning the risk-lock rejection. It applies only when the email matches the bound account and the submitted device hash already belongs to an active device on the license.

This preserves legitimate users while stopping leaked codes from spreading.

## Admin API

Extend the existing admin API:

- `GET /admin/api/activation-codes/:id/attempts`
  Returns recent activation attempts for one code, ordered by newest first. Default limit: 100.

- `PATCH /admin/api/activation-codes/:id/risk-lock`
  Manually locks or unlocks the risk state. Unlock requests may include a review note.

- `POST /admin/api/activation-codes/:id/replace`
  Replaces a bound activation code. The response returns the new plaintext code once.

The existing `PATCH /admin/api/activation-codes/:id` remains responsible for commercial status changes such as revoked or disabled.

## Replacement Semantics

Replacing a bound activation code runs in one database transaction:

1. Generate a new activation code.
2. Create the new code with inherited `maxDevices` and `expiresAt`.
3. Bind the new code to the original account.
4. Move the existing `License.activationCodeId` to the new code.
5. Mark the old code `status = revoked`.
6. Set `old.replacedByActivationCodeId` to the new code.
7. Return the new plaintext code once.

Existing devices and leases remain attached to the same license. Desktop renewal continues to work because the lease payload references `licenseId`, not activation code ID.

Unbound codes do not need replacement; admins can revoke them and create new codes through the existing flow.

## Admin UI

Keep UI changes inside the existing activation codes page. Do not add a separate risk dashboard in the first version.

Activation code table changes:

- Add a "风控" column showing normal or locked state.
- Add row actions for:
  - Attempts.
  - Unlock.
  - Replace.
  - Revoke.

Attempt dialog:

- Show time, outcome, email, device hash, IP address, User-Agent, and reason.
- Use the existing shadcn table and dialog primitives.
- Keep copy short and operational.

Unlock dialog:

- Accept an optional review note.
- Clear risk lock fields after confirmation.

Replace dialog:

- Available only for codes bound to an account.
- After success, display the new code once, matching the current generated-code behavior.

Use existing shadcn components and theme tokens. Do not introduce custom colors, gradients, charts, or explanatory copy.

## Client API Errors

Server client API errors should include stable machine-readable codes:

```json
{
  "code": "ACTIVATION_RATE_LIMITED",
  "message": "请稍后再试。"
}
```

Required first-version codes:

- `ACTIVATION_RATE_LIMITED`
- `ACTIVATION_RISK_LOCKED`
- `ACTIVATION_INVALID`
- `ACTIVATION_BOUND_CONFLICT`
- `ACTIVATION_DEVICE_LIMIT`

Desktop `LicenseClientRequestError` should preserve `code?: string`.

Desktop copy:

- Rate limited: `尝试过于频繁，请稍后再试。`
- Risk locked: `激活码暂不可用，请联系管理员。`
- Invalid activation: `激活失败，请检查信息。`
- Bound conflict: `激活码已绑定其他账号。`
- Device limit: `设备数量已达上限。`

The UI should avoid exposing threshold internals.

## Retention Cleanup

Add a service method or scheduled server maintenance path that deletes `ActivationAttempt` rows older than `ACTIVATION_ATTEMPT_RETENTION_DAYS`.

The first version can invoke cleanup opportunistically from server startup or a lightweight interval. It does not require a dedicated scheduler package.

## Testing

Server tests:

- Invalid and failed attempts are recorded.
- Successful activation attempts are recorded.
- Per-IP rate limit returns `ACTIVATION_RATE_LIMITED`.
- Per-email rate limit returns `ACTIVATION_RATE_LIMITED`.
- Per-device rate limit returns `ACTIVATION_RATE_LIMITED`.
- Repeated bound conflicts are recorded and can risk-lock a code.
- Distinct IP, email, or device diversity can risk-lock a code.
- Risk-locked codes reject new activation.
- Risk-locked codes do not block renewal for existing active devices.
- Existing active devices can recover a lost lease by redeeming the same email and code.
- Admin unlock clears risk lock state.
- Replacement revokes the old code, creates a new bound code, migrates the license, and preserves device renewal.
- Retention cleanup deletes old activation attempts and keeps recent attempts.

Desktop tests:

- `LicenseClientRequestError` preserves server `code`.
- Rate-limited activation shows the rate-limit copy.
- Risk-locked activation shows the contact-admin copy.

Admin UI tests:

- Activation code table renders risk state.
- Attempts dialog renders attempt records.
- Unlock action calls the risk-lock API.
- Replace action calls the replace API and shows the new code once.

## Acceptance Criteria

- New activation attempts are recorded with enough detail for forensic review.
- Balanced default rate limits block repeated short-window failures.
- Valid leaked-code propagation can trigger code-level risk locking.
- Risk locking blocks new activation without blocking renewal for already active devices.
- Admins can view attempts, unlock, revoke, and replace a code.
- Replacement migrates the license to the new code and keeps existing devices usable.
- Desktop users receive distinct but non-revealing messages for rate limiting and risk locking.
- Attempt retention is configurable and defaults to 90 days.
