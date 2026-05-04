# Server 全面加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Synapse license server across security, observability, API completeness, testing, admin UI, and deployment.

**Architecture:** Four sequential sub-projects build on each other: (1) security + ops foundation installs middleware, logging, health checks, and fixes JWT/token issues; (2) API completeness adds pagination, missing CRUD, audit logging, and scheduled cleanup; (3) test suite adds integration, controller, and error-scenario tests with coverage; (4) admin UI enhancements add bulk ops, export, session management, audit log viewer, and Docker hardening.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Vitest 4, Pino, @nestjs/throttler, @nestjs/terminus, @nestjs/schedule, helmet, React 19 + shadcn/ui

---

## Sub-Project 1: Security + Ops Foundation

### Task 1: Install dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install production dependencies**

```bash
cd server && pnpm add @nestjs/throttler helmet @nestjs/jwt nestjs-pino pino-http pino-pretty
```

- [ ] **Step 2: Install dev dependencies**

```bash
cd server && pnpm add -D @types/express-serve-static-core
```

- [ ] **Step 3: Verify installation**

Run: `cd server && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml
git commit -m "chore(server): add security and observability dependencies"
```

---

### Task 2: Structured logging with Pino

**Files:**
- Modify: `server/src/app.module.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add LoggerModule to AppModule**

In `server/src/app.module.ts`, add the import and configure:

```typescript
import { Module } from "@nestjs/common"
import { ServeStaticModule } from "@nestjs/serve-static"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { LicensesModule } from "./licenses/licenses.module"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ["req.headers.cookie", "req.headers.authorization"],
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "admin-dist"),
      serveRoot: "/admin",
      exclude: ["/admin/api/(.*)", "/admin/login", "/admin/logout"],
    }),
    PrismaModule,
    AdminAuthModule,
    AdminModule,
    LicensesModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Use Pino logger in main.ts**

Replace `server/src/main.ts`:

```typescript
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import { Logger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { loadEnv } from "./config/env"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(cookieParser())
  app.enableShutdownHooks()
  await app.listen(env.port)
}

void bootstrap()
```

- [ ] **Step 3: Verify server starts with logging**

Run: `cd server && PORT=3001 pnpm dev:api`
Expected: Pino JSON logs appear on startup, pretty-printed in dev

- [ ] **Step 4: Commit**

```bash
git add server/src/app.module.ts server/src/main.ts
git commit -m "feat(server): add structured logging with Pino"
```

---

### Task 3: Global exception filter

**Files:**
- Create: `server/src/common/all-exceptions.filter.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Create the exception filter**

Create `server/src/common/all-exceptions.filter.ts`:

```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { Response } from "express"
import { PinoLogger } from "nestjs-pino"

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    const { statusCode, error, message } = this.resolve(exception)

    if (statusCode >= 500) {
      this.logger.error({ err: exception }, message)
    }

    response.status(statusCode).json({ error, message, statusCode })
  }

  private resolve(exception: unknown): {
    statusCode: number
    error: string
    message: string
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      return {
        statusCode: status,
        error: HttpStatus[status] ?? "Error",
        message: typeof body === "string" ? body : readMessage(body),
      }
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception)
    }

    return {
      statusCode: 500,
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "production"
          ? "服务器内部错误。"
          : exception instanceof Error
            ? exception.message
            : "服务器内部错误。",
    }
  }

  private resolvePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { statusCode: number; error: string; message: string } {
    switch (error.code) {
      case "P2002":
        return { statusCode: 409, error: "Conflict", message: "资源已存在。" }
      case "P2025":
        return { statusCode: 404, error: "Not Found", message: "资源不存在。" }
      default:
        return {
          statusCode: 500,
          error: "Internal Server Error",
          message: "数据库操作失败。",
        }
    }
  }
}

function readMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.join("；")
  }
  return "请求失败。"
}
```

- [ ] **Step 2: Register the filter in main.ts**

Add after `app.useLogger(...)` in `server/src/main.ts`:

```typescript
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { PinoLogger } from "nestjs-pino"

// inside bootstrap(), after app.useLogger(...)
app.useGlobalFilters(new AllExceptionsFilter(app.get(PinoLogger)))
```

- [ ] **Step 3: Verify error responses are consistent**

Run: `curl -s http://localhost:3001/admin/api/activation-codes | jq`
Expected: `{ "error": "Forbidden", "message": "未登录或登录已过期。", "statusCode": 403 }`

- [ ] **Step 4: Commit**

```bash
git add server/src/common/all-exceptions.filter.ts server/src/main.ts
git commit -m "feat(server): add global exception filter with Prisma error mapping"
```

---

### Task 4: Security middleware (helmet + CORS)

**Files:**
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add helmet and CORS to main.ts**

Add to `server/src/main.ts` bootstrap function, after `app.use(cookieParser())`:

```typescript
import helmet from "helmet"

// inside bootstrap(), after cookieParser
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production",
  }),
)
app.enableCors({
  origin: process.env.NODE_ENV === "production" ? false : true,
  credentials: true,
})
```

- [ ] **Step 2: Verify headers**

Run: `curl -sI http://localhost:3001/v1/license/config | grep -i 'x-content-type\|x-frame'`
Expected: `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`

- [ ] **Step 3: Commit**

```bash
git add server/src/main.ts
git commit -m "feat(server): add helmet security headers and CORS configuration"
```

---

### Task 5: Rate limiting with @nestjs/throttler

**Files:**
- Modify: `server/src/app.module.ts`
- Modify: `server/src/licenses/licenses.controller.ts`
- Modify: `server/src/admin-auth/admin-auth.controller.ts`
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Register ThrottlerModule in AppModule**

Add to `server/src/app.module.ts` imports:

```typescript
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler"
import { APP_GUARD } from "@nestjs/core"

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60000, limit: 60 },
    ]),
    // ... existing imports
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Add stricter limits to public endpoints**

In `server/src/licenses/licenses.controller.ts`, add throttle decorator:

```typescript
import { Throttle } from "@nestjs/throttler"

@Throttle([{ name: "default", ttl: 60000, limit: 10 }])
@Post("/activations/redeem")
async redeem(...) { ... }

@Throttle([{ name: "default", ttl: 60000, limit: 10 }])
@Post("/licenses/renew")
async renew(...) { ... }

@Throttle([{ name: "default", ttl: 60000, limit: 10 }])
@Post("/licenses/validate")
async validate(...) { ... }

@Throttle([{ name: "default", ttl: 60000, limit: 30 }])
@Get("/license/config")
getConfig() { ... }
```

- [ ] **Step 3: Add stricter limits to admin login**

In `server/src/admin-auth/admin-auth.controller.ts`:

```typescript
import { Throttle } from "@nestjs/throttler"

