# Drive Password Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password and expiration protection to Drive file shares, folder shares, page publications, and site publications, with server-side enforcement and creator-visible passwords.

**Architecture:** Shared DTOs and URL helpers carry access-protection metadata through server, Electron account bridge, and renderer UI. Server-side Drive code owns password generation, bcrypt hashes, AES-GCM encrypted readable passwords, idempotent legacy backfill, signed HttpOnly access cookies, and public route gating before any protected bytes are returned. Desktop Drive UI inserts a settings dialog before share/publish actions and extends success and management dialogs to show password, expiration, and password-bearing links.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, bcryptjs, Node `crypto`, Express cookies, Electron preload IPC, React, shadcn/Radix, Tailwind tokens, Vitest, Supertest.

---

## File Structure

- Modify: `shared/src/drive.ts`
  - Add access-setting types, DTO fields, `buildDriveUrlWithPassword`, and password query redaction.
- Modify: `shared/src/drive.test.ts`
  - Cover password-bearing URL construction and password query masking.
- Modify: `server/prisma/schema.prisma`
  - Add `passwordEncrypted` to `DriveShare`; add protection fields to `DrivePublication`.
- Create: `server/prisma/migrations/20260609120000_drive_access_protection/migration.sql`
  - Add nullable protection columns and indexes used by active backfill queries.
- Create: `server/src/drive/drive-access-protection.ts`
  - Generate easy-read passwords, compute expiration, hash/verify passwords, encrypt/decrypt readable passwords, sign/verify access cookies, and build creator-visible protected DTO fields.
- Create: `server/src/drive/drive-access-protection.spec.ts`
  - Unit tests for password alphabet, expiration presets, encryption roundtrip, cookie binding, and password URL redaction.
- Modify: `server/src/drive/drive.types.ts`
  - Extend publication record typing and DTO conversion with protection fields.
- Modify: `server/src/drive/drive.service.ts`
  - Accept protection settings on share/publish, overwrite active link settings without changing public ids, preserve protection on redeploy, list readable passwords, resolve protected public access, and run idempotent legacy backfill.
- Modify: `server/src/drive/drive.service.spec.ts`
  - Cover create/overwrite/backfill/redeploy/list/expiration/service-gated public access.
- Modify: `server/src/drive/drive.controller.ts`
  - Validate new request bodies, handle password query unlock, set HttpOnly cookies, render password pages, return file share landing pages, and gate all public download/publication routes.
- Modify: `server/src/drive/drive.controller.spec.ts`
  - Cover API request bodies, password query redirect, clean URL, cookie behavior, protected page/resource denial, file share landing page, and download denial.
- Modify: `desktop/src/types/bridge.ts`
  - Add `DriveAccessSettingsInput` and update share/publish bridge signatures.
- Modify: `desktop/electron/modules/account/ipc.ts`
  - Validate access settings and result DTO fields.
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
  - Cover share/publish forwarding settings.
- Modify: `desktop/electron/services/account-service.ts`
  - Send access settings to server and rebuild `urlWithPassword` using current public URLs.
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
  - Cover protected URL remapping and request bodies.
- Modify: `desktop/electron/preload.ts`
  - Type-compatible bridge exposure only; channel names remain unchanged.
- Modify: `desktop/src/modules/drive/index.tsx`
  - Add settings dialog state, success dialog password/link fields, management columns/actions, and new share/publish handlers.
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Cover settings dialog defaults, cancel behavior, confirm payloads, result password display, copy protected link/password, and management list columns/actions.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add user-facing note under `新增功能`.

## Implementation Notes

Use this shared request shape everywhere:

```ts
export type DriveAccessExpiresIn = "7d" | "30d" | "1y" | "forever"

export interface DriveAccessSettingsInput {
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
}
```

Use `passwordEncrypted` as the Prisma column name. Derive the AES-GCM key from `loadEnv(process.env).userAccessJwtSecret` with SHA-256 inside `drive-access-protection.ts`. This avoids a new required environment variable and avoids deployment churn. If the auth secret changes, old readable passwords cannot be decrypted; implementation must surface a safe creator-facing fallback such as `password: null` in lists while keeping `passwordHash` based public verification working for already issued links only until users regenerate settings.

Default settings live in shared code:

```ts
export const DRIVE_DEFAULT_ACCESS_SETTINGS: DriveAccessSettingsInput = {
  passwordEnabled: true,
  expiresIn: "7d",
}
```

Never put password values into logs. Tests should assert masking at shared helper level and avoid logging real generated passwords.

---

### Task 1: Shared DTOs and URL Helpers

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add these tests to `shared/src/drive.test.ts`:

```ts
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  buildDrivePublicationUrl,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  maskDrivePublicUrl,
  maskDriveShareUrl,
} from "./drive"

it("builds password-bearing drive URLs", () => {
  expect(buildDriveUrlWithPassword("https://synapse.d2.pub/files/shr_abc", "AbC234xy"))
    .toBe("https://synapse.d2.pub/files/shr_abc?password=AbC234xy")
  expect(buildDriveUrlWithPassword("https://synapse.d2.pub/sites/pub_abc/?x=1", "AbC234xy"))
    .toBe("https://synapse.d2.pub/sites/pub_abc/?x=1&password=AbC234xy")
})

it("does not add a password query when the password is null", () => {
  expect(buildDriveUrlWithPassword("https://synapse.d2.pub/files/shr_abc", null))
    .toBe("https://synapse.d2.pub/files/shr_abc")
})

it("redacts drive password query values", () => {
  expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret?password=AbC234xy"))
    .toBe("https://synapse.d2.pub/files/***?password=***")
  expect(maskDrivePublicUrl("https://synapse.d2.pub/sites/pub_secret/app.js?password=AbC234xy"))
    .toBe("https://synapse.d2.pub/sites/***/app.js?password=***")
})

it("defines the default drive access settings", () => {
  expect(DRIVE_DEFAULT_ACCESS_SETTINGS).toEqual({ passwordEnabled: true, expiresIn: "7d" })
})
```

- [ ] **Step 2: Run shared tests to verify failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: FAIL with missing exports `buildDriveUrlWithPassword` and `DRIVE_DEFAULT_ACCESS_SETTINGS`.

- [ ] **Step 3: Extend shared drive types and helpers**

In `shared/src/drive.ts`, add the exported types and fields:

```ts
export type DriveAccessExpiresIn = "7d" | "30d" | "1y" | "forever"

export interface DriveAccessSettingsInput {
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
}

export const DRIVE_DEFAULT_ACCESS_SETTINGS: DriveAccessSettingsInput = {
  passwordEnabled: true,
  expiresIn: "7d",
}
```

Extend `DriveShareDto`:

```ts
export interface DriveShareDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly enabled: boolean
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
  readonly createdAt: string
}
```

Extend `DrivePublicationDto`:

```ts
export interface DrivePublicationDto {
  readonly id: string
  readonly publishId: string
  readonly type: DrivePublicationType
  readonly name: string
  readonly status: DrivePublicationStatus
  readonly sourceItemId: string | null
  readonly sourceDeleted: boolean
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
  readonly currentDeploymentId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
```

Extend `DriveShareListItemDto`:

```ts
export interface DriveShareListItemDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly itemName: string
  readonly itemType: DriveShareItemType
  readonly sourceDeleted: boolean
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
  readonly createdAt: string
}
```

Add helper functions:

```ts
export function buildDriveUrlWithPassword(url: string, password: string | null | undefined): string {
  if (!password) return url
  const parsed = new URL(url)
  parsed.searchParams.set("password", password)
  return parsed.toString()
}

function maskPasswordQuery(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.searchParams.has("password")) parsed.searchParams.set("password", "***")
    return parsed.toString()
  } catch {
    return value.replace(/([?&]password=)[^&#]*/giu, "$1***")
  }
}
```

Update both mask helpers to call `maskPasswordQuery(...)` after masking ids.

- [ ] **Step 4: Run shared tests to verify pass**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared changes**

Run:

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(shared): add drive access link helpers"
```

Expected: commit succeeds.

---

### Task 2: Database and Protection Helper

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260609120000_drive_access_protection/migration.sql`
- Create: `server/src/drive/drive-access-protection.ts`
- Create: `server/src/drive/drive-access-protection.spec.ts`

- [ ] **Step 1: Write failing protection helper tests**

Create `server/src/drive/drive-access-protection.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildDriveAccessCookie,
  computeDriveAccessExpiresAt,
  decryptDrivePassword,
  encryptDrivePassword,
  generateDrivePassword,
  verifyDriveAccessCookie,
} from "./drive-access-protection"

const secret = "user-secret-with-enough-length-32chars"

describe("drive access protection", () => {
  it("generates eight readable characters without ambiguous symbols", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateDrivePassword()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
    }
  })

  it("computes expiration presets", () => {
    const now = new Date("2026-06-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("7d", now)?.toISOString()).toBe("2026-06-16T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("30d", now)?.toISOString()).toBe("2026-07-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("1y", now)?.toISOString()).toBe("2027-06-09T00:00:00.000Z")
    expect(computeDriveAccessExpiresAt("forever", now)).toBeNull()
  })

  it("encrypts and decrypts readable passwords", () => {
    const encrypted = encryptDrivePassword("AbC234xy", secret)
    expect(encrypted).not.toContain("AbC234xy")
    expect(decryptDrivePassword(encrypted, secret)).toBe("AbC234xy")
  })

  it("binds access cookies to resource identity", () => {
    const cookie = buildDriveAccessCookie({
      kind: "share",
      publicId: "shr_abc",
      expiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })
    expect(verifyDriveAccessCookie(cookie, {
      kind: "share",
      publicId: "shr_abc",
      now: new Date("2026-06-10T00:00:00.000Z"),
      resourceExpiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })).toBe(true)
    expect(verifyDriveAccessCookie(cookie, {
      kind: "share",
      publicId: "shr_other",
      now: new Date("2026-06-10T00:00:00.000Z"),
      resourceExpiresAt: new Date("2026-06-16T00:00:00.000Z"),
      secret,
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive-access-protection.spec.ts
```

Expected: FAIL because `drive-access-protection.ts` does not exist.

- [ ] **Step 3: Add Prisma schema fields**

In `server/prisma/schema.prisma`, update `DriveShare`:

```prisma
model DriveShare {
  id                String    @id @default(cuid())
  shareId           String    @unique
  itemId            String
  item              DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  userId            String
  type              String    @db.VarChar(16)
  enabled           Boolean   @default(true)
  passwordEnabled   Boolean   @default(false)
  passwordHash      String?
  passwordEncrypted String?
  expiresAt         DateTime?
  createdAt         DateTime  @default(now())
  disabledAt        DateTime?

  @@index([itemId, enabled])
  @@index([userId, createdAt])
  @@index([enabled, passwordEnabled])
}
```

Update `DrivePublication`:

```prisma
model DrivePublication {
  id                  String                       @id @default(cuid())
  publishId           String                       @unique
  userId              String
  user                User                         @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceItemId         String?
  sourceItem           DriveItem?                  @relation(fields: [sourceItemId], references: [id], onDelete: SetNull)
  type                String                       @db.VarChar(16)
  name                String                       @db.VarChar(255)
  status              String                       @db.VarChar(32)
  passwordEnabled     Boolean                      @default(false)
  passwordHash        String?
  passwordEncrypted   String?
  expiresAt           DateTime?
  currentDeploymentId String?
  currentDeployment   DrivePublicationDeployment?  @relation("CurrentPublicationDeployment", fields: [currentDeploymentId, id], references: [id, publicationId], onDelete: NoAction)
  createdAt           DateTime                     @default(now())
  updatedAt           DateTime                     @updatedAt
  disabledAt          DateTime?
  deployments         DrivePublicationDeployment[] @relation("PublicationDeployments")
  assets              DrivePublicationAsset[]

  @@index([userId, createdAt])
  @@index([sourceItemId, status])
  @@index([status])
  @@index([status, passwordEnabled])
}
```

- [ ] **Step 4: Add SQL migration**

Create `server/prisma/migrations/20260609120000_drive_access_protection/migration.sql`:

```sql
ALTER TABLE "DriveShare"
  ADD COLUMN "passwordEncrypted" TEXT;

CREATE INDEX "DriveShare_enabled_passwordEnabled_idx"
  ON "DriveShare"("enabled", "passwordEnabled");

ALTER TABLE "DrivePublication"
  ADD COLUMN "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordEncrypted" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "DrivePublication_status_passwordEnabled_idx"
  ON "DrivePublication"("status", "passwordEnabled");
```

- [ ] **Step 5: Implement protection helper**

Create `server/src/drive/drive-access-protection.ts`:

```ts
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { hashPassword, verifyPassword } from "../auth/password"
import type { DriveAccessExpiresIn } from "@synapse/shared"

export type DriveAccessCookieKind = "share" | "page" | "site"

const readableAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
const cookieVersion = "v1"

export function generateDrivePassword(): string {
  const bytes = randomBytes(8)
  return Array.from(bytes, (byte) => readableAlphabet[byte % readableAlphabet.length]).join("")
}

export function computeDriveAccessExpiresAt(expiresIn: DriveAccessExpiresIn, now = new Date()): Date | null {
  if (expiresIn === "forever") return null
  const days = expiresIn === "7d" ? 7 : expiresIn === "30d" ? 30 : 365
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

export function encryptDrivePassword(password: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [cookieVersion, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function decryptDrivePassword(value: string | null | undefined, secret: string): string | null {
  if (!value) return null
  const [version, ivText, tagText, encryptedText] = value.split(".")
  if (version !== cookieVersion || !ivText || !tagText || !encryptedText) return null
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivText, "base64url"))
    decipher.setAuthTag(Buffer.from(tagText, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}

export async function createDrivePasswordMaterial(
  input: { readonly passwordEnabled: boolean; readonly expiresIn: DriveAccessExpiresIn },
  secret: string,
  now = new Date(),
): Promise<{
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly passwordHash: string | null
  readonly passwordEncrypted: string | null
  readonly expiresAt: Date | null
}> {
  const expiresAt = computeDriveAccessExpiresAt(input.expiresIn, now)
  if (!input.passwordEnabled) {
    return { passwordEnabled: false, password: null, passwordHash: null, passwordEncrypted: null, expiresAt }
  }
  const password = generateDrivePassword()
  return {
    passwordEnabled: true,
    password,
    passwordHash: await hashPassword(password),
    passwordEncrypted: encryptDrivePassword(password, secret),
    expiresAt,
  }
}

export function buildDriveAccessCookie(input: {
  readonly kind: DriveAccessCookieKind
  readonly publicId: string
  readonly expiresAt: Date | null
  readonly secret: string
}): string {
  const expiresMs = input.expiresAt?.getTime() ?? 0
  const payload = `${cookieVersion}|${input.kind}|${input.publicId}|${expiresMs}`
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload, input.secret)}`
}

