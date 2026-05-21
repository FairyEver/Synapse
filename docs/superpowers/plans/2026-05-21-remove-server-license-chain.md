# Remove Server License Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the old activation, license, lease, old account, and device authorization domain from `/Users/liyang/Documents/code/github/Synapse/server`.

**Architecture:** Delete the old authorization domain instead of adapting it. Keep admin auth, audit logs, backup, system overview, log viewing, health checks, and static admin serving. Prisma keeps only non-authorization models after a destructive migration drops old authorization tables and enums.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Vite, shadcn/ui, TypeScript, Vitest, pnpm.

---

## File Map

- Modify `server/src/app.module.ts`: remove `LicensesModule` and `CleanupService`.
- Delete `server/src/licenses/`: remove old public authorization service, controller, token, risk, hash helpers, and tests.
- Delete `server/src/common/cleanup.service.ts`: it only cleans activation attempts.
- Modify `server/src/config/env.ts`: remove `LICENSE_*` and `ACTIVATION_*` parsing and `normalizePem`.
- Modify `server/.env.example`: remove old authorization env values.
- Modify `server/compose.yml`: remove `LICENSE_KEY_ID`.
- Modify `server/src/backup/backup.service.ts`: stop exporting encrypted license key material; archive only the database dump.
- Delete `server/scripts/decrypt-keys.js`: no `keys.enc` backup artifact remains.
- Modify `server/prisma/schema.prisma`: remove old authorization models and enums.
- Add `server/prisma/migrations/20260521000000_drop_license_chain/migration.sql`: drop old tables and enums.
- Modify `server/src/admin/admin.controller.ts`: remove activation code, account, device, and license endpoints.
- Modify `server/src/admin/admin.service.ts`: remove old authorization methods and keep only system overview.
- Update or delete tests under `server/src/admin/`, `server/src/config/`, `server/src/backup/`, and `server/src/licenses/`.
- Modify `server/admin/src/App.tsx`: remove old routes and default to `system`.
- Modify `server/admin/src/components/app-sidebar.tsx`: remove activation code/account/device nav items.
- Modify `server/admin/src/lib/api.ts`: remove old authorization types and API client methods; keep retained admin API types.
- Delete old admin pages and tests:
  - `server/admin/src/pages/activation-codes-page.tsx`
  - `server/admin/src/pages/activation-codes-page.test.tsx`
  - `server/admin/src/pages/accounts-page.tsx`
  - `server/admin/src/pages/accounts-page.test.tsx`
  - `server/admin/src/pages/account-detail-page.tsx`
  - `server/admin/src/pages/devices-page.tsx`
  - `server/admin/src/pages/devices-page.test.tsx`
- Modify `server/admin/src/pages/system-page.tsx`: remove old authorization counters.
- Modify `server/README.md`: remove license key generation, activation code, license env, and activation-code sync sections.

## Task 1: Remove Backend License Domain Registration

**Files:**
- Modify: `server/src/app.module.ts`
- Delete: `server/src/common/cleanup.service.ts`
- Delete: `server/src/licenses/*`

- [ ] **Step 1: Update module wiring**

Edit `server/src/app.module.ts` so the top imports no longer include:

```ts
import { CleanupService } from "./common/cleanup.service"
import { LicensesModule } from "./licenses/licenses.module"
```

and the module metadata no longer includes:

```ts
LicensesModule,
```

or:

```ts
CleanupService,
```

The retained provider block should be:

```ts
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
```

- [ ] **Step 2: Delete license-only backend files**

Remove:

```text
server/src/common/cleanup.service.ts
server/src/licenses/activation-risk.service.ts
server/src/licenses/activation-risk.service.spec.ts
server/src/licenses/hash.ts
server/src/licenses/license-token.ts
server/src/licenses/license-token.spec.ts
server/src/licenses/license.types.ts
server/src/licenses/licenses.controller.ts
server/src/licenses/licenses.controller.spec.ts
server/src/licenses/licenses.module.ts
server/src/licenses/licenses.service.ts
server/src/licenses/licenses.service.spec.ts
```

- [ ] **Step 3: Verify imports are gone**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
rg "LicensesModule|CleanupService|ActivationRiskService|licenses/" src
```

Expected: no matches.

## Task 2: Remove Authorization Env and Backup Key Export

**Files:**
- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.spec.ts`
- Modify: `server/.env.example`
- Modify: `server/compose.yml`
- Modify: `server/src/backup/backup.service.ts`
- Delete: `server/scripts/decrypt-keys.js`