@Throttle([{ name: "default", ttl: 60000, limit: 5 }])
@Post("/login")
async login(...) { ... }
```

- [ ] **Step 4: Verify rate limiting**

Run 6 rapid login requests:
```bash
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/admin/login -H "Content-Type: application/json" -d '{"email":"x@x.com","password":"x"}'; done
```
Expected: First 5 return 401, 6th returns 429

- [ ] **Step 5: Commit**

```bash
git add server/src/app.module.ts server/src/licenses/licenses.controller.ts server/src/admin-auth/admin-auth.controller.ts
git commit -m "feat(server): add rate limiting with @nestjs/throttler"
```

---

### Task 6: JWT rework with @nestjs/jwt + token expiration

**Files:**
- Modify: `server/src/admin-auth/admin-auth.service.ts`
- Modify: `server/src/admin-auth/admin-auth.guard.ts`
- Modify: `server/src/admin-auth/admin-auth.module.ts`
- Modify: `server/src/admin-auth/admin-auth.controller.ts`
- Modify: `server/src/config/env.ts`

- [ ] **Step 1: Strengthen env validation**

In `server/src/config/env.ts`, change:

```typescript
ADMIN_PASSWORD: z.string().min(12),
ADMIN_JWT_SECRET: z.string().min(32),
```

Update `.env.example` accordingly.

- [ ] **Step 2: Rewrite AdminAuthService to use @nestjs/jwt**

Replace `server/src/admin-auth/admin-auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import bcrypt from "bcryptjs"

interface AdminAuthOptions {
  readonly email: string
  readonly password: string
}

interface AdminSession {
  readonly email: string
  readonly token: string
}

interface AdminTokenPayload {
  readonly sub: string
  readonly email: string
}

@Injectable()
export class AdminAuthService {
  private constructor(
    private readonly email: string,
    private readonly passwordHash: string,
    private readonly jwt: JwtService,
  ) {}

  static async create(
    options: AdminAuthOptions,
    jwt: JwtService,
  ): Promise<AdminAuthService> {
    return new AdminAuthService(
      options.email.toLowerCase(),
      await bcrypt.hash(options.password, 10),
      jwt,
    )
  }

  static async createForTest(
    options: AdminAuthOptions,
    jwt: JwtService,
  ): Promise<AdminAuthService> {
    return AdminAuthService.create(options, jwt)
  }

  getEmail(): string {
    return this.email
  }

  async login(email: string, password: string): Promise<AdminSession> {
    const normalizedEmail = email.trim().toLowerCase()
    const passwordMatches = await bcrypt.compare(password, this.passwordHash)
    if (normalizedEmail !== this.email || !passwordMatches) {
      throw new UnauthorizedException("管理员账号或密码错误。")
    }

    const payload: AdminTokenPayload = {
      sub: this.email,
      email: this.email,
    }
    const token = this.jwt.sign(payload)

    return { email: this.email, token }
  }