export function verifyDriveAccessCookie(value: string | undefined, input: {
  readonly kind: DriveAccessCookieKind
  readonly publicId: string
  readonly now: Date
  readonly resourceExpiresAt: Date | null
  readonly secret: string
}): boolean {
  if (!value) return false
  const [payloadText, signature] = value.split(".")
  if (!payloadText || !signature) return false
  let payload: string
  try {
    payload = Buffer.from(payloadText, "base64url").toString("utf8")
  } catch {
    return false
  }
  if (!safeEqual(signature, sign(payload, input.secret))) return false
  const [version, kind, publicId, expiresMsText] = payload.split("|")
  if (version !== cookieVersion || kind !== input.kind || publicId !== input.publicId) return false
  const cookieExpiresMs = Number(expiresMsText)
  const resourceExpiresMs = input.resourceExpiresAt?.getTime() ?? 0
  const effectiveExpiresMs = resourceExpiresMs === 0 ? cookieExpiresMs : cookieExpiresMs === 0 ? resourceExpiresMs : Math.min(cookieExpiresMs, resourceExpiresMs)
  return effectiveExpiresMs === 0 || effectiveExpiresMs > input.now.getTime()
}

export async function verifyDrivePasswordInput(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !password) return false
  return verifyPassword(password, hash)
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`synapse-drive-access:${secret}`).digest()
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret)).update(payload).digest("base64url")
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive-access-protection.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit database and helper changes**

Run:

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260609120000_drive_access_protection/migration.sql server/src/drive/drive-access-protection.ts server/src/drive/drive-access-protection.spec.ts
git commit -m "feat(server): add drive access protection primitives"
```

Expected: commit succeeds.

---

### Task 3: Drive Service Creation, Listing, and Legacy Backfill

**Files:**
- Modify: `server/src/drive/drive.types.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Add focused tests to `server/src/drive/drive.service.spec.ts` near existing share/publication tests:

```ts
it("creates password-protected share links by default", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const file = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })

  const share = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "7d" })

  expect(share.passwordEnabled).toBe(true)
  expect(share.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/u)
  expect(share.urlWithPassword).toBe(`${share.url}?password=${share.password}`)
  expect(share.expiresAt).not.toBeNull()
  const stored = await prisma.driveShare.findUniqueOrThrow({ where: { id: share.id } })
  expect(stored.passwordHash).toEqual(expect.any(String))
  expect(stored.passwordEncrypted).toEqual(expect.any(String))
})

it("overwrites active share settings without changing the share id", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const file = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const first = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "7d" })

  const second = await service.createShare("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "30d" })

  expect(second.id).toBe(first.id)
  expect(second.shareId).toBe(first.shareId)
  expect(second.password).not.toBe(first.password)
})

it("preserves publication protection during redeploy", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const file = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.html", mimeType: "text/html" })
  const first = await service.publishPage("user-1", file.id, "https://synapse.test", { passwordEnabled: true, expiresIn: "7d" })

  const redeployed = await service.redeployPublication("user-1", first.id, "https://synapse.test")

  expect(redeployed.password).toBe(first.password)
  expect(redeployed.expiresAt).toBe(first.expiresAt)
  expect(redeployed.urlWithPassword).toBe(first.urlWithPassword)
})

it("backfills legacy active shares and publications once", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const file = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.html", mimeType: "text/html" })
  const share = await prisma.driveShare.create({ data: { itemId: file.id, userId: "user-1", type: "file", shareId: "shr_legacy" } })
  const publication = await prisma.drivePublication.create({ data: { userId: "user-1", sourceItemId: file.id, type: "page", name: "report.html", status: "active", publishId: "pub_legacy" } })

  const first = await service.backfillLegacyDriveAccessProtection(new Date("2026-06-09T00:00:00.000Z"))
  const afterFirstShare = await prisma.driveShare.findUniqueOrThrow({ where: { id: share.id } })
  const afterFirstPublication = await prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } })
  const second = await service.backfillLegacyDriveAccessProtection(new Date("2026-06-10T00:00:00.000Z"))

  expect(first).toEqual({ shares: 1, publications: 1 })
  expect(second).toEqual({ shares: 0, publications: 0 })
  expect(afterFirstShare.passwordEnabled).toBe(true)
  expect(afterFirstPublication.passwordEnabled).toBe(true)
  expect(afterFirstShare.expiresAt?.toISOString()).toBe("2026-06-16T00:00:00.000Z")
  expect(afterFirstPublication.expiresAt?.toISOString()).toBe("2026-06-16T00:00:00.000Z")
})
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts
```

Expected: FAIL because service signatures and Prisma memory rows do not expose the new fields.

- [ ] **Step 3: Extend DTO conversion**

In `server/src/drive/drive.types.ts`, extend `DrivePublicationRecord` with:

```ts
passwordEnabled: boolean
passwordHash?: string | null
passwordEncrypted?: string | null
expiresAt?: Date | null
```

Change `toDrivePublicationDto` signature:

```ts
export function toDrivePublicationDto(
  item: DrivePublicationRecord,
  publicAppUrl: string,
  password: string | null = null,
): DrivePublicationDto {
  const type = item.type === "site" ? "site" : "page"
  const url = buildDrivePublicationUrl({ publicAppUrl, publishId: item.publishId, type })
  return {
    id: item.id,
    publishId: item.publishId,
    type,
    name: item.name,
    status: item.status === "disabled" ? "disabled" : "active",
    sourceItemId: item.sourceItemId,
    sourceDeleted: item.sourceItem?.deletedAt !== null && item.sourceItem?.deletedAt !== undefined,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, item.passwordEnabled ? password : null),
    passwordEnabled: item.passwordEnabled,
    password: item.passwordEnabled ? password : null,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    currentDeploymentId: item.currentDeploymentId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 4: Update service signatures and protection writes**

In `server/src/drive/drive.service.ts` import:

```ts
import { OnApplicationBootstrap } from "@nestjs/common"
import { buildDriveUrlWithPassword, DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessSettingsInput } from "@synapse/shared"
import { loadEnv } from "../config/env"
import {
  createDrivePasswordMaterial,
  decryptDrivePassword,
} from "./drive-access-protection"
```

Make the class implement `OnApplicationBootstrap`:

```ts
export class DriveService implements OnApplicationBootstrap {
  private readonly accessSecret = loadEnv(process.env).userAccessJwtSecret

