import { describe, expect, it } from "vitest"
import { loadEnv } from "./env"

describe("loadEnv", () => {
  it("parses required production settings", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      PORT: "3000",
    })

    expect(env.port).toBe(3000)
    expect(env.databasePoolSize).toBe(10)
    expect(env.adminEmail).toBe("admin@d2.com")
  })

  it("rejects missing required settings", () => {
    expect(() => loadEnv({})).toThrow("DATABASE_URL")
  })

  it("rejects missing user access jwt secret", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      }),
    ).toThrow("USER_ACCESS_JWT_SECRET")
  })

  it("rejects reused admin jwt secret for user access tokens", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
        USER_ACCESS_JWT_SECRET: "a-secret-with-enough-length-32chars",
      }),
    ).toThrow("USER_ACCESS_JWT_SECRET")
  })
})