  verify(token: string): AdminTokenPayload | null {
    try {
      return this.jwt.verify<AdminTokenPayload>(token)
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 3: Update AdminAuthModule to provide JwtService**

Replace `server/src/admin-auth/admin-auth.module.ts`:

```typescript
import { Module } from "@nestjs/common"
import { JwtModule, JwtService } from "@nestjs/jwt"
import { loadEnv } from "../config/env"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv(process.env)
        return {
          secret: env.adminJwtSecret,
          signOptions: { expiresIn: "24h" },
        }
      },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    {
      provide: AdminAuthService,
      useFactory: async (jwt: JwtService) => {
        const env = loadEnv(process.env)
        return AdminAuthService.create(
          { email: env.adminEmail, password: env.adminPassword },
          jwt,
        )
      },
      inject: [JwtService],
    },
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
```

- [ ] **Step 4: Update AdminAuthGuard to use new verify**

Replace `server/src/admin-auth/admin-auth.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "./admin-auth.service"

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { cookies?: Record<string, string> }
    >()
    const token = request.cookies?.synapse_admin
    if (!token || !this.auth.verify(token)) {
      throw new ForbiddenException("未登录或登录已过期。")
    }
    return true
  }
}
```

- [ ] **Step 5: Update cookie settings in AdminAuthController**

In `server/src/admin-auth/admin-auth.controller.ts`, change the cookie options:

```typescript
response.cookie("synapse_admin", session.token, {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  maxAge: 24 * 60 * 60 * 1000,
})
```

- [ ] **Step 6: Verify login/session flow**

```bash
# Login
curl -s -c cookies.txt -X POST http://localhost:3001/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@d2.com","password":"admin@pwd1234!"}' | jq

# Session check
curl -s -b cookies.txt http://localhost:3001/admin/session | jq
```
Expected: Login returns `{ "email": "admin@d2.com" }`, session returns same

- [ ] **Step 7: Commit**

```bash
git add server/src/admin-auth/ server/src/config/env.ts server/.env.example
git commit -m "feat(server): replace custom JWT with @nestjs/jwt, add token expiration"
```

---

### Task 7: Lease token expiration validation

**Files:**
- Modify: `server/src/licenses/license-token.ts`

- [ ] **Step 1: Add expiration check to verifyLicenseLease**

In `server/src/licenses/license-token.ts`, after signature verification succeeds, add:

```typescript
export function verifyLicenseLease(token: string, publicKeyPem: string): LicenseLeasePayload {
  try {
    const envelope = decode<SignedLeaseEnvelope>(token)
    const encodedPayload = encode(envelope.payload)
    const valid = verify(
      null,
      Buffer.from(encodedPayload),
      createPublicKey(publicKeyPem),
      Buffer.from(envelope.signature, "base64url"),
    )

    if (!valid) {
      throw new Error("授权签名无效。")
    }

    if (envelope.payload.expiresAt && new Date(envelope.payload.expiresAt) < new Date()) {
      throw new Error("授权已过期。")
    }

    return envelope.payload
  } catch (error) {
    if (error instanceof Error && (error.message === "授权签名无效。" || error.message === "授权已过期。")) {
      throw error
    }
    throw new Error("授权签名无效。")
  }
}
```

- [ ] **Step 2: Update error mapping in licenses.controller.ts**

In `server/src/licenses/licenses.controller.ts`, add to the `mapLicenseError` function:

```typescript
if (error instanceof Error && error.message === "授权已过期。") {
  return new ForbiddenException(error.message)
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/licenses/license-token.ts server/src/licenses/licenses.controller.ts
git commit -m "feat(server): add lease token expiration validation"
```

---

### Task 8: Health check endpoint

**Files:**
- Create: `server/src/common/health.controller.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/prisma/prisma.service.ts`

- [ ] **Step 1: Add health indicator to PrismaService**

Add a method to `server/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000))
    await Promise.race([this.$disconnect(), timeout])
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
```

- [ ] **Step 2: Create health controller**

Create `server/src/common/health.controller.ts`:

```typescript
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { PrismaService } from "../prisma/prisma.service"

@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("/health")
  async check() {
    const dbHealthy = await this.prisma.isHealthy()
    if (!dbHealthy) {
      throw new ServiceUnavailableException({
        status: "error",
        database: "down",
      })
    }
    return { status: "ok", database: "up" }
  }
}
```

- [ ] **Step 3: Register HealthController in AppModule**

In `server/src/app.module.ts`, add:

```typescript
import { HealthController } from "./common/health.controller"

@Module({
  // ... imports
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 4: Verify health endpoint**

Run: `curl -s http://localhost:3001/health | jq`
Expected: `{ "status": "ok", "database": "up" }`

- [ ] **Step 5: Commit**

```bash
git add server/src/common/health.controller.ts server/src/prisma/prisma.service.ts server/src/app.module.ts
git commit -m "feat(server): add /health endpoint with database connectivity check"
```

---

## Sub-Project 2: API Completeness

### Task 9: Pagination utility and shared types

**Files:**
- Create: `server/src/common/pagination.ts`

- [ ] **Step 1: Create pagination utility**

Create `server/src/common/pagination.ts`:

```typescript
import { z } from "zod"

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})

export type PaginationQuery = z.infer<typeof paginationSchema>

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export function parsePagination(query: Record<string, unknown>): PaginationQuery {
  return paginationSchema.parse(query)
}

export function toPrismaArgs(pagination: PaginationQuery) {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    orderBy: { [pagination.sortBy]: pagination.sortOrder },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/common/pagination.ts
git commit -m "feat(server): add pagination utility with Zod schema"
```

---

### Task 10: Paginate activation codes endpoint

**Files:**
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/admin/src/lib/api.ts`
- Modify: `server/admin/src/pages/activation-codes-page.tsx`

- [ ] **Step 1: Update AdminService.listActivationCodes**

In `server/src/admin/admin.service.ts`, replace `listActivationCodes`:

```typescript
import { parsePagination, toPrismaArgs, type PaginatedResponse } from "../common/pagination"

async listActivationCodes(options: {
  readonly includeArchived?: boolean
  readonly status?: string
  readonly from?: string
  readonly to?: string
  readonly query?: Record<string, unknown>
}): Promise<PaginatedResponse<unknown>> {
  const pagination = parsePagination(options.query ?? {})
  const where: Record<string, unknown> = {}

  if (!options.includeArchived) {
    where.archivedAt = null
  }
  if (options.status) {
    where.status = options.status
  }
  if (options.from || options.to) {
    where.createdAt = {
      ...(options.from ? { gte: new Date(options.from) } : {}),
      ...(options.to ? { lte: new Date(options.to) } : {}),
    }
  }

  const [data, total] = await this.prisma.$transaction([
    this.prisma.activationCode.findMany({
      where,
      ...toPrismaArgs(pagination),
      select: {
        id: true,
        codeHint: true,
        status: true,
        maxDevices: true,
        expiresAt: true,
        boundAccountId: true,
        boundAccount: { select: { email: true } },
        redeemedAt: true,
        archivedAt: true,
        riskLockedAt: true,
        riskLockedReason: true,
        riskUnlockedAt: true,
        riskReviewNote: true,
        replacedByActivationCodeId: true,
        createdAt: true,
      },
    }),
    this.prisma.activationCode.count({ where }),
  ])

  return { data, total, page: pagination.page, pageSize: pagination.pageSize }
}
```

- [ ] **Step 2: Update AdminController.listActivationCodes**

In `server/src/admin/admin.controller.ts`:

```typescript
@Get("/activation-codes")
listActivationCodes(@Query() query: Record<string, unknown>) {
  return this.admin.listActivationCodes({
    includeArchived: query.includeArchived === "true",
    status: typeof query.status === "string" ? query.status : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
    query,
  })
}
```

- [ ] **Step 3: Update admin frontend API client**

In `server/admin/src/lib/api.ts`, update `listActivationCodes`:

```typescript
listActivationCodes: (options: {
  readonly includeArchived?: boolean
  readonly status?: string
  readonly from?: string
  readonly to?: string
  readonly page?: number
  readonly pageSize?: number
} = {}) => {
  const query = new URLSearchParams()
  if (options.includeArchived) query.set("includeArchived", "true")
  if (options.status) query.set("status", options.status)
  if (options.from) query.set("from", options.from)
  if (options.to) query.set("to", options.to)
  if (options.page) query.set("page", String(options.page))
  if (options.pageSize) query.set("pageSize", String(options.pageSize))
  const suffix = query.size > 0 ? `?${query.toString()}` : ""
  return request<PaginatedResponse<ActivationCode>>(
    `/admin/api/activation-codes${suffix}`,
  )
},
```

Add the `PaginatedResponse` type to `api.ts`:

```typescript
export interface PaginatedResponse<T> {
  readonly data: T[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}
```

- [ ] **Step 4: Update activation-codes-page.tsx to use paginated response**

In the page component, update the data access from `codes` (array) to `codes.data` (paginated). Add pagination controls at the bottom of the table. This is a frontend adaptation — the page should read `.data` from the response and display page/total info.

- [ ] **Step 5: Commit**

```bash
git add server/src/admin/admin.service.ts server/src/admin/admin.controller.ts server/admin/src/lib/api.ts server/admin/src/pages/activation-codes-page.tsx
git commit -m "feat(server): paginate activation codes endpoint with filtering"
```

---

### Task 11: Paginate accounts, devices, and attempts endpoints

**Files:**
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/admin/src/lib/api.ts`
- Modify: `server/admin/src/pages/accounts-page.tsx`
- Modify: `server/admin/src/pages/devices-page.tsx`

- [ ] **Step 1: Update AdminService list methods**

Apply the same pagination pattern from Task 10 to:
- `listAccounts()` — add `email` (contains, case-insensitive) and `status` filters
- `listDevices()` — add `status` and `licenseId` filters
- `listActivationAttempts()` — remove hardcoded `take: 100`, use pagination

Each method should accept a `query` parameter, call `parsePagination()`, use `toPrismaArgs()`, and return `PaginatedResponse<T>`.

For `listAccounts`:
```typescript
async listAccounts(options: {
  readonly email?: string
  readonly status?: string
  readonly query?: Record<string, unknown>
}): Promise<PaginatedResponse<unknown>> {
  const pagination = parsePagination(options.query ?? {})
  const where: Record<string, unknown> = {}
  if (options.email) {
    where.email = { contains: options.email, mode: "insensitive" }
  }
  if (options.status) {
    where.status = options.status
  }

  const [data, total] = await this.prisma.$transaction([
    this.prisma.account.findMany({
      where,
      ...toPrismaArgs(pagination),
      include: { licenses: { include: { devices: true } } },
    }),
    this.prisma.account.count({ where }),
  ])

  return { data, total, page: pagination.page, pageSize: pagination.pageSize }
}
```

For `listDevices`:
```typescript
async listDevices(options: {
  readonly status?: string
  readonly licenseId?: string
  readonly query?: Record<string, unknown>
}): Promise<PaginatedResponse<unknown>> {
  const pagination = parsePagination(options.query ?? {})
  const where: Record<string, unknown> = {}
  if (options.status) where.status = options.status
  if (options.licenseId) where.licenseId = options.licenseId

  const [data, total] = await this.prisma.$transaction([
    this.prisma.device.findMany({
      where,
      ...toPrismaArgs(pagination),
      include: {
        license: {
          include: {
            account: true,
            activationCode: { select: { id: true, codeHint: true } },
          },
        },
      },
    }),
    this.prisma.device.count({ where }),
  ])

  return { data, total, page: pagination.page, pageSize: pagination.pageSize }
}
```

For `listActivationAttempts`:
```typescript
async listActivationAttempts(
  id: string,
  query: Record<string, unknown> = {},
): Promise<PaginatedResponse<unknown>> {
  const pagination = parsePagination(query)
  const where = { activationCodeId: id }

  const [data, total] = await this.prisma.$transaction([
    this.prisma.activationAttempt.findMany({
      where,
      ...toPrismaArgs(pagination),
    }),
    this.prisma.activationAttempt.count({ where }),
  ])

  return { data, total, page: pagination.page, pageSize: pagination.pageSize }
}
```

- [ ] **Step 2: Update AdminController endpoints**

Update each GET endpoint to pass `@Query() query` through to the service.

- [ ] **Step 3: Update admin frontend API client and pages**

Update `adminApi.listAccounts`, `adminApi.listDevices`, `adminApi.listActivationAttempts` to accept pagination/filter params and return `PaginatedResponse<T>`. Update the corresponding page components to use `.data` and show pagination.

- [ ] **Step 4: Commit**

```bash
git add server/src/admin/ server/admin/src/
git commit -m "feat(server): paginate accounts, devices, and attempts endpoints"
```

---

### Task 12: CRUD completion (licenses list, account update)

**Files:**
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/admin/src/lib/api.ts`

- [ ] **Step 1: Add listLicenses and getLicense to AdminService**

In `server/src/admin/admin.service.ts`:

```typescript
async listLicenses(options: {
  readonly status?: string
  readonly accountId?: string
  readonly query?: Record<string, unknown>
}): Promise<PaginatedResponse<unknown>> {
  const pagination = parsePagination(options.query ?? {})
  const where: Record<string, unknown> = {}
  if (options.status) where.status = options.status
  if (options.accountId) where.accountId = options.accountId

  const [data, total] = await this.prisma.$transaction([
    this.prisma.license.findMany({
      where,
      ...toPrismaArgs(pagination),
      include: {
        account: { select: { id: true, email: true } },
        devices: true,
        activationCode: { select: { id: true, codeHint: true } },
      },
    }),
    this.prisma.license.count({ where }),
  ])

  return { data, total, page: pagination.page, pageSize: pagination.pageSize }
}

getLicense(id: string) {
  return this.prisma.license.findUniqueOrThrow({
    where: { id },
    include: {
      account: { select: { id: true, email: true } },
      devices: true,
      leases: { orderBy: { createdAt: "desc" }, take: 20 },
      activationCode: { select: { id: true, codeHint: true } },
    },
  })
}
```

- [ ] **Step 2: Add updateAccountStatus to AdminService**

```typescript
async updateAccountStatus(id: string, body: unknown) {
  const result = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(body)
  if (!result.success) {
    throw new BadRequestException("账号状态无效。")
  }
  return this.prisma.account.update({
    where: { id },
    data: { status: result.data.status },
  })
}
```

- [ ] **Step 3: Add endpoints to AdminController**

In `server/src/admin/admin.controller.ts`:

```typescript
@Get("/licenses")
listLicenses(@Query() query: Record<string, unknown>) {
  return this.admin.listLicenses({
    status: typeof query.status === "string" ? query.status : undefined,
    accountId: typeof query.accountId === "string" ? query.accountId : undefined,
    query,
  })
}

@Get("/licenses/:id")
getLicense(@Param("id") id: string) {
  return this.admin.getLicense(id)
}

@Patch("/accounts/:id/status")
updateAccountStatus(@Param("id") id: string, @Body() body: unknown) {
  return this.admin.updateAccountStatus(id, body)
}
```

- [ ] **Step 4: Update admin frontend API client**

In `server/admin/src/lib/api.ts`:

```typescript
listLicenses: (options: {
  readonly status?: string
  readonly accountId?: string
  readonly page?: number
  readonly pageSize?: number
} = {}) => {
  const query = new URLSearchParams()
  if (options.status) query.set("status", options.status)
  if (options.accountId) query.set("accountId", options.accountId)
  if (options.page) query.set("page", String(options.page))
  if (options.pageSize) query.set("pageSize", String(options.pageSize))
  const suffix = query.size > 0 ? `?${query.toString()}` : ""
  return request<PaginatedResponse<License>>(`/admin/api/licenses${suffix}`)
},
getLicense: (id: string) => request<License>(`/admin/api/licenses/${id}`),
updateAccountStatus: (id: string, status: AccountStatus) =>
  request<Account>(`/admin/api/accounts/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  }),
```

- [ ] **Step 5: Commit**

```bash
git add server/src/admin/ server/admin/src/lib/api.ts
git commit -m "feat(server): add license list/detail endpoints and account status update"
```

---

### Task 13: Audit log table and interceptor

**Files:**
- Create: `server/prisma/migrations/XXXXXX_add_audit_log/migration.sql` (via prisma migrate dev)
- Modify: `server/prisma/schema.prisma`
- Create: `server/src/common/audit-log.interceptor.ts`
- Create: `server/src/common/audit-log.service.ts`
- Modify: `server/src/admin/admin.module.ts`
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Add AuditLog model to schema**

In `server/prisma/schema.prisma`, add before the closing:

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  adminEmail String
  action     String
  targetType String
  targetId   String
  detail     Json?
  ipAddress  String
  createdAt  DateTime @default(now())

  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Run migration**

```bash
cd server && pnpm prisma:dev --name add_audit_log
```

- [ ] **Step 3: Create AuditLogService**

Create `server/src/common/audit-log.service.ts`:

```typescript
import { Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse } from "./pagination"

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    adminEmail: string
    action: string
    targetType: string
    targetId: string
    detail?: unknown
    ipAddress: string
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        adminEmail: input.adminEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail ?? undefined,
        ipAddress: input.ipAddress,
      },
    })
  }

  async list(options: {
    readonly action?: string
    readonly from?: string
    readonly to?: string
    readonly query?: Record<string, unknown>
  }): Promise<PaginatedResponse<unknown>> {
    const pagination = parsePagination(options.query ?? {})
    const where: Record<string, unknown> = {}
    if (options.action) where.action = options.action
    if (options.from || options.to) {
      where.createdAt = {
        ...(options.from ? { gte: new Date(options.from) } : {}),
        ...(options.to ? { lte: new Date(options.to) } : {}),
      }
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, ...toPrismaArgs(pagination) }),
      this.prisma.auditLog.count({ where }),
    ])

    return { data, total, page: pagination.page, pageSize: pagination.pageSize }
  }
}
```

- [ ] **Step 4: Create AuditLogInterceptor**

Create `server/src/common/audit-log.interceptor.ts`:

```typescript
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common"
import type { Request } from "express"
import { Observable, tap } from "rxjs"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { AuditLogService } from "./audit-log.service"

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"])

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLog: AuditLogService,
    private readonly auth: AdminAuthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { cookies?: Record<string, string> }
    >()

    if (!WRITE_METHODS.has(request.method)) {
      return next.handle()
    }

    const path = request.path
    const method = request.method

    return next.handle().pipe(
      tap((responseBody) => {
        const { action, targetType, targetId } = resolveAuditTarget(
          method,
          path,
          request.params,
          responseBody,
        )
        if (!action) return

        const token = request.cookies?.synapse_admin
        const payload = token ? this.auth.verify(token) : null
        const adminEmail = payload?.email ?? "unknown"

        void this.auditLog.record({
          adminEmail,
          action,
          targetType,
          targetId,
          detail: { method, path, body: request.body },
          ipAddress: request.ip ?? "",
        })
      }),
    )
  }
}

function resolveAuditTarget(
  method: string,
  path: string,
  params: Record<string, string>,
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } {
  const id = params.id ?? readId(responseBody)
  const segments = path.replace("/admin/api/", "").split("/")
  const resource = segments[0] ?? "unknown"

  let action = `${resource}.${method.toLowerCase()}`
  if (segments.includes("archive")) action = `${resource}.archive`
  if (segments.includes("risk-lock")) action = `${resource}.risk-lock`
  if (segments.includes("replace")) action = `${resource}.replace`
  if (segments.includes("status")) action = `${resource}.status`
  if (segments.includes("batch")) action = `${resource}.batch`

  return { action, targetType: resource, targetId: id }
}

function readId(body: unknown): string {
  if (body && typeof body === "object" && "id" in body) {
    return String((body as { id: unknown }).id)
  }
  return "unknown"
}
```

- [ ] **Step 5: Register in AdminModule and add audit-logs endpoint**

In `server/src/admin/admin.module.ts`:

```typescript
import { Module } from "@nestjs/common"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogInterceptor } from "../common/audit-log.interceptor"
import { AuditLogService } from "../common/audit-log.service"
import { LicensesModule } from "../licenses/licenses.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

@Module({
  imports: [AdminAuthModule, LicensesModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AuditLogService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
```

Add to `server/src/admin/admin.controller.ts`:

```typescript
import { AuditLogService } from "../common/audit-log.service"

// In constructor:
constructor(
  private readonly admin: AdminService,
  private readonly auditLog: AuditLogService,
) {}

@Get("/audit-logs")
listAuditLogs(@Query() query: Record<string, unknown>) {
  return this.auditLog.list({
    action: typeof query.action === "string" ? query.action : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
    query,
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add server/prisma/ server/src/common/audit-log.service.ts server/src/common/audit-log.interceptor.ts server/src/admin/
git commit -m "feat(server): add audit log table, interceptor, and query endpoint"
```

---

### Task 14: Scheduled cleanup of expired activation attempts

**Files:**
- Modify: `server/src/app.module.ts`
- Create: `server/src/common/cleanup.service.ts`

- [ ] **Step 1: Install @nestjs/schedule**

```bash
cd server && pnpm add @nestjs/schedule
```

- [ ] **Step 2: Register ScheduleModule in AppModule**

In `server/src/app.module.ts`:

```typescript
import { ScheduleModule } from "@nestjs/schedule"

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // ... existing imports
  ],
})
```

- [ ] **Step 3: Create CleanupService**

Create `server/src/common/cleanup.service.ts`:

```typescript
import { Injectable } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { PrismaService } from "../prisma/prisma.service"
import { loadEnv } from "../config/env"

@Injectable()
export class CleanupService {
  private readonly retentionDays: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.retentionDays = loadEnv(process.env).activationAttemptRetentionDays
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAttempts(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000)
    const start = Date.now()

    const result = await this.prisma.activationAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })

    this.logger.info(
      { deleted: result.count, durationMs: Date.now() - start },
      "Cleaned up expired activation attempts",
    )
  }
}
```

- [ ] **Step 4: Register CleanupService in AppModule**

In `server/src/app.module.ts`, add `CleanupService` to providers:

```typescript
import { CleanupService } from "./common/cleanup.service"

@Module({
  // ...
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CleanupService,
  ],
})
```

- [ ] **Step 5: Commit**

```bash
git add server/src/common/cleanup.service.ts server/src/app.module.ts server/package.json
git commit -m "feat(server): add scheduled cleanup for expired activation attempts"
```

---

## Sub-Project 3: Test Suite

### Task 15: Test infrastructure setup

**Files:**
- Create: `server/src/test/setup.ts`
- Create: `server/src/test/test-app.ts`
- Modify: `server/vitest.config.ts`

- [ ] **Step 1: Create test app factory**

Create `server/src/test/test-app.ts`:

```typescript
import { Test } from "@nestjs/testing"
import { type INestApplication } from "@nestjs/common"
import cookieParser from "cookie-parser"
import { AppModule } from "../app.module"
import { PinoLogger } from "nestjs-pino"
import { AllExceptionsFilter } from "../common/all-exceptions.filter"

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.use(cookieParser())
  app.useGlobalFilters(new AllExceptionsFilter(app.get(PinoLogger)))
  await app.init()
  return app
}
```

- [ ] **Step 2: Create test setup file**

Create `server/src/test/setup.ts`:

```typescript
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function resetDatabase(): Promise<void> {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`

  for (const { tablename } of tablenames) {
    if (tablename === "_prisma_migrations") continue
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "public"."${tablename}" CASCADE;`,
    )
  }
}

export { prisma as testPrisma }
```

- [ ] **Step 3: Update vitest.config.ts with coverage**

Replace `server/vitest.config.ts`:

```typescript
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
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/test/**", "src/**/*.spec.ts"],
      thresholds: {
        "src/licenses/licenses.service.ts": { statements: 80 },
        "src/licenses/activation-risk.service.ts": { statements: 80 },
      },
    },
  },
})
```

- [ ] **Step 4: Install coverage dependency**

```bash
cd server && pnpm add -D @vitest/coverage-v8
```

- [ ] **Step 5: Commit**

```bash
git add server/src/test/ server/vitest.config.ts server/package.json
git commit -m "chore(server): add test infrastructure with coverage configuration"
```

---

### Task 16: Integration tests — activation flow

**Files:**
- Create: `server/src/test/activation-flow.spec.ts`

- [ ] **Step 1: Write full activation flow integration test**

Create `server/src/test/activation-flow.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { createTestApp } from "./test-app"
import { resetDatabase, testPrisma } from "./setup"

describe("Activation Flow (integration)", () => {
  let app: INestApplication
  let adminCookie: string

  beforeAll(async () => {
    app = await createTestApp()
    const loginRes = await request(app.getHttpServer())
      .post("/admin/login")
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
      .expect(201)
    adminCookie = loginRes.headers["set-cookie"]?.[0] ?? ""
  })

  afterAll(async () => {
    await app.close()
    await testPrisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  it("should complete full activation lifecycle", async () => {
    // 1. Create activation code
    const createRes = await request(app.getHttpServer())
      .post("/admin/api/activation-codes")
      .set("Cookie", adminCookie)
      .send({ maxDevices: 2, quantity: 1 })
      .expect(201)

    expect(createRes.body).toHaveLength(1)
    const code = createRes.body[0].code
    expect(code).toMatch(/^SYN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

    // 2. Redeem activation code
    const redeemRes = await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .send({
        email: "test@example.com",
        activationCode: code,
        device: {
          deviceId: "device-001",
          name: "Test Device",
          platform: "darwin",
          appVersion: "1.0.0",
        },
      })
      .expect(201)

    expect(redeemRes.body.leaseToken).toBeDefined()
    const leaseToken = redeemRes.body.leaseToken

    // 3. Renew lease
    const renewRes = await request(app.getHttpServer())
      .post("/v1/licenses/renew")
      .send({
        leaseToken,
        device: {
          deviceId: "device-001",
          name: "Test Device",
          platform: "darwin",
          appVersion: "1.0.1",
        },
      })
      .expect(201)

    expect(renewRes.body.leaseToken).toBeDefined()

    // 4. Validate lease
    await request(app.getHttpServer())
      .post("/v1/licenses/validate")
      .send({
        leaseToken: renewRes.body.leaseToken,
        device: {
          deviceId: "device-001",
          name: "Test Device",
          platform: "darwin",
          appVersion: "1.0.1",
        },
      })
      .expect(201)
  })

  it("should reject expired activation code", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/admin/api/activation-codes")
      .set("Cookie", adminCookie)
      .send({
        maxDevices: 1,
        quantity: 1,
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
      })
      .expect(201)

    const code = createRes.body[0].code

    await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .send({
        email: "test@example.com",
        activationCode: code,
        device: {
          deviceId: "device-001",
          name: "Test",
          platform: "darwin",
          appVersion: "1.0.0",
        },
      })
      .expect(400)
  })

  it("should enforce device limit", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/admin/api/activation-codes")
      .set("Cookie", adminCookie)
      .send({ maxDevices: 1, quantity: 1 })
      .expect(201)

    const code = createRes.body[0].code

    // First device succeeds
    await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .send({
        email: "test@example.com",
        activationCode: code,
        device: {
          deviceId: "device-001",
          name: "Device 1",
          platform: "darwin",
          appVersion: "1.0.0",
        },
      })
      .expect(201)

    // Second device fails
    await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .send({
        email: "test@example.com",
        activationCode: code,
        device: {
          deviceId: "device-002",
          name: "Device 2",
          platform: "darwin",
          appVersion: "1.0.0",
        },
      })
      .expect(409)
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `cd server && DATABASE_URL=postgresql://synapse:synapse@localhost:5432/synapse_test pnpm test -- src/test/activation-flow.spec.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add server/src/test/activation-flow.spec.ts
git commit -m "test(server): add activation flow integration tests"
```

---

### Task 17: Controller tests

**Files:**
- Create: `server/src/licenses/licenses.controller.spec.ts`
- Create: `server/src/admin/admin.controller.spec.ts`
- Create: `server/src/admin-auth/admin-auth.controller.spec.ts`

- [ ] **Step 1: Write LicensesController tests**

Create `server/src/licenses/licenses.controller.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { createTestApp } from "../test/test-app"

describe("LicensesController", () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("GET /v1/license/config returns public config", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/license/config")
      .expect(200)

    expect(res.body).toHaveProperty("publicKey")
    expect(res.body).toHaveProperty("keyId")
  })

  it("POST /v1/activations/redeem rejects invalid body", async () => {
    await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .send({ invalid: true })
      .expect(400)
  })

  it("POST /v1/licenses/renew rejects invalid body", async () => {
    await request(app.getHttpServer())
      .post("/v1/licenses/renew")
      .send({})
      .expect(400)
  })
})
```

- [ ] **Step 2: Write AdminController tests**

Create `server/src/admin/admin.controller.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { createTestApp } from "../test/test-app"

describe("AdminController", () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("rejects unauthenticated requests", async () => {
    await request(app.getHttpServer())
      .get("/admin/api/activation-codes")
      .expect(403)
  })

  it("rejects unauthenticated POST", async () => {
    await request(app.getHttpServer())
      .post("/admin/api/activation-codes")
      .send({ maxDevices: 1 })
      .expect(403)
  })
})
```

- [ ] **Step 3: Write AdminAuthController tests**

Create `server/src/admin-auth/admin-auth.controller.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { createTestApp } from "../test/test-app"

describe("AdminAuthController", () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("POST /admin/login rejects invalid credentials", async () => {
    await request(app.getHttpServer())
      .post("/admin/login")
      .send({ email: "wrong@example.com", password: "wrongpassword" })
      .expect(401)
  })

  it("POST /admin/login rejects invalid body", async () => {
    await request(app.getHttpServer())
      .post("/admin/login")
      .send({ email: "not-an-email" })
      .expect(400)
  })

  it("GET /admin/session rejects without cookie", async () => {
    await request(app.getHttpServer())
      .get("/admin/session")
      .expect(403)
  })

  it("POST /admin/logout clears cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/admin/logout")
      .expect(201)

    expect(res.body).toEqual({ ok: true })
  })
})
```

- [ ] **Step 4: Run all controller tests**

Run: `cd server && pnpm test -- src/licenses/licenses.controller.spec.ts src/admin/admin.controller.spec.ts src/admin-auth/admin-auth.controller.spec.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/licenses/licenses.controller.spec.ts server/src/admin/admin.controller.spec.ts server/src/admin-auth/admin-auth.controller.spec.ts
git commit -m "test(server): add controller tests for auth, admin, and licenses"
```

---

### Task 18: Error scenario tests

**Files:**
- Create: `server/src/test/error-scenarios.spec.ts`

- [ ] **Step 1: Write error scenario tests**

Create `server/src/test/error-scenarios.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { createTestApp } from "./test-app"