- [ ] **Step 1: Simplify server env schema**

In `server/src/config/env.ts`, remove these schema fields:

```ts
  LICENSE_PRIVATE_KEY: z.string().min(1),
  LICENSE_PUBLIC_KEY: z.string().min(1),
  LICENSE_KEY_ID: z.string().min(1),
  LICENSE_LEASE_DAYS: z.coerce.number().int().positive().default(7),
  ACTIVATION_ATTEMPT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  ACTIVATION_RATE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  ACTIVATION_RATE_MAX_FAILURES_PER_IP: z.coerce.number().int().positive().default(20),
  ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL: z.coerce.number().int().positive().default(8),
  ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE: z.coerce.number().int().positive().default(8),
  ACTIVATION_RISK_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE: z.coerce.number().int().positive().default(6),
  ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE: z.coerce.number().int().positive().default(4),
  ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE: z.coerce.number().int().positive().default(4),
  ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE: z.coerce.number().int().positive().default(3),
```

Remove matching `ServerEnv` fields and `loadEnv` return values. Remove the unused helper:

```ts
function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n")
}
```

- [ ] **Step 2: Update env tests**

In `server/src/config/env.spec.ts`, make the minimum valid env object contain only:

```ts
{
  DATABASE_URL: "postgresql://user:pass@localhost:5432/synapse",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "long-enough-password",
  ADMIN_JWT_SECRET: "qwer1234asdf5678qwer1234asdf5678",
}
```

Assert retained defaults only:

```ts
expect(env.databasePoolSize).toBe(10)
expect(env.port).toBe(3000)
```

Delete tests that assert license key normalization or activation risk defaults.

- [ ] **Step 3: Update env example and compose**

Remove all `LICENSE_*` and `ACTIVATION_*` lines from `server/.env.example`.

Remove this environment entry from `server/compose.yml`:

```yaml
      LICENSE_KEY_ID: ${LICENSE_KEY_ID:-local-dev-key}
```

- [ ] **Step 4: Simplify backup archive contents**

In `server/src/backup/backup.service.ts`, remove the `node:crypto` import and remove calls to `encryptKeys()`.

Change `performBackup` from:

```ts
      const keysBuffer = this.encryptKeys()

      const archivePath = await this.packFiles(dbPath, keysBuffer)
```

to:

```ts
      const archivePath = await this.packFiles(dbPath)
```

Delete the `encryptKeys()` method.

Change the `packFiles` signature and body from writing two files:

```ts
  private async packFiles(dbPath: string, keysBuffer: Buffer): Promise<string> {
    ...
    fs.copyFileSync(dbPath, path.join(workDir, "database.sql.gz"))
    fs.writeFileSync(path.join(workDir, "keys.enc"), keysBuffer)

    await tar.create(
      { gzip: true, file: archivePath, cwd: workDir },
      ["database.sql.gz", "keys.enc"],
    )
```

to database-only packing:

```ts
  private async packFiles(dbPath: string): Promise<string> {
    ...
    fs.copyFileSync(dbPath, path.join(workDir, "database.sql.gz"))

    await tar.create(
      { gzip: true, file: archivePath, cwd: workDir },
      ["database.sql.gz"],
    )
```

- [ ] **Step 5: Delete old backup helper**

Remove:

```text
server/scripts/decrypt-keys.js
```

- [ ] **Step 6: Verify config tests**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm test src/config/env.spec.ts
```

Expected: config env tests pass.

## Task 3: Remove Prisma Authorization Schema

**Files:**
- Modify: `server/prisma/schema.prisma`
- Add: `server/prisma/migrations/20260521000000_drop_license_chain/migration.sql`

- [ ] **Step 1: Remove old models and enums from schema**

In `server/prisma/schema.prisma`, remove these enum blocks:

```prisma
enum AccountStatus {
  active
  disabled
}

enum ManagedStatus {
  active
  disabled
  revoked
  expired
}

enum DeviceStatus {
  active
  revoked
}

