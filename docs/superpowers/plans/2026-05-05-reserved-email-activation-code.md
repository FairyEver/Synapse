# 激活码预绑定邮箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admin to optionally bind an email to an activation code at creation time, restricting redemption to that email only.

**Architecture:** Add `reservedEmail` nullable field to `ActivationCode` model. Insert a check in the redeem flow before the existing `boundAccountId` check. Extend admin API and frontend to support the new field.

**Tech Stack:** Prisma (schema + migration), NestJS (service + controller), Vitest (tests), React (admin frontend)

---

### Task 1: Schema Migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: migration file via `prisma migrate dev`

- [ ] **Step 1: Add reservedEmail field to schema**

In `server/prisma/schema.prisma`, add to the `ActivationCode` model after `boundAccount`:

```prisma
reservedEmail  String?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd server && npx prisma migrate dev --name add-reserved-email-to-activation-code
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(license): add reservedEmail field to ActivationCode schema"
```

---

### Task 2: Types and Error Code

**Files:**
- Modify: `server/src/licenses/license.types.ts`

- [ ] **Step 1: Add reserved_mismatch to ActivationAttemptOutcome**

In `server/src/licenses/license.types.ts`, update the `ActivationAttemptOutcome` type:

```typescript
export type ActivationAttemptOutcome =
  | "success"
  | "invalid_code"
  | "bound_conflict"
  | "reserved_mismatch"
  | "rate_limited"
  | "risk_locked"
  | "device_limit"
  | "blocked"
```

- [ ] **Step 2: Add ACTIVATION_RESERVED_MISMATCH to ActivationErrorCode**

In the same file, update `ActivationErrorCode`:

```typescript
export type ActivationErrorCode =
  | "ACTIVATION_RATE_LIMITED"
  | "ACTIVATION_RISK_LOCKED"
  | "ACTIVATION_INVALID"
  | "ACTIVATION_BOUND_CONFLICT"
  | "ACTIVATION_RESERVED_MISMATCH"
  | "ACTIVATION_DEVICE_LIMIT"
```

- [ ] **Step 3: Commit**

```bash
git add server/src/licenses/license.types.ts
git commit -m "feat(license): add reserved_mismatch error code and outcome type"
```

---

### Task 3: Redeem Logic — Tests

**Files:**
- Modify: `server/src/licenses/licenses.service.spec.ts`

- [ ] **Step 1: Write failing test — reserved email allows matching email**

Add to `server/src/licenses/licenses.service.spec.ts`:

```typescript
it("redeems a reserved-email activation code when the email matches", async () => {
  const pair = keys()
  const service = LicensesService.createInMemory({
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    keyId: "test",
    leaseDays: 7,
  })
  service.seedActivationCode({
    codeHash: hashActivationCode("ABCD-1234"),
    maxDevices: 1,
    reservedEmail: "allowed@example.com",
  })

  const result = await service.redeem({
    email: "ALLOWED@example.com",
    activationCode: "ABCD-1234",
    device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
    ...requestSource,
  })

  expect(result.email).toBe("allowed@example.com")
})
```

- [ ] **Step 2: Write failing test — reserved email rejects mismatched email**

```typescript
it("rejects redemption when email does not match reservedEmail", async () => {
  const pair = keys()
  const risk = {
    assertNotRateLimited: vi.fn(),
    recordAttempt: vi.fn(),
    evaluateCodeRisk: vi.fn(),
  }
  const service = LicensesService.createInMemory({
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    keyId: "test",
    leaseDays: 7,
  }, risk as never)
  service.seedActivationCode({
    codeHash: hashActivationCode("ABCD-1234"),
    maxDevices: 1,
    reservedEmail: "allowed@example.com",
  })

  await expect(service.redeem({
    email: "other@example.com",
    activationCode: "ABCD-1234",
    device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
    ...requestSource,
  })).rejects.toMatchObject({
    code: "ACTIVATION_RESERVED_MISMATCH",
  })

  expect(risk.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
    outcome: "reserved_mismatch",
  }))
  expect(risk.evaluateCodeRisk).toHaveBeenCalled()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && pnpm test -- src/licenses/licenses.service.spec.ts`

Expected: Both new tests FAIL (seedActivationCode doesn't accept `reservedEmail` yet, ActivationRecord doesn't have the field).

- [ ] **Step 4: Commit failing tests**

```bash
git add server/src/licenses/licenses.service.spec.ts
git commit -m "test(license): add reserved email redeem tests (red)"
```

---

### Task 4: Redeem Logic — Implementation

**Files:**
- Modify: `server/src/licenses/licenses.service.ts`