describe("Error Scenarios", () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("GET /health returns ok", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .expect(200)

    expect(res.body).toEqual({ status: "ok", database: "up" })
  })

  it("returns consistent error format for 404", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/api/accounts/nonexistent-id")
      .set("Cookie", "synapse_admin=invalid")
      .expect(403)

    expect(res.body).toHaveProperty("statusCode")
    expect(res.body).toHaveProperty("message")
    expect(res.body).toHaveProperty("error")
  })

  it("returns 400 for malformed JSON", async () => {
    await request(app.getHttpServer())
      .post("/v1/activations/redeem")
      .set("Content-Type", "application/json")
      .send("not json{")
      .expect(400)
  })

  it("POST /v1/activations/redeem with invalid token returns 400", async () => {
    await request(app.getHttpServer())
      .post("/v1/licenses/renew")
      .send({
        leaseToken: "invalid-token",
        device: {
          deviceId: "d1",
          name: "n",
          platform: "p",
          appVersion: "1",
        },
      })
      .expect(400)
  })
})
```

- [ ] **Step 2: Run error scenario tests**

Run: `cd server && pnpm test -- src/test/error-scenarios.spec.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add server/src/test/error-scenarios.spec.ts
git commit -m "test(server): add error scenario tests for health, auth, and validation"
```

---

## Sub-Project 4: Admin UI Enhancements + Deployment Hardening

### Task 19: Batch operations (backend)

**Files:**
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Add batch methods to AdminService**

In `server/src/admin/admin.service.ts`:

```typescript
async batchUpdateActivationCodes(input: {
  ids: string[]
  action: "archive" | "updateStatus"
  status?: string
}) {
  if (input.ids.length > 50) {
    throw new BadRequestException("批量操作上限 50 条。")
  }

  if (input.action === "archive") {
    await this.prisma.activationCode.updateMany({
      where: { id: { in: input.ids } },
      data: { archivedAt: new Date() },
    })
    return { updated: input.ids.length }
  }

  if (input.action === "updateStatus" && input.status) {
    const result = managedStatusSchema.safeParse(input.status)
    if (!result.success) {
      throw new BadRequestException("激活码状态无效。")
    }
    await this.prisma.activationCode.updateMany({
      where: { id: { in: input.ids } },
      data: { status: result.data },
    })
    return { updated: input.ids.length }
  }

  throw new BadRequestException("批量操作参数无效。")
}

