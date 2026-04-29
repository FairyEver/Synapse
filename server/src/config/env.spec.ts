import { describe, expect, it } from "vitest"
import { loadEnv } from "./env"

describe("loadEnv", () => {
  it("parses required production settings", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "change-me",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length",
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
      LICENSE_KEY_ID: "local-dev-key",
      LICENSE_LEASE_DAYS: "7",
      PORT: "3000",
    })

    expect(env.port).toBe(3000)
    expect(env.licenseLeaseDays).toBe(7)
    expect(env.adminEmail).toBe("admin@example.com")
    expect(env.licensePrivateKey).toContain("\n")
  })

  it("rejects missing required settings", () => {
    expect(() => loadEnv({})).toThrow("DATABASE_URL")
  })
})
