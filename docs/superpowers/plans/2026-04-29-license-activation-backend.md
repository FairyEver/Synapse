# License Activation Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first complete Synapse licensing loop: NestJS backend, PostgreSQL persistence, built-in shadcn admin UI, desktop activation gate, signed 7-day offline lease, and Docker local deployment.

**Architecture:** Add a new `server/` workspace package for NestJS + Prisma + an embedded Vite admin UI. Keep the desktop authorization logic in Electron main-process services with typed IPC and preload bridge methods; React renders activation state and does not own license validation. Persist desktop license state through DataRepository, not direct filesystem writes.

**Tech Stack:** pnpm workspace, NestJS, Prisma, PostgreSQL, Vite, React, shadcn/ui `sidebar-07`, Tailwind CSS, Vitest, Electron main process, TypeScript, Node crypto Ed25519 signatures.

---

## File Structure

### Workspace And Server

- Modify: `pnpm-workspace.yaml` — add `server`.
- Modify: `package.json` — add root `server:*` scripts.
- Create: `server/package.json` — package metadata, scripts, dependencies.
- Create: `server/tsconfig.json` — strict TypeScript for NestJS and shared server code.
- Create: `server/tsconfig.build.json` — build config excluding tests and admin source.
- Create: `server/vitest.config.ts` — server unit/integration test config.
- Create: `server/nest-cli.json` — Nest build entry.
- Create: `server/src/main.ts` — Nest bootstrap.
- Create: `server/src/app.module.ts` — root module.
- Create: `server/src/config/env.ts` — environment parsing and validation.
- Create: `server/src/config/env.spec.ts` — env validation tests.

### Database And Docker

- Create: `server/prisma/schema.prisma` — PostgreSQL schema for admin users, accounts, activation codes, licenses, devices, leases.
- Create: `server/src/prisma/prisma.module.ts` — Prisma module.
- Create: `server/src/prisma/prisma.service.ts` — Prisma lifecycle service.
- Create: `server/compose.yml` — local Docker Compose for server and postgres.
- Create: `server/Dockerfile` — production image for API and admin UI.
- Create: `server/.dockerignore` — Docker build exclusions.

### Server Licensing Domain

- Create: `server/src/licenses/hash.ts` — deterministic hash helpers for activation codes and device IDs.
- Create: `server/src/licenses/license-token.ts` — Ed25519 sign/verify helpers.
- Create: `server/src/licenses/license.types.ts` — request, response, status, token payload types.
- Create: `server/src/licenses/licenses.module.ts` — Nest module.
- Create: `server/src/licenses/licenses.service.ts` — activation redeem, renewal, status enforcement.
- Create: `server/src/licenses/licenses.controller.ts` — client API routes.
- Create: `server/src/licenses/licenses.service.spec.ts` — licensing service tests with a fake repository.
- Create: `server/src/licenses/license-token.spec.ts` — token tests.

### Server Admin

- Create: `server/src/admin-auth/admin-auth.module.ts` — admin auth module.
- Create: `server/src/admin-auth/admin-auth.service.ts` — password check, cookie/JWT issue, session verify.
- Create: `server/src/admin-auth/admin-auth.controller.ts` — login/logout routes.
- Create: `server/src/admin-auth/admin-auth.guard.ts` — admin guard.
- Create: `server/src/admin-auth/admin-auth.service.spec.ts` — auth tests.
- Create: `server/src/admin/admin.module.ts` — admin API module.
- Create: `server/src/admin/admin.controller.ts` — activation code, account, license, device admin routes.
- Create: `server/src/admin/admin.service.ts` — admin query/write service.
- Create: `server/src/admin/admin.service.spec.ts` — admin service tests.

### Server Admin UI

- Create: `server/admin/index.html` — Vite HTML entry.
- Create: `server/admin/vite.config.ts` — admin UI build config.
- Create: `server/admin/tsconfig.json` — admin UI TypeScript config.
- Create: `server/admin/components.json` — shadcn config using `radix-nova`, neutral tokens, lucide.
- Create: `server/admin/src/main.tsx` — admin React bootstrap.
- Create: `server/admin/src/App.tsx` — routes and page composition.
- Create: `server/admin/src/styles/globals.css` — shadcn generated theme tokens.
- Create: `server/admin/src/lib/api.ts` — centralized admin API client.
- Create: `server/admin/src/components/app-sidebar.tsx` — adapted from shadcn `sidebar-07`.
- Create: `server/admin/src/pages/login-page.tsx` — admin login.
- Create: `server/admin/src/pages/activation-codes-page.tsx` — activation code list and create dialog.
- Create: `server/admin/src/pages/accounts-page.tsx` — account/license list.
- Create: `server/admin/src/pages/account-detail-page.tsx` — device and lease view.
- Create: `server/admin/src/pages/devices-page.tsx` — device list and revoke action.
- Create: `server/admin/src/pages/system-page.tsx` — health/status.
- Create: `server/admin/src/pages/__tests__/login-page.test.tsx` — login page test.
- Create: `server/admin/src/pages/__tests__/activation-codes-page.test.tsx` — activation code page test.

### Desktop License Gate

- Create: `desktop/electron/runtime/data-repo/schemas/core-license.ts` — encrypted license namespace schema.
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts` — export/register license schema.
- Create: `desktop/electron/services/license/types.ts` — desktop license bridge and service types.
- Create: `desktop/electron/services/license/device-id.ts` — random device ID creation and hash helpers.
- Create: `desktop/electron/services/license/license-token.ts` — verify server-signed lease.
- Create: `desktop/electron/services/license/license-client.ts` — HTTP client for server license API.
- Create: `desktop/electron/services/license/license-service.ts` — desktop activation status, activation, renewal, local persistence.
- Create: `desktop/electron/services/license/index.ts` — service exports.
- Create: `desktop/electron/services/__tests__/license-service.test.ts` — desktop service tests.
- Modify: `desktop/electron/bootstrap/descriptors.ts` — add `core.license` descriptor.
- Modify: `desktop/electron/bootstrap/registry.ts` — register license descriptor.
- Create: `desktop/electron/modules/license/ipc.ts` — typed IPC module.
- Modify: `desktop/electron/bootstrap/ipc-registry.ts` — register license IPC.
- Modify: `desktop/scripts/generate-ipc.mjs` — add license IPC source.
- Modify: `desktop/electron/preload.ts` — expose `window.synapse.license`.
- Modify: `desktop/src/types/bridge.ts` — renderer bridge type.
- Create: `desktop/src/types/license.ts` — renderer license types.
- Create: `desktop/src/app-shell/license.tsx` — license provider and hook.
- Create: `desktop/src/app-shell/components/license-gate.tsx` — activation gate UI.
- Create: `desktop/src/app-shell/components/__tests__/license-gate.test.tsx` — activation gate test.
- Modify: `desktop/src/main.tsx` — wrap app in license provider.
- Modify: `desktop/src/App.tsx` — place license gate before repository and identity gates.

---

## Task 1: Workspace And Server Scaffold

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/tsconfig.build.json`
- Create: `server/vitest.config.ts`
- Create: `server/nest-cli.json`
- Create: `server/src/config/env.ts`
- Create: `server/src/config/env.spec.ts`
- Create: `server/src/app.module.ts`
- Create: `server/src/main.ts`

- [ ] **Step 1: Add failing env validation test**

Create `server/src/config/env.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { loadEnv } from "./env"

describe("loadEnv", () => {
  it("parses required production settings", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length",
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\\nkey\\n-----END PUBLIC KEY-----",
      LICENSE_KEY_ID: "local-dev-key",
      LICENSE_LEASE_DAYS: "7",
      PORT: "3000",
    })

    expect(env.port).toBe(3000)
    expect(env.licenseLeaseDays).toBe(7)
    expect(env.adminEmail).toBe("admin@d2.com")
  })

  it("rejects missing required settings", () => {
    expect(() => loadEnv({})).toThrow("DATABASE_URL")
  })
})
```

- [ ] **Step 2: Run test to verify scaffold is missing**

Run:

```bash
pnpm --filter @synapse/server test -- env.spec.ts
```

Expected: command fails because `@synapse/server` does not exist yet.

- [ ] **Step 3: Add workspace and root scripts**

Modify `pnpm-workspace.yaml`:

```yaml
packages:
  - desktop
  - website
  - server

onlyBuiltDependencies:
  - electron
```

Modify root `package.json` scripts:

```json
{
  "server:dev": "pnpm --filter @synapse/server run dev",
  "server:build": "pnpm --filter @synapse/server run build",
  "server:test": "pnpm --filter @synapse/server run test",
  "server:typecheck": "pnpm --filter @synapse/server run typecheck",
  "server:prisma:migrate": "pnpm --filter @synapse/server run prisma:migrate",
  "server:docker:up": "docker compose -f server/compose.yml up"
}
```

