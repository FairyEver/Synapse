import { MODULE_METADATA } from "@nestjs/common/constants"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { describe, expect, it } from "vitest"
import { AdminModule } from "./admin/admin.module"
import { AppModule } from "./app.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"
import { LiveModule } from "./live/live.module"
import { SkillRepositoryModule } from "./skill-repository/skill-repository.module"

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
  })
})

function providersOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) ?? []
}

function importsOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []
}
