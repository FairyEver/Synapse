import { MODULE_METADATA } from "@nestjs/common/constants"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { describe, expect, it } from "vitest"
import { AdminModule } from "./admin/admin.module"
import { AppModule } from "./app.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"
import { LiveModule } from "./live/live.module"
import { SkillRepositoryModule } from "./skill-repository/skill-repository.module"
import { UpdateIntentModule } from "./update-intent/update-intent.module"

describe("AppModule", () => {
  it("registers audit logging at the application level", () => {
    expect(providersOf(AppModule)).toEqual(expect.arrayContaining([
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ]))
    expect(providersOf(AdminModule)).not.toEqual(expect.arrayContaining([
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ]))
    expect(importsOf(AppModule)).toEqual(expect.arrayContaining([LiveModule]))
    expect(importsOf(AppModule)).toEqual(expect.arrayContaining([SkillRepositoryModule]))
    expect(importsOf(AppModule)).toEqual(expect.arrayContaining([UpdateIntentModule]))
  })

  it("does not assemble retired team or invitation modules", () => {
    const moduleNames = importsOf(AppModule).map(moduleType => (moduleType as { name?: string }).name)

    expect(moduleNames).not.toContain("TeamsModule")
    expect(moduleNames).not.toContain("InvitationsModule")
  })

  it("compiles the application dependency graph", async () => {
    await withServerEnv(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
      await moduleRef.close()
    })
  })
})

async function withServerEnv(callback: () => Promise<void>): Promise<void> {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_ACCESS_SECRET: process.env.ADMIN_ACCESS_SECRET,
    USER_ACCESS_JWT_SECRET: process.env.USER_ACCESS_JWT_SECRET,
    DESKTOP_UPDATE_INTENT_SECRET: process.env.DESKTOP_UPDATE_INTENT_SECRET,
    PORT: process.env.PORT,
  }
  process.env.DATABASE_URL = "postgresql://synapse:synapse@localhost:5433/synapse"
  process.env.ADMIN_ACCESS_SECRET = "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A"
  process.env.USER_ACCESS_JWT_SECRET = "user-secret-user-secret-user-secret"
  process.env.DESKTOP_UPDATE_INTENT_SECRET = "Rv3kZ8nE1pT6yM4cH9qW2sF7uJ5xB0dG8iL3oA6vN1_r"
  process.env.PORT = "3001"
  try {
    await callback()
  } finally {
    restoreEnv(previous)
  }
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function providersOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) ?? []
}

function importsOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []
}