Keep the existing scripts unchanged and insert these keys alongside the current `desktop:*` and `website:*` scripts.

- [ ] **Step 4: Create server package and TypeScript config**

Create `server/package.json`:

```json
{
  "name": "@synapse/server",
  "private": true,
  "version": "0.1.0",
  "type": "commonjs",
  "scripts": {
    "dev": "nest start --watch",
    "build": "pnpm build:api && pnpm build:admin",
    "build:api": "nest build",
    "build:admin": "vite build --config admin/vite.config.ts",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:dev": "prisma migrate dev",
    "shadcn": "shadcn"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.9",
    "@nestjs/config": "^4.0.2",
    "@nestjs/core": "^11.1.9",
    "@nestjs/platform-express": "^11.1.9",
    "@nestjs/serve-static": "^5.0.4",
    "@prisma/client": "^6.19.0",
    "bcryptjs": "^3.0.3",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "cookie-parser": "^1.4.7",
    "lucide-react": "1.8.0",
    "radix-ui": "^1.4.3",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "tailwind-merge": "3.5.0",
    "tw-animate-css": "^1.4.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.12",
    "@nestjs/testing": "^11.1.9",
    "@tailwindcss/vite": "4.2.2",
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.10",
    "@types/express": "^5.0.5",
    "@types/node": "25.6.0",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.1",
    "jsdom": "^27.3.0",
    "prisma": "^6.19.0",
    "shadcn": "4.2.0",
    "supertest": "^7.1.4",
    "typescript": "6.0.2",
    "vite": "8.0.8",
    "vitest": "^4.1.5"
  }
}
```

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "admin/**/*.ts", "admin/**/*.tsx"],
  "exclude": ["dist", "admin-dist", "node_modules"]
}
```

Create `server/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts", "admin/**/*", "dist", "node_modules"]
}
```

- [ ] **Step 5: Add Nest and Vitest bootstrap files**

Create `server/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

Create `server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    globals: false,
  },
})
```

Create `server/src/config/env.ts`:

```ts
import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_JWT_SECRET: z.string().min(16),
  LICENSE_PRIVATE_KEY: z.string().min(1),
  LICENSE_PUBLIC_KEY: z.string().min(1),
  LICENSE_KEY_ID: z.string().min(1),
  LICENSE_LEASE_DAYS: z.coerce.number().int().positive().default(7),
  PORT: z.coerce.number().int().positive().default(3000),
})

export interface ServerEnv {
  readonly databaseUrl: string
  readonly adminEmail: string
  readonly adminPassword: string
  readonly adminJwtSecret: string
  readonly licensePrivateKey: string
  readonly licensePublicKey: string
  readonly licenseKeyId: string
  readonly licenseLeaseDays: number
  readonly port: number
}

export function loadEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`Invalid server environment: ${first?.path.join(".")}`)
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    adminEmail: result.data.ADMIN_EMAIL,
    adminPassword: result.data.ADMIN_PASSWORD,
    adminJwtSecret: result.data.ADMIN_JWT_SECRET,
    licensePrivateKey: result.data.LICENSE_PRIVATE_KEY,
    licensePublicKey: result.data.LICENSE_PUBLIC_KEY,
    licenseKeyId: result.data.LICENSE_KEY_ID,
    licenseLeaseDays: result.data.LICENSE_LEASE_DAYS,
    port: result.data.PORT,
  }
}
```

Create `server/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common"

@Module({})
export class AppModule {}
```

Create `server/src/main.ts`:

```ts
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import { AppModule } from "./app.module"
import { loadEnv } from "./config/env"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create(AppModule)
  app.use(cookieParser())
  await app.listen(env.port)
}

void bootstrap()
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
pnpm install
```

Expected: dependencies install and `pnpm-lock.yaml` updates.

- [ ] **Step 7: Verify env test passes**

Run:

```bash
pnpm --filter @synapse/server test -- env.spec.ts
```

Expected: `2 passed`.

- [ ] **Step 8: Verify typecheck**

Run:

```bash
pnpm --filter @synapse/server typecheck
```

Expected: typecheck passes for the NestJS scaffold.

- [ ] **Step 9: Commit scaffold**

Run:

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml server/package.json server/tsconfig.json server/tsconfig.build.json server/vitest.config.ts server/nest-cli.json server/src
git commit -m "feat(server): scaffold licensing backend"
```

Expected: commit succeeds.

## Task 2: Prisma Schema And Docker Runtime

**Files:**
- Create: `server/prisma/schema.prisma`
- Create: `server/src/prisma/prisma.module.ts`
- Create: `server/src/prisma/prisma.service.ts`
- Modify: `server/src/app.module.ts`
- Create: `server/compose.yml`
- Create: `server/Dockerfile`
- Create: `server/.dockerignore`

- [ ] **Step 1: Add Prisma schema**

Create `server/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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

enum AdminStatus {
  active
  disabled
}

model Account {
  id        String        @id @default(cuid())
  email     String        @unique
  status    AccountStatus @default(active)
  licenses  License[]
  codes     ActivationCode[]
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
}

model ActivationCode {
  id             String        @id @default(cuid())
  codeHash       String        @unique
  status         ManagedStatus @default(active)
  maxDevices     Int           @default(1)
  expiresAt      DateTime?
  boundAccountId String?
  boundAccount   Account?      @relation(fields: [boundAccountId], references: [id])
  redeemedAt     DateTime?
  license        License?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([boundAccountId])
}

model License {
  id               String         @id @default(cuid())
  accountId        String
  account          Account        @relation(fields: [accountId], references: [id])
  activationCodeId String         @unique
  activationCode   ActivationCode @relation(fields: [activationCodeId], references: [id])
  status           ManagedStatus  @default(active)
  maxDevices       Int            @default(1)
  expiresAt        DateTime?
  devices          Device[]
  leases           Lease[]
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  @@index([accountId])
}

model Device {
  id           String       @id @default(cuid())
  licenseId    String
  license      License      @relation(fields: [licenseId], references: [id])
  deviceIdHash String
  name         String
  platform     String
  appVersion   String
  status       DeviceStatus @default(active)
  firstSeenAt  DateTime     @default(now())
  lastSeenAt   DateTime     @default(now())
  leases       Lease[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@unique([licenseId, deviceIdHash])
  @@index([deviceIdHash])
}

model Lease {
  id             String   @id @default(cuid())
  licenseId      String
  license        License  @relation(fields: [licenseId], references: [id])
  deviceId       String
  device         Device   @relation(fields: [deviceId], references: [id])
  tokenId        String   @unique
  issuedAt       DateTime
  expiresAt      DateTime
  statusSnapshot Json
  createdAt      DateTime @default(now())

  @@index([licenseId])
  @@index([deviceId])
}

model AdminUser {
  id           String      @id @default(cuid())
  email        String      @unique
  passwordHash String
  status       AdminStatus @default(active)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}
```

- [ ] **Step 2: Add Prisma service**

Create `server/src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

Create `server/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from "@nestjs/common"
import { PrismaService } from "./prisma.service"

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Modify `server/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server prisma:generate
```

Expected: Prisma client is generated with no schema errors.

- [ ] **Step 4: Add Docker files**

Create `server/compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: synapse
      POSTGRES_DB: synapse
    ports:
      - "5432:5432"
    volumes:
      - synapse-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synapse -d synapse"]
      interval: 5s
      timeout: 5s
      retries: 10

  server:
    build:
      context: ..
      dockerfile: server/Dockerfile
    environment:
      DATABASE_URL: postgresql://synapse:synapse@postgres:5432/synapse
      ADMIN_EMAIL: admin@d2.com
      ADMIN_PASSWORD: admin@pwd
      ADMIN_JWT_SECRET: local-dev-admin-secret
      LICENSE_PRIVATE_KEY: ${LICENSE_PRIVATE_KEY}
      LICENSE_PUBLIC_KEY: ${LICENSE_PUBLIC_KEY}
      LICENSE_KEY_ID: local-dev-key
      LICENSE_LEASE_DAYS: "7"
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    command: sh -c "pnpm --filter @synapse/server prisma:migrate && pnpm --filter @synapse/server start"

volumes:
  synapse-postgres:
```

Create `server/Dockerfile`:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @synapse/server prisma:generate
RUN pnpm --filter @synapse/server build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/admin-dist server/admin-dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
EXPOSE 3000
CMD ["pnpm", "--filter", "@synapse/server", "start"]
```

Create `server/.dockerignore`:

```text
node_modules
dist
admin-dist
.DS_Store
*.log
```

- [ ] **Step 5: Verify migration can be created**

Run:

```bash
DATABASE_URL=postgresql://synapse:synapse@localhost:5432/synapse pnpm --filter @synapse/server prisma:dev -- --name init_license_schema
```

Expected: if PostgreSQL is not running, Prisma reports that it cannot reach the database. Start PostgreSQL with `docker compose -f server/compose.yml up postgres` and rerun; expected result after PostgreSQL is ready is a migration under `server/prisma/migrations/`.

- [ ] **Step 6: Commit database and Docker scaffold**

Run:

```bash
git add server/prisma server/src/prisma server/src/app.module.ts server/compose.yml server/Dockerfile server/.dockerignore
git commit -m "feat(server): add license database schema"
```

Expected: commit succeeds.

## Task 3: License Hashing And Token Signing

**Files:**
- Create: `server/src/licenses/hash.ts`
- Create: `server/src/licenses/license.types.ts`
- Create: `server/src/licenses/license-token.ts`
- Create: `server/src/licenses/license-token.spec.ts`
- Create: `server/src/licenses/licenses.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write token tests**

Create `server/src/licenses/license-token.spec.ts`:

```ts
import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import { hashDeviceId, hashActivationCode } from "./hash"
import { signLicenseLease, verifyLicenseLease } from "./license-token"
import type { LicenseLeasePayload } from "./license.types"

function keyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

describe("license token", () => {
  it("signs and verifies a lease payload", () => {
    const keys = keyPair()
    const payload: LicenseLeasePayload = {
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test-key",
    }

    const token = signLicenseLease(payload, keys.privateKey)
    expect(verifyLicenseLease(token, keys.publicKey)).toEqual(payload)
  })

  it("rejects a tampered token", () => {
    const keys = keyPair()
    const payload: LicenseLeasePayload = {
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2026-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test-key",
    }

    const token = signLicenseLease(payload, keys.privateKey)
    const tampered = token.replace("user", "root")

    expect(() => verifyLicenseLease(tampered, keys.publicKey)).toThrow("Invalid license signature")
  })

  it("normalizes activation code hashes", () => {
    expect(hashActivationCode(" ABCD-1234 ")).toBe(hashActivationCode("abcd-1234"))
  })
})
```

- [ ] **Step 2: Run token tests to verify missing implementation**

Run:

```bash
pnpm --filter @synapse/server test -- license-token.spec.ts
```

Expected: fails because `hash.ts`, `license-token.ts`, and `license.types.ts` do not exist.

- [ ] **Step 3: Add license types and hash helpers**

Create `server/src/licenses/license.types.ts`:

```ts
export type ManagedStatus = "active" | "disabled" | "revoked" | "expired"

export interface LicenseLeasePayload {
  readonly tokenId: string
  readonly accountId: string
  readonly email: string
  readonly licenseId: string
  readonly deviceIdHash: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly maxDevices: number
  readonly licenseStatus: ManagedStatus
  readonly keyId: string
}

export interface DeviceMetadata {
  readonly deviceId: string
  readonly name: string
  readonly platform: string
  readonly appVersion: string
}
```

Create `server/src/licenses/hash.ts`:

```ts
import { createHash } from "node:crypto"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase()
}