async batchUpdateDevices(input: {
  ids: string[]
  action: "updateStatus"
  status?: string
}) {
  if (input.ids.length > 50) {
    throw new BadRequestException("批量操作上限 50 条。")
  }

  const result = deviceStatusSchema.safeParse(input.status)
  if (!result.success) {
    throw new BadRequestException("设备状态无效。")
  }
  await this.prisma.device.updateMany({
    where: { id: { in: input.ids } },
    data: { status: result.data },
  })
  return { updated: input.ids.length }
}
```

- [ ] **Step 2: Add batch endpoints to AdminController**

In `server/src/admin/admin.controller.ts`:

```typescript
const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  action: z.enum(["archive", "updateStatus"]),
  status: z.string().optional(),
}).strict()

@Post("/activation-codes/batch")
batchUpdateActivationCodes(@Body() body: unknown) {
  const result = batchSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException("批量操作请求无效。")
  }
  return this.admin.batchUpdateActivationCodes(result.data)
}

@Post("/devices/batch")
batchUpdateDevices(@Body() body: unknown) {
  const result = batchSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException("批量操作请求无效。")
  }
  return this.admin.batchUpdateDevices(result.data)
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/admin/admin.service.ts server/src/admin/admin.controller.ts
git commit -m "feat(server): add batch operation endpoints for activation codes and devices"
```

---

### Task 20: CSV export endpoints

**Files:**
- Create: `server/src/common/csv-export.ts`
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Create CSV export utility**

Create `server/src/common/csv-export.ts`:

```typescript
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",")
  const body = rows.map((row) =>
    columns.map((col) => escapeCsvField(String(row[col] ?? ""))).join(","),
  )
  return [header, ...body].join("\n")
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
```

- [ ] **Step 2: Add export endpoints to AdminController**

In `server/src/admin/admin.controller.ts`:

```typescript
import { Res } from "@nestjs/common"
import type { Response } from "express"
import { toCsv } from "../common/csv-export"