- [ ] **Step 1: Add reservedEmail to ActivationRecord interface**

In `server/src/licenses/licenses.service.ts`, update the `ActivationRecord` interface (around line 23):

```typescript
interface ActivationRecord {
  readonly id: string
  readonly codeHint?: string | null
  readonly codeHash: string
  status: ManagedStatus
  readonly maxDevices: number
  boundAccountId: string | null
  readonly expiresAt?: Date | null
  readonly reservedEmail?: string | null
  riskLockedAt?: Date | null
}
```

- [ ] **Step 2: Add reserved email check in redeem method**

In the `redeem` method, insert the following block after line 180 (after the `activation` validity check and before the `account` lookup at line 182). The check must go after we have the activation record but before we create/find the account:

Actually, looking at the flow more carefully: the `reservedEmail` check should go after we have both the activation AND the normalized email. The current flow normalizes email at line 156, finds activation at line 174, then finds/creates account at line 182. We should insert the check between finding the activation (line 180) and finding/creating the account (line 182):

```typescript
    if (activation.reservedEmail && normalizeEmail(request.email) !== activation.reservedEmail) {
      await this.recordRedeemAttempt(request, activation, "reserved_mismatch", "此激活码已分配给特定用户。")
      await this.evaluateActivationRisk(activation, codeHash)
      throw new ActivationError("ACTIVATION_RESERVED_MISMATCH", "此激活码已分配给特定用户。")
    }
```

Insert this block at line 181 (between the activation validity check ending at line 180 and the `findOrCreateAccount` call at line 182).

- [ ] **Step 3: Update seedActivationCode in InMemoryLicenseRepository**

Update the `seedActivationCode` method (around line 379) to accept and store `reservedEmail`:

```typescript
seedActivationCode(input: { codeHash: string; maxDevices: number; riskLockedAt?: Date | null; reservedEmail?: string | null }): void {
  this.activations.set(input.codeHash, {
    id: randomUUID(),
    codeHash: input.codeHash,
    status: "active",
    maxDevices: input.maxDevices,
    boundAccountId: null,
    riskLockedAt: input.riskLockedAt ?? null,
    reservedEmail: input.reservedEmail ?? null,
  })
}
```

Also update the public `seedActivationCode` method on `LicensesService` (around line 139):

```typescript
seedActivationCode(input: { codeHash: string; maxDevices: number; riskLockedAt?: Date | null; reservedEmail?: string | null }): void {
```

- [ ] **Step 4: Verify PrismaLicenseRepository.findActivationByHash**

`PrismaLicenseRepository.findActivationByHash` (line 493) uses `findUnique` without a `select` clause, so Prisma automatically returns all fields including the new `reservedEmail`. No code change needed — just verify the `ActivationRecord` interface update from Step 1 is compatible with the Prisma return type.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && pnpm test -- src/licenses/licenses.service.spec.ts`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/licenses/licenses.service.ts
git commit -m "feat(license): enforce reservedEmail check during redeem"
```

---

### Task 5: Admin Service — Create with reservedEmail

**Files:**
- Modify: `server/src/admin/admin.service.ts`

- [ ] **Step 1: Update createActivationCode input type**

Update the `createActivationCode` method signature (line 28):

```typescript
async createActivationCode(input: {
  maxDevices: number
  expiresAt?: string | null
  quantity?: number
  reservedEmail?: string | null
  reservedEmails?: string[] | null
}) {
```

- [ ] **Step 2: Add validation and email resolution logic**

At the top of `createActivationCode`, add validation:

```typescript
async createActivationCode(input: {
  maxDevices: number
  expiresAt?: string | null
  quantity?: number
  reservedEmail?: string | null
  reservedEmails?: string[] | null
}) {
  if (input.reservedEmail && input.reservedEmails) {
    throw new BadRequestException("reservedEmail 和 reservedEmails 不能同时使用。")
  }

  const quantity = input.reservedEmails?.length ?? input.quantity ?? 1

  if (input.reservedEmails && input.quantity && input.quantity !== input.reservedEmails.length) {
    throw new BadRequestException("reservedEmails 长度必须等于 quantity。")
  }

  const results: Array<{ id: string; code: string; maxDevices: number }> = []

  for (let index = 0; index < quantity; index += 1) {
    const email = input.reservedEmails
      ? input.reservedEmails[index]!.trim().toLowerCase()
      : input.reservedEmail?.trim().toLowerCase() ?? null
    results.push(await this.createSingleActivationCode({ ...input, reservedEmail: email }))
  }

  return results
}
```

- [ ] **Step 3: Update createSingleActivationCode to accept and store reservedEmail**