export function hashActivationCode(code: string): string {
  return sha256(normalizeActivationCode(code))
}

export function hashDeviceId(deviceId: string): string {
  return sha256(deviceId)
}
```

- [ ] **Step 4: Add Ed25519 token implementation**

Create `server/src/licenses/license-token.ts`:

```ts
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import type { LicenseLeasePayload } from "./license.types"

interface SignedLeaseEnvelope {
  readonly payload: LicenseLeasePayload
  readonly signature: string
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T
}

export function signLicenseLease(payload: LicenseLeasePayload, privateKeyPem: string): string {
  const encodedPayload = encode(payload)
  const signature = sign(null, Buffer.from(encodedPayload), createPrivateKey(privateKeyPem))
  const envelope: SignedLeaseEnvelope = {
    payload,
    signature: signature.toString("base64url"),
  }
  return encode(envelope)
}

export function verifyLicenseLease(token: string, publicKeyPem: string): LicenseLeasePayload {
  const envelope = decode<SignedLeaseEnvelope>(token)
  const encodedPayload = encode(envelope.payload)
  const valid = verify(
    null,
    Buffer.from(encodedPayload),
    createPublicKey(publicKeyPem),
    Buffer.from(envelope.signature, "base64url"),
  )

  if (!valid) {
    throw new Error("Invalid license signature")
  }

  return envelope.payload
}
```

- [ ] **Step 5: Add empty module and root import**

Create `server/src/licenses/licenses.module.ts`:

```ts
import { Module } from "@nestjs/common"

@Module({})
export class LicensesModule {}
```

Modify `server/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { PrismaModule } from "./prisma/prisma.module"
import { LicensesModule } from "./licenses/licenses.module"

@Module({
  imports: [PrismaModule, LicensesModule],
})
export class AppModule {}
```

- [ ] **Step 6: Run token tests**

Run:

```bash
pnpm --filter @synapse/server test -- license-token.spec.ts
```

Expected: `3 passed`.

- [ ] **Step 7: Commit token helpers**

Run:

```bash
git add server/src/licenses server/src/app.module.ts
git commit -m "feat(server): add license token signing"
```

Expected: commit succeeds.

## Task 4: Client Activation And Renewal API

**Files:**
- Create: `server/src/licenses/licenses.service.ts`
- Create: `server/src/licenses/licenses.controller.ts`
- Create: `server/src/licenses/licenses.service.spec.ts`
- Modify: `server/src/licenses/licenses.module.ts`

- [ ] **Step 1: Write service tests for activation and renewal**

Create `server/src/licenses/licenses.service.spec.ts` with focused tests for the domain rules:

```ts
import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import { LicensesService } from "./licenses.service"
import { hashActivationCode, hashDeviceId } from "./hash"

function keys() {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

describe("LicensesService", () => {
  it("redeems an unused activation code for one email and one device", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    const result = await service.redeem({
      email: "USER@example.com",
      activationCode: "abcd-1234",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    })

    expect(result.email).toBe("user@example.com")
    expect(result.leaseToken.length).toBeGreaterThan(20)
  })

  it("rejects a second email for a bound activation code", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "first@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
    })

    await expect(service.redeem({
      email: "second@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
    })).rejects.toThrow("Activation code is already bound")
  })

  it("rejects a second device when maxDevices is one", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })

    await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
    })

    await expect(service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-2", name: "ThinkPad", platform: "win32", appVersion: "0.2.54" },
    })).rejects.toThrow("Device limit reached")
  })

  it("renews a valid lease for the same active device", async () => {
    const pair = keys()
    const service = LicensesService.createInMemory({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      keyId: "test",
      leaseDays: 7,
    })
    service.seedActivationCode({ codeHash: hashActivationCode("ABCD-1234"), maxDevices: 1 })
    const redeemed = await service.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.54" },
    })

    const renewed = await service.renew({
      leaseToken: redeemed.leaseToken,
      device: { deviceId: "device-1", name: "MacBook", platform: "darwin", appVersion: "0.2.55" },
    })

    expect(renewed.deviceIdHash).toBe(hashDeviceId("device-1"))
    expect(renewed.leaseToken).not.toBe(redeemed.leaseToken)
  })
})
```

- [ ] **Step 2: Run service tests to verify missing service**

Run:

```bash
pnpm --filter @synapse/server test -- licenses.service.spec.ts
```

Expected: fails because `licenses.service.ts` does not exist.

- [ ] **Step 3: Implement minimal service behavior**

Create `server/src/licenses/licenses.service.ts` with production constructor and in-memory factory used by tests:

```ts
import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { hashActivationCode, hashDeviceId } from "./hash"
import { signLicenseLease, verifyLicenseLease } from "./license-token"
import type { DeviceMetadata, LicenseLeasePayload, ManagedStatus } from "./license.types"

interface LicenseSettings {
  readonly privateKey: string
  readonly publicKey: string
  readonly keyId: string
  readonly leaseDays: number
}

interface ActivationRecord {
  id: string
  codeHash: string
  status: ManagedStatus
  maxDevices: number
  boundAccountId: string | null
}

interface AccountRecord {
  id: string
  email: string
  status: "active" | "disabled"
}

interface LicenseRecord {
  id: string
  accountId: string
  activationCodeId: string
  status: ManagedStatus
  maxDevices: number
}

interface DeviceRecord {
  id: string
  licenseId: string
  deviceIdHash: string
  name: string
  platform: string
  appVersion: string
  status: "active" | "revoked"
}

interface RedeemRequest {
  readonly email: string
  readonly activationCode: string
  readonly device: DeviceMetadata
}

interface RenewRequest {
  readonly leaseToken: string
  readonly device: DeviceMetadata
}

interface LicenseResponse {
  readonly email: string
  readonly deviceIdHash: string
  readonly leaseToken: string
}

@Injectable()
export class LicensesService {
  private readonly activations = new Map<string, ActivationRecord>()
  private readonly accounts = new Map<string, AccountRecord>()
  private readonly licenses = new Map<string, LicenseRecord>()
  private readonly devices = new Map<string, DeviceRecord>()

  constructor(private readonly settings: LicenseSettings) {}