enum ActivationAttemptOutcome {
  success
  invalid_code
  bound_conflict
  reserved_mismatch
  rate_limited
  risk_locked
  device_limit
  blocked
}
```

Remove these model blocks:

```prisma
model Account { ... }
model ActivationCode { ... }
model License { ... }
model Device { ... }
model Lease { ... }
model ActivationAttempt { ... }
```

Keep `AdminStatus`, `AdminUser`, and `AuditLog`.

- [ ] **Step 2: Add destructive migration**

Create `server/prisma/migrations/20260521000000_drop_license_chain/migration.sql`:

```sql
DROP TABLE IF EXISTS "Lease";
DROP TABLE IF EXISTS "Device";
DROP TABLE IF EXISTS "License";
DROP TABLE IF EXISTS "ActivationAttempt";
DROP TABLE IF EXISTS "ActivationCode";
DROP TABLE IF EXISTS "Account";

DROP TYPE IF EXISTS "ActivationAttemptOutcome";
DROP TYPE IF EXISTS "DeviceStatus";
DROP TYPE IF EXISTS "ManagedStatus";
DROP TYPE IF EXISTS "AccountStatus";
```

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm exec prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

## Task 4: Remove Admin Backend Authorization APIs

**Files:**
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`
- Modify: `server/src/admin/admin.service.spec.ts`

- [ ] **Step 1: Trim admin controller**

In `server/src/admin/admin.controller.ts`, remove imports that are only used by deleted endpoints:

```ts
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { parsePagination } from "../common/pagination"
import { toCsv } from "../common/csv-export"
```

Replace them with the retained imports:

```ts
import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { AuditLogService } from "../common/audit-log.service"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"
```

Delete all activation code, account, device, and license route methods. Keep:

```ts
  @Get("/audit-logs")
  listAuditLogs(@Query() query: Record<string, unknown>) { ... }

  @Get("/system")
  getSystemOverview() {
    return this.admin.getSystemOverview()
  }

  @Get("/audit-logs/export")
  async exportAuditLogs(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) { ... }
```

Delete `parseCreateActivationCode`, `parseRiskLock`, `createActivationCodeSchema`, `riskLockSchema`, `batchSchema`, and `deviceBatchSchema`.

- [ ] **Step 2: Trim admin service**

In `server/src/admin/admin.service.ts`, replace the file with a focused service:

```ts
import { Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getSystemOverview() {
    const [auditLogs] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        auditLogs,
      },
    }
  }
}
```

- [ ] **Step 3: Update admin backend tests**

Delete tests that assert activation code, account, device, or license behavior from:

```text
server/src/admin/admin.controller.spec.ts
server/src/admin/admin.service.spec.ts
```

Keep or add a service test that stubs:

```ts
const prisma = {
  $transaction: vi.fn().mockResolvedValue([3]),
}
```

and asserts:

```ts
await expect(service.getSystemOverview()).resolves.toMatchObject({
  counts: { auditLogs: 3 },
})
```

- [ ] **Step 4: Run admin backend tests**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm test src/admin
```

Expected: admin backend tests pass.

## Task 5: Remove Admin Frontend Authorization Screens

**Files:**
- Modify: `server/admin/src/App.tsx`
- Modify: `server/admin/src/App.test.tsx`
- Modify: `server/admin/src/components/app-sidebar.tsx`
- Modify: `server/admin/src/lib/api.ts`
- Modify: `server/admin/src/pages/system-page.tsx`
- Delete authorization pages and tests listed in the file map.

- [ ] **Step 1: Trim admin routes**

In `server/admin/src/App.tsx`, remove imports for:

```ts
import { AccountDetailPage } from "@/pages/account-detail-page"
import { AccountsPage } from "@/pages/accounts-page"
import { ActivationCodesPage } from "@/pages/activation-codes-page"
import { DevicesPage } from "@/pages/devices-page"
```

Replace the `Route` type with:

```ts
type Route =
  | { name: "audit-logs" }
  | { name: "system" }
  | { name: "backup" }
  | { name: "logs" }