@Get("/activation-codes/export")
async exportActivationCodes(
  @Query() query: Record<string, unknown>,
  @Res() response: Response,
) {
  const result = await this.admin.listActivationCodes({
    includeArchived: query.includeArchived === "true",
    status: typeof query.status === "string" ? query.status : undefined,
    query: { ...query, pageSize: "10000" },
  })
  const csv = toCsv(result.data as Record<string, unknown>[], [
    "id", "codeHint", "status", "maxDevices", "expiresAt", "createdAt",
  ])
  response.setHeader("Content-Type", "text/csv; charset=utf-8")
  response.setHeader("Content-Disposition", "attachment; filename=activation-codes.csv")
  response.send(csv)
}

@Get("/audit-logs/export")
async exportAuditLogs(
  @Query() query: Record<string, unknown>,
  @Res() response: Response,
) {
  const result = await this.auditLog.list({
    action: typeof query.action === "string" ? query.action : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
    query: { ...query, pageSize: "10000" },
  })
  const csv = toCsv(result.data as Record<string, unknown>[], [
    "id", "adminEmail", "action", "targetType", "targetId", "ipAddress", "createdAt",
  ])
  response.setHeader("Content-Type", "text/csv; charset=utf-8")
  response.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv")
  response.send(csv)
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/common/csv-export.ts server/src/admin/admin.controller.ts
git commit -m "feat(server): add CSV export endpoints for activation codes and audit logs"
```

---

### Task 21: Admin frontend — batch operations UI

**Files:**
- Modify: `server/admin/src/lib/api.ts`
- Modify: `server/admin/src/pages/activation-codes-page.tsx`
- Modify: `server/admin/src/pages/devices-page.tsx`

- [ ] **Step 1: Add batch API methods**

In `server/admin/src/lib/api.ts`:

```typescript
batchUpdateActivationCodes: (input: {
  ids: string[]
  action: "archive" | "updateStatus"
  status?: string
}) =>
  request<{ updated: number }>("/admin/api/activation-codes/batch", {
    method: "POST",
    body: JSON.stringify(input),
  }),
batchUpdateDevices: (input: {
  ids: string[]
  action: "updateStatus"
  status?: string
}) =>
  request<{ updated: number }>("/admin/api/devices/batch", {
    method: "POST",
    body: JSON.stringify(input),
  }),
```

- [ ] **Step 2: Add checkbox selection to activation-codes-page.tsx**

Add a `selectedIds` state, render checkboxes in the table, and a batch action bar that appears when items are selected. The bar should offer "批量归档" and "批量更新状态" buttons. After batch action, reload the list.

- [ ] **Step 3: Add checkbox selection to devices-page.tsx**

Same pattern: `selectedIds` state, checkboxes, batch action bar with "批量更新状态" button.

- [ ] **Step 4: Commit**

```bash
git add server/admin/src/
git commit -m "feat(admin): add batch operation UI for activation codes and devices"
```

---

### Task 22: Admin frontend — audit log page

**Files:**
- Modify: `server/admin/src/lib/api.ts`
- Create: `server/admin/src/pages/audit-logs-page.tsx`
- Modify: `server/admin/src/App.tsx`
- Modify: `server/admin/src/components/app-sidebar.tsx`

- [ ] **Step 1: Add audit log API methods**

In `server/admin/src/lib/api.ts`:

```typescript
export interface AuditLog {
  readonly id: string
  readonly adminEmail: string
  readonly action: string
  readonly targetType: string
  readonly targetId: string
  readonly detail: unknown
  readonly ipAddress: string
  readonly createdAt: string
}

// Add to adminApi:
listAuditLogs: (options: {
  readonly action?: string
  readonly from?: string
  readonly to?: string
  readonly page?: number
  readonly pageSize?: number
} = {}) => {
  const query = new URLSearchParams()
  if (options.action) query.set("action", options.action)
  if (options.from) query.set("from", options.from)
  if (options.to) query.set("to", options.to)
  if (options.page) query.set("page", String(options.page))
  if (options.pageSize) query.set("pageSize", String(options.pageSize))
  const suffix = query.size > 0 ? `?${query.toString()}` : ""
  return request<PaginatedResponse<AuditLog>>(`/admin/api/audit-logs${suffix}`)
},
exportAuditLogs: (options: {
  readonly action?: string
  readonly from?: string
  readonly to?: string
} = {}) => {
  const query = new URLSearchParams()
  if (options.action) query.set("action", options.action)
  if (options.from) query.set("from", options.from)
  if (options.to) query.set("to", options.to)
  const suffix = query.size > 0 ? `?${query.toString()}` : ""
  window.open(`/admin/api/audit-logs/export${suffix}`, "_blank")
},
```

- [ ] **Step 2: Create audit-logs-page.tsx**

Create `server/admin/src/pages/audit-logs-page.tsx`:

```tsx
import { useState } from "react"
import { adminApi, type AuditLog, type PaginatedResponse } from "@/lib/api"
import { useApiResource } from "@/hooks/use-api-resource"
import { formatDate } from "@/lib/format"
import { PageState } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function AuditLogsPage() {
  const [action, setAction] = useState<string>("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  const { data: result, loading, error } = useApiResource<PaginatedResponse<AuditLog>>(
    () => adminApi.listAuditLogs({ action: action || undefined, from: from || undefined, to: to || undefined, page }),
    [action, from, to, page],
  )

  if (loading) return <PageState>加载中…</PageState>
  if (error) return <PageState>加载失败：{error.message}</PageState>
  if (!result) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部操作</SelectItem>
            <SelectItem value="activation-codes.post">创建激活码</SelectItem>
            <SelectItem value="activation-codes.archive">归档</SelectItem>
            <SelectItem value="devices.status">设备状态</SelectItem>
            <SelectItem value="licenses.status">授权状态</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={() => adminApi.exportAuditLogs({ action, from, to })}>
          导出 CSV
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>操作者</TableHead>
            <TableHead>操作</TableHead>
            <TableHead>目标类型</TableHead>
            <TableHead>目标 ID</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((log) => (
            <TableRow key={log.id}>
              <TableCell>{formatDate(log.createdAt)}</TableCell>
              <TableCell>{log.adminEmail}</TableCell>
              <TableCell>{log.action}</TableCell>
              <TableCell>{log.targetType}</TableCell>
              <TableCell className="font-mono text-xs">{log.targetId}</TableCell>
              <TableCell>{log.ipAddress}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {result.total} 条</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page * 20 >= result.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add route and sidebar entry**

In `server/admin/src/App.tsx`, add `audit-logs` to the Route type and render `<AuditLogsPage />`.

In `server/admin/src/components/app-sidebar.tsx`, add a navigation item:
```typescript
{ title: "审计日志", url: "#/audit-logs", icon: ScrollText }
```

- [ ] **Step 4: Commit**

```bash
git add server/admin/src/
git commit -m "feat(admin): add audit log page with filtering and CSV export"
```

---

### Task 23: Admin frontend — session idle timeout

**Files:**
- Create: `server/admin/src/hooks/use-idle-timeout.ts`
- Modify: `server/admin/src/App.tsx`

- [ ] **Step 1: Create idle timeout hook**

Create `server/admin/src/hooks/use-idle-timeout.ts`:

```typescript
import { useEffect, useRef, useCallback } from "react"

export function useIdleTimeout(onTimeout: () => void, timeoutMs = 30 * 60 * 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(onTimeout, timeoutMs)
  }, [onTimeout, timeoutMs])

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"]
    events.forEach((event) => window.addEventListener(event, reset))
    reset()

    return () => {
      events.forEach((event) => window.removeEventListener(event, reset))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [reset])
}
```

- [ ] **Step 2: Integrate in App.tsx**

In `server/admin/src/App.tsx`, inside the authenticated section:

```typescript
import { useIdleTimeout } from "@/hooks/use-idle-timeout"

// Inside the component, when session is active:
const handleIdleTimeout = useCallback(async () => {
  await adminApi.logout()
  setSession(null)
}, [])

useIdleTimeout(handleIdleTimeout)
```

- [ ] **Step 3: Commit**

```bash
git add server/admin/src/hooks/use-idle-timeout.ts server/admin/src/App.tsx
git commit -m "feat(admin): add 30-minute idle session timeout"
```

---

### Task 24: Docker hardening

**Files:**
- Modify: `server/Dockerfile`
- Create: `server/.dockerignore`
- Modify: `server/compose.yml`

- [ ] **Step 1: Harden Dockerfile**

Replace `server/Dockerfile`:

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
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/admin-dist server/admin-dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["pnpm", "--filter", "@synapse/server", "start"]
```

- [ ] **Step 2: Create .dockerignore**

Create `server/.dockerignore`:

```
node_modules
.git
*.spec.ts
.env
.env.*
coverage
dist
admin-dist
*.md
.DS_Store
```

- [ ] **Step 3: Add resource hints to compose.yml**

In `server/compose.yml`, add comments for resource limits under the server service:

```yaml
  server:
    build:
      context: ..
      dockerfile: server/Dockerfile
    # deploy:
    #   resources:
    #     limits:
    #       memory: 512M
    #       cpus: '0.5'
```

- [ ] **Step 4: Commit**

```bash
git add server/Dockerfile server/.dockerignore server/compose.yml
git commit -m "chore(server): harden Docker image with non-root user and health check"
```

---

### Task 25: Database connection pool configuration

**Files:**
- Modify: `server/src/config/env.ts`
- Modify: `server/src/prisma/prisma.service.ts`
- Modify: `server/.env.example`

- [ ] **Step 1: Add DATABASE_POOL_SIZE to env schema**

In `server/src/config/env.ts`, add to `envSchema`:

```typescript
DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
```

Add to `ServerEnv` interface:

```typescript
readonly databasePoolSize: number
```

Add to `loadEnv` return:

```typescript
databasePoolSize: result.data.DATABASE_POOL_SIZE,
```

- [ ] **Step 2: Use pool size in PrismaService**

Replace `server/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { loadEnv } from "../config/env"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const env = loadEnv(process.env)
    const url = new URL(env.databaseUrl)
    url.searchParams.set("connection_limit", String(env.databasePoolSize))
    super({ datasources: { db: { url: url.toString() } } })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000))
    await Promise.race([this.$disconnect(), timeout])
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
```

- [ ] **Step 3: Update .env.example**

Add to `server/.env.example`:

```
DATABASE_POOL_SIZE=10
```

- [ ] **Step 4: Commit**

```bash
git add server/src/config/env.ts server/src/prisma/prisma.service.ts server/.env.example
git commit -m "feat(server): add configurable database connection pool size"
```

---

### Task 26: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd server && pnpm test
```
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

```bash
cd server && pnpm typecheck
```
Expected: No type errors

- [ ] **Step 3: Start server and verify key endpoints**

```bash
cd server && pnpm dev
```

Verify:
- `GET /health` → `{ "status": "ok", "database": "up" }`
- `GET /v1/license/config` → returns public key
- `POST /admin/login` → sets cookie, returns session
- `GET /admin/api/activation-codes` → returns paginated response
- `GET /admin/api/audit-logs` → returns paginated response
- Security headers present (X-Content-Type-Options, etc.)
- Rate limiting works (6th rapid request returns 429)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix(server): address issues found during final verification"
```