  async onApplicationBootstrap(): Promise<void> {
    await this.backfillLegacyDriveAccessProtection()
  }
}
```

Change share signature and use default settings:

```ts
async createShare(
  userId: string,
  itemId: string,
  publicAppUrl: string,
  settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
): Promise<DriveShareDto> {
  const item = await this.requireOwnedItem(userId, itemId)
  const material = await createDrivePasswordMaterial(settings, this.accessSecret)
  const existing = await this.prisma.driveShare.findFirst({
    where: { itemId: item.id, userId, enabled: true },
  })
  const share = existing
    ? await this.prisma.driveShare.update({
        where: { id: existing.id },
        data: {
          passwordEnabled: material.passwordEnabled,
          passwordHash: material.passwordHash,
          passwordEncrypted: material.passwordEncrypted,
          expiresAt: material.expiresAt,
        },
      })
    : await this.createUniqueShare(item.id, userId, item.type, material)
  return toDriveShareDto(share, publicAppUrl, material.password)
}
```

Adjust `createUniqueShare` to accept material:

```ts
private async createUniqueShare(
  itemId: string,
  userId: string,
  type: string,
  material: {
    readonly passwordEnabled: boolean
    readonly passwordHash: string | null
    readonly passwordEncrypted: string | null
    readonly expiresAt: Date | null
  },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await this.prisma.driveShare.create({
        data: { itemId, userId, type, shareId: createDriveShareId(), ...material },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }
  throw new Error("Unable to create unique drive share id.")
}
```

Change publish signatures:

```ts
async publishPage(
  userId: string,
  itemId: string,
  publicAppUrl: string,
  settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
): Promise<DrivePublicationDto>

async publishSite(
  userId: string,
  itemId: string,
  publicAppUrl: string,
  settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
): Promise<DrivePublicationDto>
```

Change `findOrCreatePublication` to accept material and overwrite existing active publication settings before deployment:

```ts
private async findOrCreatePublication(
  userId: string,
  sourceItemId: string,
  type: string,
  name: string,
  material: {
    readonly passwordEnabled: boolean
    readonly passwordHash: string | null
    readonly passwordEncrypted: string | null
    readonly expiresAt: Date | null
  },
): Promise<DrivePublicationRecord> {
  const activeSourceWhere = { userId, sourceItemId, type, status: DRIVE_PUBLICATION_STATUS.active }
  const existing = await this.prisma.drivePublication.findFirst({ where: activeSourceWhere })
  if (existing) {
    return this.prisma.drivePublication.update({ where: { id: existing.id }, data: material })
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await this.prisma.drivePublication.create({
        data: { userId, sourceItemId, type, name, status: DRIVE_PUBLICATION_STATUS.active, publishId: createDrivePublishId(), ...material },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const racedPublication = await this.prisma.drivePublication.findFirst({ where: activeSourceWhere })
      if (racedPublication) return this.prisma.drivePublication.update({ where: { id: racedPublication.id }, data: material })
    }
  }
  throw new Error("Unable to create unique drive publish id.")
}
```

When `createDeploymentFromAssets` returns DTO, decrypt from updated row:

```ts
return toDrivePublicationDto(updated, publicAppUrl, this.decryptStoredPassword(updated.passwordEncrypted))
```

Add helper:

```ts
private decryptStoredPassword(value: string | null | undefined): string | null {
  return decryptDrivePassword(value, this.accessSecret)
}
```

Update `toDriveShareDto`:

```ts
function toDriveShareDto(
  share: {
    id: string
    shareId: string
    itemId: string
    enabled: boolean
    passwordEnabled: boolean
    expiresAt?: Date | null
    createdAt: Date
  },
  publicAppUrl: string,
  password: string | null,
): DriveShareDto {
  const url = buildDriveShareUrl({ publicAppUrl, shareId: share.shareId })
  return {
    id: share.id,
    shareId: share.shareId,
    itemId: share.itemId,
    enabled: share.enabled,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, share.passwordEnabled ? password : null),
    passwordEnabled: share.passwordEnabled,
    password: share.passwordEnabled ? password : null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
  }
}
```

Update `listShares` and `listPublications` to decrypt readable passwords and return `urlWithPassword`.

- [ ] **Step 5: Implement idempotent legacy backfill**

Add this public method to `DriveService`:

```ts
async backfillLegacyDriveAccessProtection(now = new Date()): Promise<{ readonly shares: number; readonly publications: number }> {
  const legacyShares = await this.prisma.driveShare.findMany({
    where: { enabled: true, passwordEnabled: false, passwordHash: null },
    select: { id: true },
  })
  const legacyPublications = await this.prisma.drivePublication.findMany({
    where: { status: DRIVE_PUBLICATION_STATUS.active, passwordEnabled: false, passwordHash: null },
    select: { id: true },
  })
  for (const share of legacyShares) {
    const material = await createDrivePasswordMaterial({ passwordEnabled: true, expiresIn: "7d" }, this.accessSecret, now)
    await this.prisma.driveShare.update({
      where: { id: share.id },
      data: {
        passwordEnabled: true,
        passwordHash: material.passwordHash,
        passwordEncrypted: material.passwordEncrypted,
        expiresAt: material.expiresAt,
      },
    })
  }
  for (const publication of legacyPublications) {
    const material = await createDrivePasswordMaterial({ passwordEnabled: true, expiresIn: "7d" }, this.accessSecret, now)
    await this.prisma.drivePublication.update({
      where: { id: publication.id },
      data: {
        passwordEnabled: true,
        passwordHash: material.passwordHash,
        passwordEncrypted: material.passwordEncrypted,
        expiresAt: material.expiresAt,
      },
    })
  }
  return { shares: legacyShares.length, publications: legacyPublications.length }
}
```

- [ ] **Step 6: Update Prisma memory test double**

In `createPrismaMemory()` share creation default, add:

```ts
const share = {
  id: id("share"),
  enabled: true,
  passwordEnabled: false,
  passwordHash: null,
  passwordEncrypted: null,
  expiresAt: null,
  disabledAt: null,
  createdAt: now(),
  ...data,
}
```

In publication creation default, add:

```ts
const publication = {
  id: id("publication"),
  currentDeploymentId: null,
  disabledAt: null,
  passwordEnabled: false,
  passwordHash: null,
  passwordEncrypted: null,
  expiresAt: null,
  createdAt: now(),
  updatedAt: now(),
  ...data,
}
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit service changes**

Run:

```bash
git add server/src/drive/drive.types.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(server): protect drive share and publication records"
```

Expected: commit succeeds.

---

### Task 4: Public Route Unlock and Server-Side Gating

**Files:**
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing public controller tests**

Add tests to `server/src/drive/drive.controller.spec.ts`:

```ts
// Add createShare: vi.fn() to the local drive mock object before these tests.

it("passes access settings through share and publish APIs", async () => {
  process.env.PAGES_PUBLIC_URL = "https://pages.example"
  process.env.APP_PUBLIC_URL = "https://app.example"
  const publication = createPublication()
  const share = {
    id: "share-row-1",
    shareId: "shr_public",
    itemId: "file-1",
    enabled: true,
    url: "https://app.example/files/shr_public",
    urlWithPassword: "https://app.example/files/shr_public?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-16T00:00:00.000Z",
    createdAt: "2026-06-09T00:00:00.000Z",
  }
  const moduleRef = await Test.createTestingModule({
    controllers: [DriveUserController],
    providers: [{ provide: DriveService, useValue: drive }],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: vi.fn((context) => {
      context.switchToHttp().getRequest().user = { id: "user-1" }
      return true
    }) })
    .compile()
  const userApp = moduleRef.createNestApplication()
  await userApp.init()
  try {
    drive.createShare.mockResolvedValue(share)
    drive.publishPage.mockResolvedValue(publication)

    await request(userApp.getHttpServer())
      .post("/api/drive/items/file-1/share")
      .send({ passwordEnabled: true, expiresIn: "30d" })
      .expect(201)
    await request(userApp.getHttpServer())
      .post("/api/drive/items/file-1/publications/page")
      .send({ passwordEnabled: true, expiresIn: "30d" })
      .expect(201)

    expect(drive.createShare).toHaveBeenCalledWith("user-1", "file-1", "https://app.example", { passwordEnabled: true, expiresIn: "30d" })
    expect(drive.publishPage).toHaveBeenCalledWith("user-1", "file-1", "https://pages.example", { passwordEnabled: true, expiresIn: "30d" })
  } finally {
    await userApp.close()
  }
})

it("renders password page without resource details for protected shares", async () => {
  drive.resolvePublicShare.mockResolvedValue({ access: "password_required" })

  const response = await request(app!.getHttpServer()).get("/files/shr_locked").expect(200)

  expect(response.text).toContain("drive-password-shell")
  expect(response.text).toContain("密码")
  expect(response.text).not.toContain("交接材料")
  expect(drive.listPublicFolderChildren).not.toHaveBeenCalled()
})

it("unlocks password query and redirects to a clean share URL", async () => {
  drive.resolvePublicShare.mockResolvedValue({ access: "unlocked", cookie: "cookie-value", cleanPath: "/files/shr_locked" })

  const response = await request(app!.getHttpServer()).get("/files/shr_locked?password=AbC234xy").expect(302)

  expect(response.headers.location).toBe("/files/shr_locked")
  expect(response.headers["set-cookie"][0]).toContain("synapse_drive_access=")
  expect(response.headers["set-cookie"][0]).toContain("HttpOnly")
})

it("does not serve protected site assets before unlock", async () => {
  drive.resolvePublishedAsset.mockResolvedValue({ access: "password_required", isHtmlEntry: false })

  const response = await request(app!.getHttpServer()).get("/sites/pub_locked/app.js").expect(403)

  expect(response.text).toBe("访问受限")
})
```

- [ ] **Step 2: Run controller tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: FAIL because controller still calls old signatures and service mocks do not expose protected access result shapes.

- [ ] **Step 3: Add public access result types and service methods**

In `server/src/drive/drive.service.ts`, replace direct public resolvers with access-aware methods:

```ts
type DrivePublicAccessResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly cookie?: string; readonly cleanPath?: string }
  | { readonly status: "password_required" }
  | { readonly status: "static_denied" }
```

Add query/cookie verification in `resolvePublicShareAccess`:

```ts
async resolvePublicShareAccess(input: {
  readonly shareId: string
  readonly password?: string
  readonly cookie?: string
  readonly now?: Date
}): Promise<DrivePublicAccessResult<{ readonly item: DriveItemDto; readonly ownerId: string; readonly storageKey: string | null; readonly type: "file" | "folder" }>> {
  const now = input.now ?? new Date()
  const share = await this.prisma.driveShare.findFirst({
    where: { shareId: input.shareId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    include: { item: { include: driveItemWithShares } },
  })
  if (!share || share.item.deletedAt || share.item.storageStatus !== DRIVE_STORAGE_STATUS.active) throw new NotFoundException("文件未找到")
  if (share.passwordEnabled) {
    const cookieOk = verifyDriveAccessCookie(input.cookie, { kind: "share", publicId: share.shareId, now, resourceExpiresAt: share.expiresAt, secret: this.accessSecret })
    const passwordOk = input.password ? await verifyDrivePasswordInput(input.password, share.passwordHash) : false
    if (!cookieOk && !passwordOk) return { status: "password_required" }
    const cookie = passwordOk ? buildDriveAccessCookie({ kind: "share", publicId: share.shareId, expiresAt: share.expiresAt, secret: this.accessSecret }) : undefined
    return { status: "ok", cookie, value: toPublicShareValue(share) }
  }
  return { status: "ok", value: toPublicShareValue(share) }
}
```

Add a similar `resolvePublishedAssetAccess(input)` that checks `DrivePublication.passwordEnabled` before reading deployment and asset rows. It must return:

- `status: "password_required"` for HTML entry paths.
- `status: "static_denied"` for protected static resources without a valid password/cookie.
- `status: "ok"` with stream asset when access is valid.

Keep existing download/list helpers internally calling `resolvePublicShareAccess(...)` with cookie/password inputs; do not leave any public helper that bypasses access.

- [ ] **Step 4: Add controller schemas and request body parsing**

In `server/src/drive/drive.controller.ts`, import defaults:

```ts
import { DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessSettingsInput } from "@synapse/shared"
```

Add schema:

```ts
const driveAccessSettingsSchema = z.object({
  passwordEnabled: z.boolean().optional(),
  expiresIn: z.enum(["7d", "30d", "1y", "forever"]).optional(),
}).strict()

function parseAccessSettings(body: unknown): DriveAccessSettingsInput {
  if (body === undefined || body === null || (isRecord(body) && Object.keys(body).length === 0)) {
    return DRIVE_DEFAULT_ACCESS_SETTINGS
  }
  const parsed = parseBody(driveAccessSettingsSchema, body, "访问设置无效。")
  return {
    passwordEnabled: parsed.passwordEnabled ?? DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled,
    expiresIn: parsed.expiresIn ?? DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
  }
}
```

Change user routes:

```ts
@Post("/items/:id/share")
createShare(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  return this.drive.createShare(request.user!.id, id, resolveRequestPublicAppUrl(request), parseAccessSettings(body))
}

@Post("/items/:id/publications/page")
publishPage(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  return this.drive.publishPage(request.user!.id, id, resolveRequestPagesPublicUrl(request), parseAccessSettings(body))
}

@Post("/items/:id/publications/site")
publishSite(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  return this.drive.publishSite(request.user!.id, id, resolveRequestPagesPublicUrl(request), parseAccessSettings(body))
}
```

- [ ] **Step 5: Implement public unlock response helpers**

Add constants and helpers in `drive.controller.ts`:

```ts
const driveAccessCookieName = "synapse_drive_access"

function readPasswordQuery(request: Request): string | undefined {
  const value = request.query.password
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readDriveAccessCookie(request: Request): string | undefined {
  const value = request.cookies?.[driveAccessCookieName]
  return typeof value === "string" ? value : undefined
}

function setDriveAccessCookie(response: Response, value: string): void {
  response.cookie(driveAccessCookieName, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  })
}

function redirectClean(response: Response, request: Request): void {
  const url = new URL(request.originalUrl, "https://synapse.local")
  url.searchParams.delete("password")
  response.redirect(302, `${url.pathname}${url.search}`)
}
```

Add password page renderer:

```ts
function renderDrivePasswordPage(input: { readonly actionPath: string; readonly error?: boolean }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>输入密码</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#111}
.drive-password-shell{width:min(360px,calc(100vw - 32px));display:grid;gap:12px}
label{font-size:14px;font-weight:600}
input{height:36px;border:1px solid #d4d4d4;border-radius:8px;padding:0 10px;font-size:14px}
button{height:36px;border:0;border-radius:8px;background:#111;color:#fff;font-size:14px}
p{margin:0;color:#b91c1c;font-size:13px}
</style>
</head>
<body>
<form class="drive-password-shell" method="post" action="${escapeHtml(input.actionPath)}">
<label for="password">密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus>
${input.error ? "<p>密码错误</p>" : ""}
<button type="submit">确定</button>
</form>
</body>
</html>`
}
```

The inline CSS here is server-rendered public HTML, not desktop renderer UI, and is isolated from project shadcn rules.

- [ ] **Step 6: Wire public share routes**

Change `openShare`:

```ts
@Get("/files/:shareId")
async openShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
  const access = await this.drive.resolvePublicShareAccess({
    shareId,
    password: readPasswordQuery(request),
    cookie: readDriveAccessCookie(request),
  })
  if (access.status === "password_required") {
    response.type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
    return
  }
  if (access.cookie) {
    setDriveAccessCookie(response, access.cookie)
    redirectClean(response, request)
    return
  }
  if (access.value.type === "file") {
    response.type("html").send(renderPublicFilePage(shareId, access.value.item))
    return
  }
  const folder = await this.drive.listPublicFolderChildren({ shareId, cookie: readDriveAccessCookie(request) })
  response.type("html").send(renderPublicFolderPage(shareId, folder))
}
```

Add POST unlock routes for shares and publications. The POST route reads `request.body.password` from urlencoded body and reuses the same access method; on success set cookie and redirect clean, on failure render password page with error.

Update download routes to pass `cookie` and `password` from request:

```ts
const download = await this.drive.createDownloadUrlForShare({ shareId, cookie: readDriveAccessCookie(request), password: readPasswordQuery(request) })
```

- [ ] **Step 7: Wire public publication routes**

Change `sendPublishedAsset` to accept request:

```ts
private async sendPublishedAsset(response: Response, request: Request, input: {
  readonly publishId: string
  readonly type: "page" | "site"
  readonly relativePath: string
}): Promise<void> {
  try {
    const asset = await this.drive.resolvePublishedAssetAccess({
      ...input,
      password: readPasswordQuery(request),
      cookie: readDriveAccessCookie(request),
    })
    if (asset.status === "password_required") {
      response.type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
      return
    }
    if (asset.status === "static_denied") {
      response.status(403).type("text/plain").send("访问受限")
      return
    }
    if (asset.cookie) {
      setDriveAccessCookie(response, asset.cookie)
      redirectClean(response, request)
      return
    }
    await sendPublishedAsset(response, asset.value)
  } catch (error) {
    if (response.headersSent) {
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
      return
    }
    if (response.destroyed) return
    sendPublicNotFound(response)
  }
}
```

Update all `openPublished*` methods to pass `request`.

- [ ] **Step 8: Add file landing page renderer**

Add `renderPublicFilePage(shareId, item)` near `renderPublicFolderPage`:

```ts
function renderPublicFilePage(shareId: string, item: DriveItemDto): string {
  const escapedName = escapeHtml(item.name)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedName}</title>