```

Change `routeFromHash()` default to `system`:

```ts
function routeFromHash(): Route {
  const route = window.location.hash.replace(/^#\/?/, "") || "system"
  if (route === "audit-logs") return { name: "audit-logs" }
  if (route === "backup") return { name: "backup" }
  if (route === "logs") return { name: "logs" }
  return { name: "system" }
}
```

Update `titleForRoute()` so it only handles retained routes:

```ts
function titleForRoute(route: Route): string {
  switch (route.name) {
    case "audit-logs":
      return "审计日志"
    case "backup":
      return "备份管理"
    case "logs":
      return "系统日志"
    case "system":
    default:
      return "系统"
  }
}
```

Remove render branches for deleted pages.

- [ ] **Step 2: Trim sidebar**

In `server/admin/src/components/app-sidebar.tsx`, remove these icon imports:

```ts
KeyRoundIcon,
MonitorIcon,
UsersIcon,
```

Remove nav items for:

```ts
激活码
账号
设备
```

- [ ] **Step 3: Trim admin API types and methods**

In `server/admin/src/lib/api.ts`, remove:

```ts
export type ManagedStatus = ...
export type DeviceStatus = ...
export type AccountStatus = ...
export interface ActivationCode ...
export interface CreatedActivationCode ...
export interface LicenseDevice ...
export interface LicenseActivationCode ...
export interface License ...
export interface Account ...
export interface Device ...
export interface Lease ...
export type ActivationAttemptOutcome ...
export interface ActivationAttempt ...
```

Change `SystemOverview` counts to:

```ts
export interface SystemOverview {
  readonly serverTime: string
  readonly counts: {
    readonly auditLogs: number
  }
}
```

Remove `adminApi` methods for activation codes, accounts, devices, and licenses. Keep session, login, logout, `getSystemOverview`, audit log methods, backup methods, and log methods.

- [ ] **Step 4: Delete frontend pages**

Remove:

```text
server/admin/src/pages/activation-codes-page.tsx
server/admin/src/pages/activation-codes-page.test.tsx
server/admin/src/pages/accounts-page.tsx
server/admin/src/pages/accounts-page.test.tsx
server/admin/src/pages/account-detail-page.tsx
server/admin/src/pages/devices-page.tsx
server/admin/src/pages/devices-page.test.tsx
```

- [ ] **Step 5: Update system page counters**

In `server/admin/src/pages/system-page.tsx`, remove cards or rows for activation codes, accounts, licenses, devices, and leases. Keep a single retained operational count:

```tsx
<TableRow>
  <TableCell>审计日志</TableCell>
  <TableCell className="text-right">{data.counts.auditLogs}</TableCell>
</TableRow>
```

Use existing shadcn table components and existing classes only.

- [ ] **Step 6: Run admin frontend tests**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm test:admin
```

Expected: admin frontend tests pass.

## Task 6: Remove README Authorization Documentation

**Files:**
- Modify: `server/README.md`

- [ ] **Step 1: Remove old authorization sections**

Delete README content that describes:

```text
License 密钥对
LICENSE_PRIVATE_KEY
LICENSE_PUBLIC_KEY
LICENSE_KEY_ID
LICENSE_LEASE_DAYS
激活码
授权
/v1/activations/redeem
/v1/licenses/renew
/v1/licenses/validate
```

Keep unrelated SSH key setup, admin login, deployment, database, backup, and log documentation.

- [ ] **Step 2: Verify README does not mention old endpoints**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
rg "LICENSE_|ACTIVATION_|/v1/activations|/v1/licenses|激活码|License 密钥|授权" README.md
```

Expected: no old authorization matches. If `授权` appears only in unrelated prose, rewrite that prose to avoid the old domain meaning.

## Task 7: Full Verification and Final Cleanup

**Files:**
- Inspect all modified files under `server/`.

- [ ] **Step 1: Search for old authorization symbols**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse
rg "ActivationCode|ActivationAttempt|ActivationRisk|LicensesModule|LicensesService|license-token|activationCode|activationAttempt|activation-codes|LICENSE_|ACTIVATION_" server
```

Expected: no source references to the removed authorization domain. Review any remaining README or migration history matches manually.

- [ ] **Step 2: Regenerate Prisma client**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm prisma:generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 3: Typecheck**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm typecheck
```

Expected: both server and admin TypeScript checks pass.

- [ ] **Step 4: Run all server tests**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm test
```

Expected: all server Vitest tests pass.

- [ ] **Step 5: Run admin tests**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm test:admin
```

Expected: all admin Vitest tests pass.

- [ ] **Step 6: Build**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm build
```

Expected: API and admin builds pass.

- [ ] **Step 7: Review diff scope**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse
git diff --stat
git diff --name-only
```

Expected: changed files are limited to the server authorization removal and docs/plan files. Existing unrelated dirty files under `desktop/electron/usage-analysis/` must remain untouched.

- [ ] **Step 8: Commit implementation**

Run:

```bash
cd /Users/liyang/Documents/code/github/Synapse
git add server docs/superpowers/plans/2026-05-21-remove-server-license-chain.md
git commit -m "refactor(server): remove license chain"
```

Expected: commit succeeds and does not include unrelated desktop changes.