  static createInMemory(settings: LicenseSettings): LicensesService {
    return new LicensesService(settings)
  }

  seedActivationCode(input: { codeHash: string; maxDevices: number }): void {
    const id = randomUUID()
    this.activations.set(input.codeHash, {
      id,
      codeHash: input.codeHash,
      status: "active",
      maxDevices: input.maxDevices,
      boundAccountId: null,
    })
  }

  async redeem(request: RedeemRequest): Promise<LicenseResponse> {
    const email = request.email.trim().toLowerCase()
    const codeHash = hashActivationCode(request.activationCode)
    const activation = this.activations.get(codeHash)

    if (!activation || activation.status !== "active") {
      throw new Error("Activation code is invalid")
    }

    const account = this.findOrCreateAccount(email)
    if (activation.boundAccountId && activation.boundAccountId !== account.id) {
      throw new Error("Activation code is already bound")
    }
    activation.boundAccountId = account.id

    const license = this.findOrCreateLicense(account.id, activation)
    const device = this.findOrCreateDevice(license, request.device)
    const leaseToken = this.issueLease(account, license, device)

    return { email, deviceIdHash: device.deviceIdHash, leaseToken }
  }

  async renew(request: RenewRequest): Promise<LicenseResponse> {
    const payload = verifyLicenseLease(request.leaseToken, this.settings.publicKey)
    const deviceHash = hashDeviceId(request.device.deviceId)
    if (payload.deviceIdHash !== deviceHash) {
      throw new Error("Device mismatch")
    }

    const license = this.licenses.get(payload.licenseId)
    const account = this.accounts.get(payload.accountId)
    const device = [...this.devices.values()].find((item) =>
      item.licenseId === payload.licenseId && item.deviceIdHash === deviceHash,
    )

    if (!account || account.status !== "active") {
      throw new Error("Account is disabled")
    }
    if (!license || license.status !== "active") {
      throw new Error("License is not active")
    }
    if (!device || device.status !== "active") {
      throw new Error("Device is not active")
    }

    device.name = request.device.name
    device.platform = request.device.platform
    device.appVersion = request.device.appVersion

    return {
      email: account.email,
      deviceIdHash: device.deviceIdHash,
      leaseToken: this.issueLease(account, license, device),
    }
  }

  private findOrCreateAccount(email: string): AccountRecord {
    const existing = [...this.accounts.values()].find((account) => account.email === email)
    if (existing) return existing
    const account: AccountRecord = { id: randomUUID(), email, status: "active" }
    this.accounts.set(account.id, account)
    return account
  }

  private findOrCreateLicense(accountId: string, activation: ActivationRecord): LicenseRecord {
    const existing = [...this.licenses.values()].find((license) =>
      license.activationCodeId === activation.id,
    )
    if (existing) return existing
    const license: LicenseRecord = {
      id: randomUUID(),
      accountId,
      activationCodeId: activation.id,
      status: "active",
      maxDevices: activation.maxDevices,
    }
    this.licenses.set(license.id, license)
    return license
  }

  private findOrCreateDevice(license: LicenseRecord, metadata: DeviceMetadata): DeviceRecord {
    const deviceIdHash = hashDeviceId(metadata.deviceId)
    const devices = [...this.devices.values()].filter((device) => device.licenseId === license.id)
    const existing = devices.find((device) => device.deviceIdHash === deviceIdHash)
    if (existing) return existing
    const activeCount = devices.filter((device) => device.status === "active").length
    if (activeCount >= license.maxDevices) {
      throw new Error("Device limit reached")
    }
    const device: DeviceRecord = {
      id: randomUUID(),
      licenseId: license.id,
      deviceIdHash,
      name: metadata.name,
      platform: metadata.platform,
      appVersion: metadata.appVersion,
      status: "active",
    }
    this.devices.set(device.id, device)
    return device
  }

  private issueLease(account: AccountRecord, license: LicenseRecord, device: DeviceRecord): string {
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + this.settings.leaseDays * 24 * 60 * 60 * 1000)
    const payload: LicenseLeasePayload = {
      tokenId: randomUUID(),
      accountId: account.id,
      email: account.email,
      licenseId: license.id,
      deviceIdHash: device.deviceIdHash,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maxDevices: license.maxDevices,
      licenseStatus: license.status,
      keyId: this.settings.keyId,
    }
    return signLicenseLease(payload, this.settings.privateKey)
  }
}
```

- [ ] **Step 4: Add controller schemas and routes**

Create `server/src/licenses/licenses.controller.ts`:

```ts
import { Body, Controller, Get, Post } from "@nestjs/common"
import { z } from "zod"
import { LicensesService } from "./licenses.service"

const deviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  platform: z.string().min(1),
  appVersion: z.string().min(1),
})

const redeemSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
  device: deviceSchema,
})

const renewSchema = z.object({
  leaseToken: z.string().min(1),
  device: deviceSchema,
})

@Controller("/v1")
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get("/license/config")
  getConfig() {
    return this.licenses.getPublicConfig()
  }

  @Post("/activations/redeem")
  redeem(@Body() body: unknown) {
    return this.licenses.redeem(redeemSchema.parse(body))
  }

  @Post("/licenses/renew")
  renew(@Body() body: unknown) {
    return this.licenses.renew(renewSchema.parse(body))
  }
}
```

Add `getPublicConfig()` to `LicensesService`:

```ts
getPublicConfig(): { keyId: string; leaseDays: number; serverTime: string; publicKey: string } {
  return {
    keyId: this.settings.keyId,
    leaseDays: this.settings.leaseDays,
    serverTime: new Date().toISOString(),
    publicKey: this.settings.publicKey,
  }
}
```

Modify `server/src/licenses/licenses.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { LicensesController } from "./licenses.controller"
import { LicensesService } from "./licenses.service"

@Module({
  controllers: [LicensesController],
  providers: [{
    provide: LicensesService,
    useFactory: () => {
      const env = loadEnv(process.env)
      return new LicensesService({
        privateKey: env.licensePrivateKey,
        publicKey: env.licensePublicKey,
        keyId: env.licenseKeyId,
        leaseDays: env.licenseLeaseDays,
      })
    },
  }],
  exports: [LicensesService],
})
export class LicensesModule {}
```

- [ ] **Step 5: Replace in-memory persistence with Prisma repository**

Refactor `LicensesService` so the maps become a repository interface:

```ts
export interface LicenseRepository {
  findActivationByHash(codeHash: string): Promise<ActivationRecord | null>
  findOrCreateAccount(email: string): Promise<AccountRecord>
  bindActivationToAccount(activationId: string, accountId: string): Promise<void>
  findOrCreateLicense(accountId: string, activation: ActivationRecord): Promise<LicenseRecord>
  findDevicesByLicense(licenseId: string): Promise<DeviceRecord[]>
  createDevice(license: LicenseRecord, metadata: DeviceMetadata, deviceIdHash: string): Promise<DeviceRecord>
  updateDeviceMetadata(deviceId: string, metadata: DeviceMetadata): Promise<void>
  createLease(input: { licenseId: string; deviceId: string; tokenId: string; issuedAt: Date; expiresAt: Date; statusSnapshot: Record<string, unknown> }): Promise<void>
  findRenewalState(licenseId: string, deviceIdHash: string): Promise<{ account: AccountRecord | null; license: LicenseRecord | null; device: DeviceRecord | null }>
}
```

Create a Prisma-backed implementation inside `licenses.service.ts` or split it into `server/src/licenses/licenses.repository.ts` when the file exceeds 250 lines. Keep the service tests on the fake repository and add Prisma integration tests only after Docker database is reliable.

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm --filter @synapse/server test -- licenses.service.spec.ts license-token.spec.ts
```

Expected: all license tests pass.

- [ ] **Step 7: Commit client API**

Run:

```bash
git add server/src/licenses
git commit -m "feat(server): add activation and renewal api"
```

Expected: commit succeeds.

## Task 5: Admin Auth And Admin API

**Files:**
- Create: `server/src/admin-auth/admin-auth.module.ts`
- Create: `server/src/admin-auth/admin-auth.service.ts`
- Create: `server/src/admin-auth/admin-auth.controller.ts`
- Create: `server/src/admin-auth/admin-auth.guard.ts`
- Create: `server/src/admin-auth/admin-auth.service.spec.ts`
- Create: `server/src/admin/admin.module.ts`
- Create: `server/src/admin/admin.service.ts`
- Create: `server/src/admin/admin.controller.ts`
- Create: `server/src/admin/admin.service.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write admin auth tests**

Create `server/src/admin-auth/admin-auth.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { AdminAuthService } from "./admin-auth.service"