</head>
<body>
<main class="drive-share-shell">
<h1>${escapedName}</h1>
<p>${formatPublicFileSize(item.size)}</p>
<a href="./${encodeURIComponent(shareId)}/download">下载</a>
</main>
</body>
</html>`
}
```

Reuse existing folder page CSS if practical; keep public page text minimal.

- [ ] **Step 9: Run controller tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit public route changes**

Run:

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(server): gate public drive access with passwords"
```

Expected: commit succeeds.

---

### Task 5: Desktop Bridge and Account Service

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: Write failing Electron bridge tests**

In `desktop/electron/services/__tests__/account-service.test.ts`, add:

```ts
it("sends drive access settings and rewrites protected public URLs", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const share = {
    id: "share-row-1",
    shareId: "shr_public",
    itemId: "file-1",
    enabled: true,
    url: "https://server.example/files/shr_public",
    urlWithPassword: "https://server.example/files/shr_public?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-16T00:00:00.000Z",
    createdAt: "2026-06-09T00:00:00.000Z",
  }
  const { namespace, service } = await createTestAccountService({
    fetch: (async (url, init) => {
      const method = init?.method ?? "GET"
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (String(url).endsWith("/auth/desktop/token")) return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
      if (String(url).endsWith("/auth/me")) return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      if (String(url).endsWith("/drive/items/file-1/share")) return jsonResponse(share)
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await service.startLogin()
  const attempt = (await namespace.getSingleton())?.activeAttempt
  expect(attempt).toBeTruthy()
  await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

  const result = await service.shareDriveItem("file-1", { passwordEnabled: true, expiresIn: "30d" })

  expect(calls).toContainEqual({
    url: expectedApiUrl("/drive/items/file-1/share"),
    method: "POST",
    body: { passwordEnabled: true, expiresIn: "30d" },
  })
  expect(result.url).toBe("https://synapse.d2.pub/files/shr_public")
  expect(result.urlWithPassword).toBe("https://synapse.d2.pub/files/shr_public?password=AbC234xy")
})
```

In `desktop/electron/modules/account/__tests__/ipc.test.ts`, add:

```ts
// Change the vi.mock accountService entry from `shareDriveItem: async () => ({})`
// to `shareDriveItem: vi.fn(async () => ({}))` before adding this test.

it("passes drive share access settings through IPC", async () => {
  const shareDriveItem = vi.fn().mockResolvedValue({
    id: "share-row-1",
    shareId: "shr_public",
    itemId: "file-1",
    enabled: true,
    url: "https://synapse.test/files/shr_public",
    urlWithPassword: "https://synapse.test/files/shr_public?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-16T00:00:00.000Z",
    createdAt: "2026-06-09T00:00:00.000Z",
  })
  vi.mocked(accountService.shareDriveItem).mockImplementation(shareDriveItem)
  const ctx: IpcHandlerContext = {
    moduleId: "account",
    resolve: ((id: string) => {
      throw new Error(`unexpected service ${id}`)
    }) as IpcHandlerContext["resolve"],
  }

  await accountIpcModule.methods.shareDriveItem.handler(ctx, { itemId: "file-1", passwordEnabled: true, expiresIn: "30d" })

  expect(shareDriveItem).toHaveBeenCalledWith("file-1", { passwordEnabled: true, expiresIn: "30d" })
})
```

- [ ] **Step 2: Run focused desktop tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- account-service.test.ts account/ipc.test.ts
```

Expected: FAIL because bridge signatures and schemas do not accept access settings.

- [ ] **Step 3: Update bridge types**

In `desktop/src/types/bridge.ts`, import `DriveAccessSettingsInput` from `@synapse/shared` and change signatures:

```ts
shareDriveItem: (input: { itemId: string } & DriveAccessSettingsInput) => Promise<DriveShareDto>
publishDrivePage: (input: { itemId: string } & DriveAccessSettingsInput) => Promise<DrivePublicationDto>
publishDriveSite: (input: { itemId: string } & DriveAccessSettingsInput) => Promise<DrivePublicationDto>
```

- [ ] **Step 4: Update IPC schemas and handlers**

In `desktop/electron/modules/account/ipc.ts`, extend DTO schemas with protection fields:

```ts
const driveAccessSettingsSchema = z.object({
  passwordEnabled: z.boolean(),
  expiresIn: z.enum(["7d", "30d", "1y", "forever"]),
})

const driveShareRequestSchema = driveItemIdSchema.extend(driveAccessSettingsSchema.shape)
const drivePublicationRequestSchema = driveItemIdSchema.extend(driveAccessSettingsSchema.shape)
```

Extend response schemas:

```ts
const driveShareSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  itemId: z.string(),
  enabled: z.boolean(),
  url: z.string(),
  urlWithPassword: z.string(),
  passwordEnabled: z.boolean(),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
})
```

Extend `drivePublicationSchema` and `driveShareListItemSchema` with the same protection fields.

Update handler calls:

```ts
const parsed = driveShareRequestSchema.parse(input)
return accountService.shareDriveItem(parsed.itemId, {
  passwordEnabled: parsed.passwordEnabled,
  expiresIn: parsed.expiresIn,
})
```

- [ ] **Step 5: Update account service request bodies and URL rewriting**

In `desktop/electron/services/account-service.ts`, change signatures:

```ts
async shareDriveItem(itemId: string, settings: DriveAccessSettingsInput): Promise<DriveShareDto> {
  const share = await this.requestAuthenticatedJson<DriveShareDto>(
    "POST",
    `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/share`,
    settings,
    "分享失败。",
  )
  return withCurrentDriveShareUrl(share)
}
```

Change publish methods similarly.

Update `withCurrentDriveShareUrl`:

```ts
async function withCurrentDriveShareUrl<T extends { readonly shareId: string; readonly url: string; readonly urlWithPassword?: string; readonly password?: string | null }>(item: T): Promise<T> {
  const { buildDriveShareUrl, buildDriveUrlWithPassword } = await sharedUrlsPromise
  const url = buildDriveShareUrl({ publicAppUrl: publicAppUrl(), shareId: item.shareId })
  return {
    ...item,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, item.password ?? null),
  }
}
```

Update `withCurrentDrivePublicationUrl` similarly with `buildDrivePublicationUrl`.

- [ ] **Step 6: Run focused desktop bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- account-service.test.ts account/ipc.test.ts preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit bridge changes**

Run:

```bash
git add desktop/src/types/bridge.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts desktop/electron/preload.ts
git commit -m "feat(desktop): pass drive access settings through bridge"
```

Expected: commit succeeds.

---

### Task 6: Desktop Drive UI

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Update existing share/publish tests in `desktop/src/modules/drive/__tests__/drive-module.test.tsx`.

For share:

```ts
it("opens access settings before sharing a file", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
  ])
  await render(<DriveModule />)
  await flushAct()

  await clickButtonText("分享")

  expect(document.body.textContent).toContain("分享设置")
  expect(screen.getByRole("switch", { name: "需要密码" })).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("radio", { name: "7 天" })).toBeChecked()
  expect(mocks.shareDriveItem).not.toHaveBeenCalled()

  await clickButtonText("确定")

  expect(mocks.shareDriveItem).toHaveBeenCalledWith({ itemId: "file-1", passwordEnabled: true, expiresIn: "7d" })
})
```

For result dialog:

```ts
it("shows password and copies protected share links", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
  ])
  mocks.shareDriveItem.mockResolvedValue(createDriveShareDto({
    urlWithPassword: "https://synapse.test/files/shr_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-16T00:00:00.000Z",
  }))
  await render(<DriveModule />)
  await flushAct()

  await clickButtonText("分享")
  await clickButtonText("确定")

  expect(document.body.textContent).toContain("文件已分享")
  expect(document.body.textContent).toContain("密码")
  expect(screen.getByDisplayValue("AbC234xy")).toBeInTheDocument()
  expect(getShareUrlInput().value).toBe("https://synapse.test/files/shr_test?password=AbC234xy")

  await clickButtonText("复制密码")
  expect(mocks.writeClipboardText).toHaveBeenCalledWith("AbC234xy")
})
```

For management list:

```ts
it("shows share password metadata in the shares dialog", async () => {
  mocks.listDriveShares.mockResolvedValue([
    createDriveShare({
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-16T00:00:00.000Z",
      urlWithPassword: "https://synapse.test/files/shr_test?password=AbC234xy",
    }),
  ])
  await render(<DriveModule />)
  await flushAct()

  await clickButtonText("已分享")
  await flushAct()

  expect(document.body.textContent).toContain("密码")
  expect(document.body.textContent).toContain("到期时间")
  expect(document.body.textContent).toContain("AbC234xy")
  await clickButtonByLabel("复制密码 report.txt")
  expect(mocks.writeClipboardText).toHaveBeenCalledWith("AbC234xy")
  await clickButtonByLabel("复制 report.txt")
  expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/shr_test?password=AbC234xy")
})
```

- [ ] **Step 2: Run renderer tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-module.test.tsx
```

Expected: FAIL because settings dialog and protection columns do not exist.

- [ ] **Step 3: Add state and types**

In `desktop/src/modules/drive/index.tsx`, import shared defaults:

```ts
import { DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessExpiresIn, type DriveAccessSettingsInput } from "@synapse/shared"
```

Add state types:

```ts
type DriveAccessDialogTarget =
  | { readonly kind: "share"; readonly item: DriveItemDto }
  | { readonly kind: "page"; readonly item: DriveItemDto }
  | { readonly kind: "site"; readonly item: DriveItemDto }

type DrivePublicationSuccessState = Pick<DrivePublicationDto, "name" | "type" | "url" | "urlWithPassword" | "passwordEnabled" | "password" | "expiresAt">
type DriveShareSuccessState = Pick<DriveItemDto, "name" | "type"> & Pick<DriveShareDto, "url" | "urlWithPassword" | "passwordEnabled" | "password" | "expiresAt">
```

Add component state:

```ts
const [accessDialogTarget, setAccessDialogTarget] = useState<DriveAccessDialogTarget | null>(null)
```

- [ ] **Step 4: Replace immediate share/publish handlers with dialog open**

Change row action callbacks:

```ts
const handleShare = useCallback((item: DriveItemDto) => {
  setAccessDialogTarget({ kind: "share", item })
}, [])

const handlePublishPage = useCallback((item: DriveItemDto) => {
  setAccessDialogTarget({ kind: "page", item })
}, [])

const handlePublishSite = useCallback((item: DriveItemDto) => {
  setAccessDialogTarget({ kind: "site", item })
}, [])
```

Add confirm handler:

```ts
const confirmAccessDialog = useCallback(async (settings: DriveAccessSettingsInput) => {
  if (!accessDialogTarget) return
  setSubmitting(true)
  try {
    if (accessDialogTarget.kind === "share") {
      const share = await requireSynapseBridge().account.shareDriveItem({ itemId: accessDialogTarget.item.id, ...settings })
      setShareSuccess({ name: accessDialogTarget.item.name, type: accessDialogTarget.item.type, ...share })
      await copySharedUrlAfterShare(share.urlWithPassword)
    } else if (accessDialogTarget.kind === "page") {
      const publication = await requireSynapseBridge().account.publishDrivePage({ itemId: accessDialogTarget.item.id, ...settings })
      setPublicationSuccess(publication)
      await copyPublishedUrlAfterPublish(publication.urlWithPassword)
    } else {
      const publication = await requireSynapseBridge().account.publishDriveSite({ itemId: accessDialogTarget.item.id, ...settings })
      setPublicationSuccess(publication)
      await copyPublishedUrlAfterPublish(publication.urlWithPassword)
    }
    setAccessDialogTarget(null)
    await loadItems()
  } catch (rawError) {
    toast(errorMessage(rawError, accessDialogTarget.kind === "share" ? "分享失败" : accessDialogTarget.kind === "page" ? "发布网页失败" : "发布站点失败"))
  } finally {
    setSubmitting(false)
  }
}, [accessDialogTarget, loadItems])
```

- [ ] **Step 5: Add settings dialog component**

Add component:

```tsx
function DriveAccessSettingsDialog({
  target,
  submitting,
  onConfirm,
  onOpenChange,
}: {
  readonly target: DriveAccessDialogTarget | null
  readonly submitting: boolean
  readonly onConfirm: (settings: DriveAccessSettingsInput) => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [passwordEnabled, setPasswordEnabled] = useState(DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled)
  const [expiresIn, setExpiresIn] = useState<DriveAccessExpiresIn>(DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn)

  useEffect(() => {
    if (!target) return
    setPasswordEnabled(DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled)
    setExpiresIn(DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn)
  }, [target])

  if (!target) return null
  const title = target.kind === "share" ? "分享设置" : "发布设置"
  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <FormDialog
        title={title}
        description={target.item.name}
        onSubmit={(event) => {
          event.preventDefault()
          void onConfirm({ passwordEnabled, expiresIn })
        }}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>确定</Button>
          </>
        )}
      >
        <div className="grid gap-4">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            <span>需要密码</span>
            <Switch checked={passwordEnabled} onCheckedChange={setPasswordEnabled} aria-label="需要密码" />
          </label>
          <div className="grid gap-2">
            <Label>有效时长</Label>
            <RadioGroup value={expiresIn} onValueChange={(value) => setExpiresIn(value as DriveAccessExpiresIn)} className="grid grid-cols-4 gap-2">
              <DriveAccessDurationOption value="7d" label="7 天" />
              <DriveAccessDurationOption value="30d" label="30 天" />
              <DriveAccessDurationOption value="1y" label="1 年" />
              <DriveAccessDurationOption value="forever" label="永久" />
            </RadioGroup>
          </div>
        </div>
      </FormDialog>
    </Dialog>
  )
}
```

If `Switch` or `RadioGroup` are not present in `desktop/src/components/ui/`, use existing `Checkbox` and a shadcn-compatible `Select` already in the project. Do not add custom CSS or custom colors.

- [ ] **Step 6: Update success dialogs**

In `DrivePublicationSuccessDialog` and `DriveShareSuccessDialog`:

- Use `publication.urlWithPassword` / `share.urlWithPassword` for the input and copy/open actions.
- Show password field only when `passwordEnabled && password`.
- Add `复制密码` button when password exists.
- Show `到期时间` as plain text when `expiresAt` is not null.

Copy helper:

```ts
async function copyDrivePassword(password: string): Promise<void> {
  try {
    await requireSynapseBridge().clipboard.writeText(password)
    toast("密码已复制")
  } catch (rawError) {
    toast(errorMessage(rawError, "复制失败"))
  }
}
```

- [ ] **Step 7: Update management dialogs**

Change table headers:

```tsx
<TableHead className="w-28">密码</TableHead>
<TableHead className="w-40">到期时间</TableHead>
```

Render password:

```tsx
<TableCell>
  {item.passwordEnabled && item.password ? item.password : "无"}
</TableCell>
<TableCell className="text-muted-foreground">
  {item.expiresAt ? formatDriveDateTime(item.expiresAt) : "永久"}
</TableCell>
```

Update copy actions:

```tsx
onClick={() => { void copyDriveUrl(item.urlWithPassword) }}
```

Add copy password action:

```tsx
{item.passwordEnabled && item.password ? (
  <DriveIconAction
    label={`复制密码 ${item.itemName}`}
    tooltip="复制密码"
    onClick={() => { void copyDrivePassword(item.password!) }}
  >
    <KeyRound />
  </DriveIconAction>
) : null}
```

Use lucide `KeyRound`; import it with the existing icon list.

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer UI changes**

Run:

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): add password settings dialogs"
```

Expected: commit succeeds.

---

### Task 7: Release Notes and Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update pending release notes**

Under `## 新增功能`, add:

```md
- 云盘分享和网页/网站发布新增密码与有效期设置。新链接默认需要密码、7 天有效，分享管理和发布管理里可以查看密码并复制带密码链接。
```

- [ ] **Step 2: Run shared verification**

Run:

```bash
pnpm --filter @synapse/shared test
pnpm --filter @synapse/shared typecheck
```

Expected: both PASS.

- [ ] **Step 3: Run server verification**

Run:

```bash
pnpm --filter @synapse/server test
pnpm --filter @synapse/server typecheck
```

Expected: both PASS.

- [ ] **Step 4: Run desktop verification**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop test -- drive-module.test.tsx account-service.test.ts account/ipc.test.ts preload.test.ts
pnpm --filter @synapse/desktop typecheck
```

Expected: all PASS. If `check:ipc-codegen` reports generated changes, run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: generated IPC files are up to date and the check passes.

- [ ] **Step 5: Inspect sensitive output paths**

Run:

```bash
rg -n "password=AbC234xy|AbC234xy|passwordEncrypted|passwordHash" server/src desktop/src desktop/electron shared/src
```

Expected: test fixtures may contain `AbC234xy`; production log messages and UI error text must not contain raw generated passwords except creator-facing DTO/UI fields.

- [ ] **Step 6: Commit release notes and generated files**

Run:

```bash
git status --short
git add RELEASE_NOTES_PENDING.md desktop/electron/generated/ipc-channels.generated.ts
git commit -m "chore: document drive password protection"
```

Expected: commit succeeds. If `desktop/electron/generated/ipc-channels.generated.ts` did not change, `git add` reports no staged change for that path and the commit includes only release notes.

---

## Spec Coverage Self-Check

- Settings modal before file share, folder share, page publish, and site publish: Task 6.
- Default password enabled and 7-day expiration: Tasks 1, 2, 3, 6.
- System-generated 8-character readable passwords: Task 2.
- Overwrite current active link settings without changing URL: Task 3.
- Result dialog with link, password, copy/open/close: Task 6.
- Creator can view password later in management lists: Tasks 3, 5, 6.
- `?password=` auto-unlocks then redirects to clean URL: Task 4.
- HttpOnly cookie scoped to resource and expiration: Tasks 2 and 4.
- File and folder shares both use landing pages: Task 4.
- Download endpoints cannot bypass password: Task 4.
- Page/site HTML and static assets cannot bypass password: Task 4.
- Old active shares and publications become password-protected and 7 days valid: Task 3.
- Password query masking: Task 1.
- Release notes for user-visible change: Task 7.
