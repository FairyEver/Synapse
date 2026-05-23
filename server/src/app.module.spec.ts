import { MODULE_METADATA } from "@nestjs/common/constants"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { describe, expect, it } from "vitest"
import { AdminModule } from "./admin/admin.module"
import { AppModule } from "./app.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"

describe("AppModule", () => {
  it("registers audit logging at the application level", () => {
    expect(providersOf(AppModule)).toEqual(expect.arrayContaining([
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ]))
    expect(providersOf(AdminModule)).not.toEqual(expect.arrayContaining([
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ]))
  })
})

function providersOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) ?? []
}