describe("AdminAuthService", () => {
  it("accepts the configured administrator password", async () => {
    const service = await AdminAuthService.createForTest({
      email: "admin@d2.com",
      password: "admin@pwd",
      jwtSecret: "local-dev-admin-secret",
    })

    const result = await service.login("admin@d2.com", "admin@pwd")

    expect(result.email).toBe("admin@d2.com")
    expect(result.token.length).toBeGreaterThan(20)
  })

  it("rejects a wrong password", async () => {
    const service = await AdminAuthService.createForTest({
      email: "admin@d2.com",
      password: "admin@pwd",
      jwtSecret: "local-dev-admin-secret",
    })

    await expect(service.login("admin@d2.com", "wrong-password")).rejects.toThrow("Invalid admin credentials")
  })
})
```

- [ ] **Step 2: Run admin auth tests to verify missing implementation**

Run:

```bash
pnpm --filter @synapse/server test -- admin-auth.service.spec.ts
```

Expected: fails because `admin-auth.service.ts` does not exist.

- [ ] **Step 3: Implement admin auth**

Create `server/src/admin-auth/admin-auth.service.ts`:

```ts
import { Injectable } from "@nestjs/common"
import bcrypt from "bcryptjs"
import { createHmac, timingSafeEqual } from "node:crypto"

interface AdminAuthOptions {
  readonly email: string
  readonly password: string
  readonly jwtSecret: string
}

interface AdminSession {
  readonly email: string
  readonly token: string
}

@Injectable()
export class AdminAuthService {
  private constructor(
    private readonly email: string,
    private readonly passwordHash: string,
    private readonly jwtSecret: string,
  ) {}

  static async createForTest(options: AdminAuthOptions): Promise<AdminAuthService> {
    return new AdminAuthService(
      options.email.toLowerCase(),
      await bcrypt.hash(options.password, 10),
      options.jwtSecret,
    )
  }

  static async create(options: AdminAuthOptions): Promise<AdminAuthService> {
    return AdminAuthService.createForTest(options)
  }

  async login(email: string, password: string): Promise<AdminSession> {
    const normalizedEmail = email.trim().toLowerCase()
    const passwordMatches = await bcrypt.compare(password, this.passwordHash)
    if (normalizedEmail !== this.email || !passwordMatches) {
      throw new Error("Invalid admin credentials")
    }

    return {
      email: this.email,
      token: this.sign({ email: this.email, issuedAt: new Date().toISOString() }),
    }
  }

  verify(token: string): boolean {
    const [payload, signature] = token.split(".")
    if (!payload || !signature) return false
    const expected = createHmac("sha256", this.jwtSecret).update(payload).digest("base64url")
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  }

  private sign(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
    const signature = createHmac("sha256", this.jwtSecret).update(encoded).digest("base64url")
    return `${encoded}.${signature}`
  }
}
```

- [ ] **Step 4: Add auth controller and guard**

Create `server/src/admin-auth/admin-auth.controller.ts`:

```ts
import { Body, Controller, Post, Res } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthService } from "./admin-auth.service"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

@Controller("/admin")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("/login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const request = loginSchema.parse(body)
    const session = await this.auth.login(request.email, request.password)
    response.cookie("synapse_admin", session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    return { email: session.email }
  }

  @Post("/logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie("synapse_admin")
    return { ok: true }
  }
}
```

Create `server/src/admin-auth/admin-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "./admin-auth.service"

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>()
    const token = request.cookies?.synapse_admin
    return typeof token === "string" && this.auth.verify(token)
  }
}
```

Create `server/src/admin-auth/admin-auth.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

@Module({
  controllers: [AdminAuthController],
  providers: [
    {
      provide: AdminAuthService,
      useFactory: async () => {
        const env = loadEnv(process.env)
        return AdminAuthService.create({
          email: env.adminEmail,
          password: env.adminPassword,
          jwtSecret: env.adminJwtSecret,
        })
      },
    },
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
```

- [ ] **Step 5: Add admin service and routes**

Create `server/src/admin/admin.service.ts`:

```ts
import { Injectable } from "@nestjs/common"
import { z } from "zod"
import { hashActivationCode, normalizeActivationCode } from "../licenses/hash"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createActivationCode(input: { code: string; maxDevices: number; expiresAt?: string | null }) {
    const normalizedCode = normalizeActivationCode(input.code)
    const activationCode = await this.prisma.activationCode.create({
      data: {
        codeHash: hashActivationCode(normalizedCode),
        maxDevices: input.maxDevices,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    })
    return { id: activationCode.id, code: normalizedCode, maxDevices: activationCode.maxDevices }
  }

  listActivationCodes() {
    return this.prisma.activationCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        maxDevices: true,
        expiresAt: true,
        boundAccountId: true,
        redeemedAt: true,
        createdAt: true,
      },
    })
  }

  listAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      include: { licenses: { include: { devices: true } } },
    })
  }
}
```

Create `server/src/admin/admin.controller.ts` with guarded routes:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"

const createActivationCodeSchema = z.object({
  code: z.string().min(6),
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
})

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("/activation-codes")
  listActivationCodes() {
    return this.admin.listActivationCodes()
  }

  @Post("/activation-codes")
  createActivationCode(@Body() body: unknown) {
    return this.admin.createActivationCode(createActivationCodeSchema.parse(body))
  }

  @Patch("/activation-codes/:id")
  updateActivationCode(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateActivationCode(id, body)
  }

  @Get("/accounts")
  listAccounts() {
    return this.admin.listAccounts()
  }

  @Get("/accounts/:id")
  getAccount(@Param("id") id: string) {
    return this.admin.getAccount(id)
  }

  @Patch("/licenses/:id")
  updateLicense(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateLicense(id, body)
  }

  @Patch("/devices/:id")
  updateDevice(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateDevice(id, body)
  }
}
```

Create missing `AdminService` methods with exact allowed actions:

```ts
async updateActivationCode(id: string, body: unknown) {
  const request = z.object({ status: z.enum(["active", "disabled", "revoked", "expired"]) }).parse(body)
  return this.prisma.activationCode.update({ where: { id }, data: { status: request.status } })
}

async getAccount(id: string) {
  return this.prisma.account.findUniqueOrThrow({
    where: { id },
    include: { licenses: { include: { devices: true, leases: { orderBy: { createdAt: "desc" }, take: 20 } } } },
  })
}

async updateLicense(id: string, body: unknown) {
  const request = z.object({ status: z.enum(["active", "disabled", "revoked", "expired"]) }).parse(body)
  return this.prisma.license.update({ where: { id }, data: { status: request.status } })
}

async updateDevice(id: string, body: unknown) {
  const request = z.object({ status: z.enum(["active", "revoked"]) }).parse(body)
  return this.prisma.device.update({ where: { id }, data: { status: request.status } })
}
```

Create `server/src/admin/admin.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
```

Modify `server/src/app.module.ts` to import `AdminAuthModule` and `AdminModule`.

- [ ] **Step 6: Run admin tests and typecheck**

Run:

```bash
pnpm --filter @synapse/server test -- admin-auth.service.spec.ts
pnpm --filter @synapse/server typecheck
```

Expected: auth tests pass and server typecheck passes.

- [ ] **Step 7: Commit admin API**

Run:

```bash
git add server/src/admin-auth server/src/admin server/src/app.module.ts
git commit -m "feat(server): add admin license api"
```

Expected: commit succeeds.

## Task 6: Built-In Admin UI Shell With sidebar-07

**Files:**
- Create: `server/admin/index.html`
- Create: `server/admin/vite.config.ts`
- Create: `server/admin/tsconfig.json`
- Create: `server/admin/components.json`
- Create: `server/admin/src/main.tsx`
- Create: `server/admin/src/App.tsx`
- Create: `server/admin/src/styles/globals.css`
- Create: `server/admin/src/lib/utils.ts`
- Create: `server/admin/src/components/app-sidebar.tsx`
- Create: `server/admin/src/components/nav-main.tsx`
- Create: `server/admin/src/components/nav-user.tsx`
- Create: `server/admin/src/components/team-switcher.tsx`
- Create: `server/admin/src/components/ui/*`

- [ ] **Step 1: Initialize admin Vite files**

Create `server/admin/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Synapse Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `server/admin/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../admin-dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
  },
})
```

Create `server/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Add shadcn config and sidebar block**

Create `server/admin/components.json` matching the desktop preset:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "radix-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Run from `server/admin`:

```bash
pnpm dlx shadcn@latest add sidebar-07
```

Expected: shadcn creates the sidebar block files and required UI components under `server/admin/src/components`.

- [ ] **Step 3: Adapt sidebar navigation labels**

Modify the generated `server/admin/src/components/app-sidebar.tsx` data so the main nav contains only:

```ts
const data = {
  user: {
    name: "Admin",
    email: "admin@d2.com",
    avatar: "",
  },
  teams: [
    {
      name: "Synapse",
      logo: GalleryVerticalEnd,
      plan: "License",
    },
  ],
  navMain: [
    { title: "激活码", url: "#/activation-codes", icon: KeyRound },
    { title: "账号", url: "#/accounts", icon: Users },
    { title: "设备", url: "#/devices", icon: Monitor },
    { title: "系统", url: "#/system", icon: Activity },
  ],
}
```