Update the private method signature and Prisma create call:

```typescript
private async createSingleActivationCode(input: {
  maxDevices: number
  expiresAt?: string | null
  reservedEmail?: string | null
}) {
  for (let attempt = 0; attempt < activationCodeCreateAttempts; attempt += 1) {
    const code = normalizeActivationCode(this.createActivationCodeValue())
    try {
      const activationCode = await this.prisma.activationCode.create({
        data: {
          codeHint: createActivationCodeHint(code),
          codeHash: hashActivationCode(code),
          maxDevices: input.maxDevices,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          reservedEmail: input.reservedEmail ?? null,
        },
      })
      return { id: activationCode.id, code, maxDevices: activationCode.maxDevices }
    } catch (error) {
      if (isActivationCodeCollision(error)) {
        continue
      }
      throw error
    }
  }

  throw new InternalServerErrorException("生成唯一激活码失败。")
}
```

- [ ] **Step 4: Update listActivationCodes select to include reservedEmail**

In `listActivationCodes` (around line 83), add `reservedEmail: true` to the select object:

```typescript
select: {
  id: true,
  codeHint: true,
  status: true,
  maxDevices: true,
  expiresAt: true,
  reservedEmail: true,
  boundAccountId: true,
  boundAccount: {
    select: {
      email: true,
    },
  },
  // ... rest unchanged
},
```

- [ ] **Step 5: Commit**

```bash
git add server/src/admin/admin.service.ts
git commit -m "feat(license): support reservedEmail in activation code creation"
```

---

### Task 6: Admin Controller — Schema Validation

**Files:**
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Update createActivationCodeSchema**

Replace the schema definition (line 10-14):

```typescript
const createActivationCodeSchema = z.object({
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
  quantity: z.number().int().positive().max(100).default(1),
  reservedEmail: z.string().email().nullable().optional(),
  reservedEmails: z.array(z.string().email()).max(100).nullable().optional(),
}).strict().refine(
  (data) => !(data.reservedEmail && data.reservedEmails),
  { message: "reservedEmail 和 reservedEmails 不能同时使用。" },
)
```

- [ ] **Step 2: Commit**

```bash
git add server/src/admin/admin.controller.ts
git commit -m "feat(license): add reservedEmail validation to admin controller"
```

---

### Task 7: Admin Frontend — API Types

**Files:**
- Modify: `server/admin/src/lib/api.ts`

- [ ] **Step 1: Add reservedEmail to ActivationCode interface**

In `server/admin/src/lib/api.ts`, add to the `ActivationCode` interface (after `boundAccount`):

```typescript
readonly reservedEmail: string | null
```

- [ ] **Step 2: Add reserved_mismatch to ActivationAttemptOutcome**

```typescript
export type ActivationAttemptOutcome =
  | "success"
  | "invalid_code"
  | "bound_conflict"
  | "reserved_mismatch"
  | "rate_limited"
  | "risk_locked"
  | "device_limit"
  | "blocked"
```

- [ ] **Step 3: Update createActivationCode input type**

Update the `createActivationCode` function signature:

```typescript
createActivationCode: (input: {
  maxDevices: number
  expiresAt: string | null
  quantity: number
  reservedEmail?: string | null
  reservedEmails?: string[] | null
}) =>
  request<CreatedActivationCode[]>("/admin/api/activation-codes", {
    method: "POST",
    body: JSON.stringify(input),
  }),
```

- [ ] **Step 4: Commit**

```bash
git add server/admin/src/lib/api.ts
git commit -m "feat(license): update admin frontend API types for reservedEmail"
```

---

### Task 8: Admin Frontend — Create Form

**Files:**
- Modify: `server/admin/src/pages/activation-codes-page.tsx`

- [ ] **Step 1: Add state for reserved email fields**

After the existing state declarations (around line 173), add:

```typescript
const [reservedEmailMode, setReservedEmailMode] = React.useState<"none" | "single" | "list">("none")
const [reservedEmail, setReservedEmail] = React.useState("")
const [reservedEmailList, setReservedEmailList] = React.useState("")
```

- [ ] **Step 2: Add reserved email section to the create form**

After the expiration section (after line 428, before the `formError` display), add:

```tsx
<div className="grid gap-2">
  <Label htmlFor="reserved-email-mode">预绑定邮箱</Label>
  <Select
    value={reservedEmailMode}
    onValueChange={(value) => setReservedEmailMode(value as "none" | "single" | "list")}
  >
    <SelectTrigger id="reserved-email-mode" className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem value="none">不绑定</SelectItem>
        <SelectItem value="single">统一邮箱</SelectItem>
        <SelectItem value="list">邮箱列表</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</div>
{reservedEmailMode === "single" ? (
  <div className="grid gap-2">
    <Label htmlFor="reserved-email">邮箱</Label>
    <Input
      id="reserved-email"
      type="email"
      placeholder="user@example.com"
      value={reservedEmail}
      onChange={(event) => setReservedEmail(event.target.value)}
      required
    />
  </div>
) : null}
{reservedEmailMode === "list" ? (
  <div className="grid gap-2">
    <Label htmlFor="reserved-email-list">邮箱列表（每行一个）</Label>
    <textarea
      id="reserved-email-list"
      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      placeholder={"user1@example.com\nuser2@example.com"}
      value={reservedEmailList}
      onChange={(event) => {
        setReservedEmailList(event.target.value)
        const lines = event.target.value.split("\n").filter((line) => line.trim())
        if (lines.length > 0) setQuantity(String(lines.length))
      }}
      required
    />
  </div>
) : null}
```

- [ ] **Step 3: Update createActivationCode submit handler**

In the `createActivationCode` function (around line 217), update the API call to include reserved email data:

```typescript
const reservedEmailPayload: { reservedEmail?: string; reservedEmails?: string[] } = {}
if (reservedEmailMode === "single" && reservedEmail.trim()) {
  reservedEmailPayload.reservedEmail = reservedEmail.trim()
} else if (reservedEmailMode === "list" && reservedEmailList.trim()) {
  reservedEmailPayload.reservedEmails = reservedEmailList
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

const result = await adminApi.createActivationCode({
  maxDevices: deviceCount,
  expiresAt: requestExpiresAt,
  quantity: activationCodeQuantity,
  ...reservedEmailPayload,
})
```

- [ ] **Step 4: Reset reserved email state after successful creation**

In the reset block after successful creation (around line 225), add:

```typescript
setReservedEmailMode("none")
setReservedEmail("")
setReservedEmailList("")
```

- [ ] **Step 5: Disable quantity input when in list mode**

For the `SliderNumberField` with id `"activation-code-quantity"`, conditionally disable it:

Wrap the quantity field to disable interaction when in list mode. The simplest approach: when `reservedEmailMode === "list"`, the quantity is driven by the email list length, so add a `disabled` visual indicator. Since `SliderNumberField` doesn't support disabled, wrap it in a div with `opacity-50 pointer-events-none` when in list mode:

```tsx
<div className={reservedEmailMode === "list" ? "opacity-50 pointer-events-none" : undefined}>
  <SliderNumberField
    id="activation-code-quantity"
    label="数量"
    value={quantity}
    inputMax={maxActivationCodeQuantity}
    sliderMax={maxQuantitySliderValue}
    onChange={setQuantity}
  />
</div>
```

- [ ] **Step 6: Commit**

```bash
git add server/admin/src/pages/activation-codes-page.tsx
git commit -m "feat(license): add reserved email fields to activation code create form"
```

---

### Task 9: Admin Frontend — List Display

**Files:**
- Modify: `server/admin/src/pages/activation-codes-page.tsx`

- [ ] **Step 1: Add reservedEmail column to table header**

In the `TableHeader` section (around line 550-558), add a new `TableHead` after the existing "邮箱" column:

```tsx
<TableHead>预绑定</TableHead>
```

- [ ] **Step 2: Add reservedEmail cell to table body**

In the `TableBody` row mapping (around line 578), add a new `TableCell` after the bound email cell:

```tsx
<TableCell>{item.reservedEmail ?? "—"}</TableCell>
```

- [ ] **Step 3: Commit**

```bash
git add server/admin/src/pages/activation-codes-page.tsx
git commit -m "feat(license): display reservedEmail column in activation codes list"
```

---

### Task 10: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all server tests**

Run: `cd server && pnpm test`

Expected: All tests pass.

- [ ] **Step 2: Run admin frontend tests (if any)**

Run: `cd server && pnpm test:admin`

Expected: All tests pass (or no tests exist for this page).

- [ ] **Step 3: Type check**

Run: `cd server && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Start dev server and verify UI**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

Verify in browser:
1. Navigate to admin activation codes page
2. Click "新建" — confirm the "预绑定邮箱" dropdown appears with three options
3. Select "统一邮箱" — confirm single email input appears
4. Select "邮箱列表" — confirm textarea appears and quantity auto-updates
5. Create a code with a reserved email — confirm it appears in the list "预绑定" column
6. Create a code without reserved email — confirm "—" in the column

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(license): address integration issues from reserved email feature"
```
