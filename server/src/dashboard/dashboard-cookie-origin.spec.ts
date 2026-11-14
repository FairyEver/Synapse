import "reflect-metadata"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UserAuthService } from "../auth/user-auth.service"
import { DashboardAuthController } from "./dashboard-auth.controller"
describe("console cookie session mutation origins", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("rejects same-site form CSRF from another subdomain", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const auth = { loginWeb: vi.fn(async () => ({ token: "fixture", sessionId: "s", expiresAt: new Date(Date.now() + 60000), user: { id: "u", email: "u@test", handle: "user" } })), logoutWeb: vi.fn(async () => {}) }
    const module = await Test.createTestingModule({ controllers: [DashboardAuthController], providers: [{ provide: UserAuthService, useValue: auth }] }).compile()
    const app = module.createNestApplication(); await app.init()
    try {
      const api = request(app.getHttpServer())
      for (const prefix of ["console", "dashboard"]) {
        await api.post(`/api/${prefix}/logout`).set("Origin", "https://other.synapse.test").set("Cookie", "synapse_user_session=fixture").type("form").send({}).expect(403)
        await api.post(`/api/${prefix}/login`).set("Origin", "https://other.synapse.test").type("form").send({ email: "attacker@test.com", password: "password" }).expect(403)
      }
      expect(auth.logoutWeb).not.toHaveBeenCalled(); expect(auth.loginWeb).not.toHaveBeenCalled()
      await api.post("/api/console/logout").set("Origin", "https://synapse.test").expect(201)
      await api.post("/api/console/login").set("Origin", "https://synapse.test").send({ email: "user@test.com", password: "password" }).expect(201)
      expect(auth.loginWeb).toHaveBeenCalledOnce()
    } finally { await app.close() }
  })
})