Use lucide icons already imported in the generated block. Keep shadcn classes, token colors, and sidebar structure intact.

- [ ] **Step 4: Add admin app shell**

Create `server/admin/src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Create `server/admin/src/App.tsx`:

```tsx
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

function routeFromHash(): string {
  return window.location.hash.replace(/^#\\/?/, "") || "activation-codes"
}

export default function App() {
  const route = routeFromHash()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <h1 className="text-sm font-medium">
              {route === "activation-codes" ? "激活码" : route === "accounts" ? "账号" : route === "devices" ? "设备" : "系统"}
            </h1>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-2 p-4 pt-0">
          <div className="text-sm text-muted-foreground">Loading</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

Replace `Loading` with actual pages in Task 7.

- [ ] **Step 5: Restore server typecheck script**

Modify `server/package.json` script:

```json
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p admin/tsconfig.json --noEmit"
```

- [ ] **Step 6: Build admin UI**

Run:

```bash
pnpm --filter @synapse/server build:admin
```

Expected: Vite writes `server/admin-dist`.

- [ ] **Step 7: Commit admin shell**

Run:

```bash
git add server/admin server/package.json
git commit -m "feat(server): add shadcn admin shell"
```

Expected: commit succeeds.

## Task 7: Admin UI Pages And API Client

**Files:**
- Create: `server/admin/src/lib/api.ts`
- Create: `server/admin/src/pages/login-page.tsx`
- Create: `server/admin/src/pages/activation-codes-page.tsx`
- Create: `server/admin/src/pages/accounts-page.tsx`
- Create: `server/admin/src/pages/account-detail-page.tsx`
- Create: `server/admin/src/pages/devices-page.tsx`
- Create: `server/admin/src/pages/system-page.tsx`
- Create: `server/admin/src/pages/__tests__/login-page.test.tsx`
- Create: `server/admin/src/pages/__tests__/activation-codes-page.test.tsx`
- Modify: `server/admin/src/App.tsx`

- [ ] **Step 1: Add centralized admin API client**

Create `server/admin/src/lib/api.ts`:

```ts
export interface ActivationCodeRow {
  readonly id: string
  readonly status: string
  readonly maxDevices: number
  readonly expiresAt: string | null
  readonly boundAccountId: string | null
  readonly redeemedAt: string | null
  readonly createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json() as Promise<T>
}

export const adminApi = {
  login: (payload: { email: string; password: string }) =>
    request<{ email: string }>("/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    request<{ ok: true }>("/admin/logout", {
      method: "POST",
    }),
  listActivationCodes: () =>
    request<ActivationCodeRow[]>("/admin/api/activation-codes"),
  createActivationCode: (payload: { code: string; maxDevices: number; expiresAt: string | null }) =>
    request<{ id: string; code: string; maxDevices: number }>("/admin/api/activation-codes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
}
```

- [ ] **Step 2: Create login page**

Create `server/admin/src/pages/login-page.tsx` using shadcn `Card`, `Field`, `Input`, and `Button`:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { adminApi } from "@/lib/api"

interface LoginPageProps {
  readonly onLoggedIn: () => void
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitting(true)
              setError(null)
              adminApi.login({ email, password })
                .then(onLoggedIn)
                .catch(() => setError("登录失败"))
                .finally(() => setSubmitting(false))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">邮箱</FieldLabel>
                <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
            </FieldGroup>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting}>登录</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Create activation code page**

Create `server/admin/src/pages/activation-codes-page.tsx` with `Table`, `Badge`, `Dialog`, `Field`, `Input`, and `Button`. The page must call `adminApi.listActivationCodes()` on mount and `adminApi.createActivationCode()` from a create dialog. Use `maxDevices` default `1` in component state.

Core rendering shape:

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>状态</TableHead>
      <TableHead>设备数</TableHead>
      <TableHead>过期时间</TableHead>
      <TableHead>绑定账号</TableHead>
      <TableHead>创建时间</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {rows.map((row) => (
      <TableRow key={row.id}>
        <TableCell><Badge variant="secondary">{row.status}</Badge></TableCell>
        <TableCell className="text-right">{row.maxDevices}</TableCell>
        <TableCell>{row.expiresAt ?? "-"}</TableCell>
        <TableCell>{row.boundAccountId ?? "-"}</TableCell>
        <TableCell>{row.createdAt}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

Keep all numeric table cells right-aligned.

- [ ] **Step 4: Add remaining pages**

Create the remaining pages with operational copy only:

```tsx
export function AccountsPage() {
  return <div className="flex flex-col gap-2">账号</div>
}

export function AccountDetailPage() {
  return <div className="flex flex-col gap-2">账号详情</div>
}

export function DevicesPage() {
  return <div className="flex flex-col gap-2">设备</div>
}

export function SystemPage() {
  return <div className="flex flex-col gap-2">系统</div>
}
```

Keep these minimal pages focused on their title until their API-backed tables are added. Do not add marketing descriptions.

- [ ] **Step 5: Wire routes in App**

Modify `server/admin/src/App.tsx`:

```tsx
const pages: Record<string, JSX.Element> = {
  "activation-codes": <ActivationCodesPage />,
  accounts: <AccountsPage />,
  devices: <DevicesPage />,
  system: <SystemPage />,
}
```

Render `pages[route] ?? pages["activation-codes"]`. Render `LoginPage` before the shell when local `isLoggedIn` is false.

- [ ] **Step 6: Add admin UI tests**

Create `server/admin/src/pages/__tests__/login-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LoginPage } from "../login-page"

describe("LoginPage", () => {
  it("renders email and password fields", () => {
    render(<LoginPage onLoggedIn={() => undefined} />)
    expect(screen.getByLabelText("邮箱")).toBeTruthy()
    expect(screen.getByLabelText("密码")).toBeTruthy()
  })
})
```

If `@testing-library/react` is missing, add it to `server/devDependencies`:

```bash
pnpm --filter @synapse/server add -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 7: Run admin build and tests**

Run:

```bash
pnpm --filter @synapse/server build:admin
pnpm --filter @synapse/server test -- login-page.test.tsx
```

Expected: admin build succeeds and login page test passes.

- [ ] **Step 8: Commit admin pages**

Run:

```bash
git add server/admin server/package.json pnpm-lock.yaml
git commit -m "feat(server): add license admin pages"
```

Expected: commit succeeds.

## Task 8: Desktop License Storage, Verification, And IPC

**Files:**
- Create: `desktop/electron/runtime/data-repo/schemas/core-license.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Create: `desktop/electron/services/license/types.ts`
- Create: `desktop/electron/services/license/device-id.ts`
- Create: `desktop/electron/services/license/license-token.ts`
- Create: `desktop/electron/services/license/license-client.ts`
- Create: `desktop/electron/services/license/license-service.ts`
- Create: `desktop/electron/services/license/index.ts`
- Create: `desktop/electron/services/__tests__/license-service.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Create: `desktop/electron/modules/license/ipc.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/scripts/generate-ipc.mjs`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Create: `desktop/src/types/license.ts`

- [ ] **Step 1: Add desktop service tests**

Create `desktop/electron/services/__tests__/license-service.test.ts`:

```ts
import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import { hashDeviceId } from "../license/device-id"
import { signDesktopLicenseLease } from "../license/license-token"
import { LicenseService } from "../license/license-service"

function keyPair() {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}

describe("LicenseService", () => {
  it("accepts a valid lease for the current device", async () => {
    const keys = keyPair()
    const leaseToken = signDesktopLicenseLease({
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-1"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2099-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test",
    }, keys.privateKey)

    const service = LicenseService.createForTest({
      publicKey: keys.publicKey,
      deviceId: "device-1",
      storedLeaseToken: leaseToken,
    })

    await expect(service.getState()).resolves.toMatchObject({ status: "active" })
  })

  it("rejects a lease for another device", async () => {
    const keys = keyPair()
    const leaseToken = signDesktopLicenseLease({
      tokenId: "lease_1",
      accountId: "account_1",
      email: "user@example.com",
      licenseId: "license_1",
      deviceIdHash: hashDeviceId("device-2"),
      issuedAt: "2026-04-29T00:00:00.000Z",
      expiresAt: "2099-05-06T00:00:00.000Z",
      maxDevices: 1,
      licenseStatus: "active",
      keyId: "test",
    }, keys.privateKey)

    const service = LicenseService.createForTest({
      publicKey: keys.publicKey,
      deviceId: "device-1",
      storedLeaseToken: leaseToken,
    })

    await expect(service.getState()).resolves.toMatchObject({ status: "activation-required" })
  })
})
```

- [ ] **Step 2: Run desktop test to verify missing implementation**

Run:

```bash
pnpm desktop:test -- license-service.test.ts
```

Expected: fails because license service files do not exist.

- [ ] **Step 3: Add encrypted DataRepository schema**

Create `desktop/electron/runtime/data-repo/schemas/core-license.ts`:

```ts
import type { Migration, NamespaceSchema } from "../types"

export interface CoreLicenseV1 extends Record<string, unknown> {
  schemaVersion: 1
  deviceId: string
  leaseToken: string | null
  lastRenewedAt?: string
}

const migrations: readonly Migration[] = []

function isCoreLicenseV1(value: unknown): value is CoreLicenseV1 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.deviceId === "string"
    && (record.leaseToken === null || typeof record.leaseToken === "string")
}

export const coreLicenseSchema: NamespaceSchema<CoreLicenseV1> = {
  name: "core.license",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations,
  encrypted: true,
  validate: isCoreLicenseV1,
}
```

Modify `desktop/electron/runtime/data-repo/schemas/index.ts` to export and include `coreLicenseSchema` in `allSchemas` after `coreIdentitySchema`.

- [ ] **Step 4: Add desktop token and device helpers**

Create `desktop/electron/services/license/device-id.ts`:

```ts
import { createHash, randomUUID } from "node:crypto"

export function createDeviceId(): string {
  return randomUUID()
}

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex")
}
```

Create `desktop/electron/services/license/license-token.ts` mirroring server verification and exporting a test-only signer:

```ts
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import type { LicenseLeasePayload } from "./types"

interface SignedLeaseEnvelope {
  readonly payload: LicenseLeasePayload
  readonly signature: string
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T
}

export function verifyDesktopLicenseLease(token: string, publicKeyPem: string): LicenseLeasePayload {
  const envelope = decode<SignedLeaseEnvelope>(token)
  const encodedPayload = encode(envelope.payload)
  const valid = verify(
    null,
    Buffer.from(encodedPayload),
    createPublicKey(publicKeyPem),
    Buffer.from(envelope.signature, "base64url"),
  )
  if (!valid) {
    throw new Error("Invalid license signature")
  }
  return envelope.payload
}

export function signDesktopLicenseLease(payload: LicenseLeasePayload, privateKeyPem: string): string {
  const encodedPayload = encode(payload)
  const signature = sign(null, Buffer.from(encodedPayload), createPrivateKey(privateKeyPem))
  return encode({ payload, signature: signature.toString("base64url") })
}
```

Create `desktop/electron/services/license/types.ts` and matching renderer `desktop/src/types/license.ts`:

```ts
export type LicenseState =
  | { status: "active"; email: string; expiresAt: string }
  | { status: "activation-required"; reason: "missing" | "invalid" | "expired" | "device-mismatch" }
  | { status: "checking" }

export interface LicenseLeasePayload {
  readonly tokenId: string
  readonly accountId: string
  readonly email: string
  readonly licenseId: string
  readonly deviceIdHash: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly maxDevices: number
  readonly licenseStatus: "active" | "disabled" | "revoked" | "expired"
  readonly keyId: string
}

export interface ActivateLicenseRequest {
  readonly email: string
  readonly activationCode: string
}
```

- [ ] **Step 5: Implement LicenseService**

Create `desktop/electron/services/license/license-service.ts`:

```ts
import type { DataNamespace } from "../../runtime/data-repo"
import { createDeviceId, hashDeviceId } from "./device-id"
import { verifyDesktopLicenseLease } from "./license-token"
import type { ActivateLicenseRequest, LicenseState } from "./types"

interface LicenseStore {
  schemaVersion: 1
  deviceId: string
  leaseToken: string | null
  lastRenewedAt?: string
}

interface LicenseServiceDeps {
  readonly namespace: DataNamespace<LicenseStore>
  readonly publicKey: string
  readonly activateRemote: (request: ActivateLicenseRequest & { deviceId: string }) => Promise<{ leaseToken: string }>
}

export class LicenseService {
  constructor(private readonly deps: LicenseServiceDeps) {}

  static createForTest(input: { publicKey: string; deviceId: string; storedLeaseToken: string | null }): LicenseService {
    let store: LicenseStore = { schemaVersion: 1, deviceId: input.deviceId, leaseToken: input.storedLeaseToken }
    return new LicenseService({
      publicKey: input.publicKey,
      namespace: {
        name: "core.license",
        schemaVersion: 1,
        backend: "encrypted-json",
        getSingleton: async () => store,
        setSingleton: async (value) => { store = value },
        list: async () => [],
        get: async () => null,
        upsert: async () => undefined,
        remove: async () => undefined,
        onChange: () => () => undefined,
      },
      activateRemote: async () => ({ leaseToken: input.storedLeaseToken ?? "" }),
    })
  }

  async getState(): Promise<LicenseState> {
    const store = await this.ensureStore()
    if (!store.leaseToken) {
      return { status: "activation-required", reason: "missing" }
    }

    try {
      const payload = verifyDesktopLicenseLease(store.leaseToken, this.deps.publicKey)
      if (payload.deviceIdHash !== hashDeviceId(store.deviceId)) {
        return { status: "activation-required", reason: "device-mismatch" }
      }
      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        return { status: "activation-required", reason: "expired" }
      }
      return { status: "active", email: payload.email, expiresAt: payload.expiresAt }
    } catch {
      return { status: "activation-required", reason: "invalid" }
    }
  }

  async activate(request: ActivateLicenseRequest): Promise<LicenseState> {
    const store = await this.ensureStore()
    const response = await this.deps.activateRemote({ ...request, deviceId: store.deviceId })
    await this.deps.namespace.setSingleton({ ...store, leaseToken: response.leaseToken, lastRenewedAt: new Date().toISOString() })
    return this.getState()
  }

  private async ensureStore(): Promise<LicenseStore> {
    const existing = await this.deps.namespace.getSingleton()
    if (existing) return existing
    const next: LicenseStore = { schemaVersion: 1, deviceId: createDeviceId(), leaseToken: null }
    await this.deps.namespace.setSingleton(next)
    return next
  }
}
```

- [ ] **Step 6: Add IPC module and bridge**

Create `desktop/electron/modules/license/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { LicenseService } from "../../services/license"

const activateSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
})

export const licenseIpcModule: IpcModule = {
  id: "license",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:license:get-state",
      request: z.void(),
      response: z.any(),
      handler: async (ctx) => ctx.registry.get<LicenseService>("core.license").getState(),
    },
    activate: {
      kind: "invoke",
      channel: "synapse:license:activate",
      request: activateSchema,
      response: z.any(),
      handler: async (ctx, request) => ctx.registry.get<LicenseService>("core.license").activate(request),
    },
  },
  events: {},
}
```

Modify `desktop/electron/bootstrap/ipc-registry.ts`, `desktop/scripts/generate-ipc.mjs`, `desktop/electron/preload.ts`, and `desktop/src/types/bridge.ts` to add the `license` domain with `getState()` and `activate()` methods.

- [ ] **Step 7: Register service through ServiceRegistry**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
export const coreLicenseDescriptor: ServiceDescriptor<LicenseService> = {
  id: "core.license",
  criticality: "fatal",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    return createLicenseService({
      namespace: ctx.dataRepo.namespace("core.license"),
      publicKey: process.env.SYNAPSE_LICENSE_PUBLIC_KEY ?? "",
      serverUrl: process.env.SYNAPSE_LICENSE_SERVER_URL ?? "http://localhost:3000",
    })
  },
}
```

Create `createLicenseService` in `desktop/electron/services/license/index.ts`. Keep remote API calls in `license-client.ts`; do not call `fetch` from React components.

Modify `desktop/electron/bootstrap/registry.ts` to import and register `coreLicenseDescriptor`.

- [ ] **Step 8: Regenerate IPC channels**

Run:

```bash
pnpm desktop:generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes a `license` entry.

- [ ] **Step 9: Run desktop license tests**

Run:

```bash
pnpm desktop:test -- license-service.test.ts
pnpm desktop:check:ipc-codegen
pnpm desktop:check:hard-constraints
```

Expected: tests pass, IPC codegen check passes, hard constraints pass.

- [ ] **Step 10: Commit desktop license service**

Run:

```bash
git add desktop/electron/runtime/data-repo/schemas desktop/electron/services/license desktop/electron/services/__tests__/license-service.test.ts desktop/electron/bootstrap desktop/electron/modules/license desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types
git commit -m "feat(desktop): add license service and ipc"
```

Expected: commit succeeds.

## Task 9: Desktop Activation Gate UI

**Files:**
- Create: `desktop/src/app-shell/license.tsx`
- Create: `desktop/src/app-shell/components/license-gate.tsx`
- Create: `desktop/src/app-shell/components/__tests__/license-gate.test.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Write gate test**

Create `desktop/src/app-shell/components/__tests__/license-gate.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LicenseGate } from "../license-gate"

describe("LicenseGate", () => {
  it("renders children when license is active", () => {
    render(
      <LicenseGate state={{ status: "active", email: "user@example.com", expiresAt: "2099-05-06T00:00:00.000Z" }} onActivate={() => Promise.resolve()}>
        <div>App</div>
      </LicenseGate>,
    )

    expect(screen.getByText("App")).toBeTruthy()
  })

  it("renders activation form when activation is required", () => {
    render(
      <LicenseGate state={{ status: "activation-required", reason: "missing" }} onActivate={() => Promise.resolve()}>
        <div>App</div>
      </LicenseGate>,
    )

    expect(screen.getByLabelText("邮箱")).toBeTruthy()
    expect(screen.getByLabelText("激活码")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run gate test to verify missing component**

Run:

```bash
pnpm desktop:test -- license-gate.test.tsx
```

Expected: fails because `license-gate.tsx` does not exist.

- [ ] **Step 3: Add license provider**

Create `desktop/src/app-shell/license.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { ActivateLicenseRequest, LicenseState } from "@/types/license"

interface LicenseContextValue {
  readonly state: LicenseState
  readonly activate: (request: ActivateLicenseRequest) => Promise<void>
}

const LicenseContext = createContext<LicenseContextValue | null>(null)

export function LicenseProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<LicenseState>({ status: "checking" })

  useEffect(() => {
    requireBridgeDomain("license").getState().then(setState)
  }, [])

  const value = useMemo<LicenseContextValue>(() => ({
    state,
    activate: async (request) => {
      const next = await requireBridgeDomain("license").activate(request)
      setState(next)
    },
  }), [state])

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}

export function useLicense(): LicenseContextValue {
  const value = useContext(LicenseContext)
  if (!value) {
    throw new Error("LicenseProvider is missing")
  }
  return value
}
```

- [ ] **Step 4: Add shadcn activation gate**

Create `desktop/src/app-shell/components/license-gate.tsx`:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { ActivateLicenseRequest, LicenseState } from "@/types/license"

interface LicenseGateProps {
  readonly state: LicenseState
  readonly onActivate: (request: ActivateLicenseRequest) => Promise<void>
  readonly children: React.ReactNode
}

export function LicenseGate({ state, onActivate, children }: LicenseGateProps) {
  const [email, setEmail] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (state.status === "active") {
    return <>{children}</>
  }

  if (state.status === "checking") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>激活 Synapse</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitting(true)
              setError(null)
              onActivate({ email, activationCode })
                .catch(() => setError("激活失败"))
                .finally(() => setSubmitting(false))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="license-email">邮箱</FieldLabel>
                <Input id="license-email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="activation-code">激活码</FieldLabel>
                <Input id="activation-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} />
              </Field>
            </FieldGroup>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting}>激活</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Wire provider and gate**

Modify `desktop/src/main.tsx` so `LicenseProvider` wraps `AppNotificationsProvider` and children:

```tsx
<LicenseProvider>
  <AppNotificationsProvider>
    <ActiveRepositorySwitchProvider>
      <App />
    </ActiveRepositorySwitchProvider>
  </AppNotificationsProvider>
</LicenseProvider>
```

Modify `desktop/src/App.tsx`:

```tsx
import { useLicense } from "@/app-shell/license"
import { LicenseGate } from "@/app-shell/components/license-gate"
```

Wrap `MainApp` result:

```tsx
function LicensedMainApp() {
  const license = useLicense()
  return (
    <LicenseGate state={license.state} onActivate={license.activate}>
      <MainApp />
    </LicenseGate>
  )
}
```

Use `LicensedMainApp` in `App` for the normal app window. For standalone content detail windows, use the same gate before `ContentDetailWindowPage` so the activation rule remains consistent.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm desktop:test -- license-gate.test.tsx
pnpm desktop:typecheck
```

Expected: license gate test passes and desktop typecheck passes.

- [ ] **Step 7: Commit desktop gate**

Run:

```bash
git add desktop/src/app-shell/license.tsx desktop/src/app-shell/components/license-gate.tsx desktop/src/app-shell/components/__tests__/license-gate.test.tsx desktop/src/main.tsx desktop/src/App.tsx
git commit -m "feat(desktop): add activation gate"
```

Expected: commit succeeds.

## Task 10: Renewal, End-To-End Checks, And Production Config

**Files:**
- Modify: `desktop/electron/services/license/license-service.ts`
- Modify: `desktop/electron/services/license/license-client.ts`
- Modify: `desktop/electron/services/__tests__/license-service.test.ts`
- Modify: `server/src/licenses/licenses.service.ts`
- Modify: `server/src/licenses/licenses.service.spec.ts`
- Modify: `server/src/app.module.ts`
- Create: `server/src/health.controller.ts`

- [ ] **Step 1: Add renewal tests**

Extend `desktop/electron/services/__tests__/license-service.test.ts`:

```ts
it("continues offline when renewal fails and lease is valid", async () => {
  const keys = keyPair()
  const leaseToken = signDesktopLicenseLease({
    tokenId: "lease_1",
    accountId: "account_1",
    email: "user@example.com",
    licenseId: "license_1",
    deviceIdHash: hashDeviceId("device-1"),
    issuedAt: "2026-04-29T00:00:00.000Z",
    expiresAt: "2099-05-06T00:00:00.000Z",
    maxDevices: 1,
    licenseStatus: "active",
    keyId: "test",
  }, keys.privateKey)

  const service = LicenseService.createForTest({
    publicKey: keys.publicKey,
    deviceId: "device-1",
    storedLeaseToken: leaseToken,
    renewRemote: async () => { throw new Error("network") },
  })

  await expect(service.renew()).resolves.toMatchObject({ status: "active" })
})
```

- [ ] **Step 2: Implement renewal client**

Create or update `desktop/electron/services/license/license-client.ts`:

```ts
import type { ActivateLicenseRequest } from "./types"

interface LicenseClientOptions {
  readonly serverUrl: string
}

export function createLicenseClient(options: LicenseClientOptions) {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${options.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return response.json() as Promise<T>
  }

  return {
    activate: (request: ActivateLicenseRequest & { deviceId: string; name: string; platform: string; appVersion: string }) =>
      post<{ leaseToken: string }>("/v1/activations/redeem", {
        email: request.email,
        activationCode: request.activationCode,
        device: {
          deviceId: request.deviceId,
          name: request.name,
          platform: request.platform,
          appVersion: request.appVersion,
        },
      }),
    renew: (request: { leaseToken: string; deviceId: string; name: string; platform: string; appVersion: string }) =>
      post<{ leaseToken: string }>("/v1/licenses/renew", {
        leaseToken: request.leaseToken,
        device: {
          deviceId: request.deviceId,
          name: request.name,
          platform: request.platform,
          appVersion: request.appVersion,
        },
      }),
  }
}
```

Update `LicenseService` so `getState()` validates local state and `renew()` calls the remote client when a lease exists. Store the new lease token when renewal succeeds. Return the current active state when renewal fails because of network and local lease is still valid.

- [ ] **Step 3: Add health endpoint**

Create `server/src/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common"
import { PrismaService } from "./prisma/prisma.service"

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("/health")
  async health() {
    await this.prisma.$queryRaw`SELECT 1`
    return { ok: true }
  }
}
```

Register `HealthController` in `server/src/app.module.ts`.

- [ ] **Step 4: Run full verification commands**

Run:

```bash
pnpm server:test
pnpm server:typecheck
pnpm server:build
pnpm desktop:test -- license-service.test.ts license-gate.test.tsx
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Commit renewal and verification fixes**

Run:

```bash
git add server desktop
git commit -m "feat: complete license activation loop"
```

Expected: commit succeeds.

## Task 11: Final Integration Review

**Files:**
- Modify only files needed to fix verification failures found in this task.

- [ ] **Step 1: Verify root status**

Run:

```bash
git status --short
```

Expected: clean working tree before final verification.

- [ ] **Step 2: Run full repository checks**

Run:

```bash
pnpm server:test
pnpm server:typecheck
pnpm server:build
pnpm desktop:test
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
```

Expected: all commands exit with code 0. If a command fails, fix only files touched by this plan and rerun the failing command before rerunning the full set.

- [ ] **Step 3: Review hard constraints manually**

Check:

```bash
rg -n "ipcMain\\.(handle|on)|webContents\\.send|fs\\.writeFile|export default new|catch \\{\\}" desktop/electron desktop/src server/src
```

Expected:

- No new bare `ipcMain.handle/on`.
- No new bare `webContents.send`.
- No new desktop business-data `fs.writeFile`.
- No new `export default new XxxService()`.
- No empty `catch {}`.

- [ ] **Step 4: Final commit if fixes were needed**

If Step 2 or Step 3 required edits, run:

```bash
git add desktop server package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "fix: stabilize license activation checks"
```

Expected: commit succeeds if there were fixes. If no files changed, skip this commit.
