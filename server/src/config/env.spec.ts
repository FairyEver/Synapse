import { describe, expect, it } from "vitest"
import { loadEnv } from "./env"

describe("loadEnv", () => {
  it("parses required production settings", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
      LICENSE_KEY_ID: "local-dev-key",
      LICENSE_LEASE_DAYS: "7",
      PORT: "3000",
    })

    expect(env.port).toBe(3000)
    expect(env.databasePoolSize).toBe(10)
    expect(env.licenseLeaseDays).toBe(7)
    expect(env.adminEmail).toBe("admin@d2.com")
    expect(env.licensePrivateKey).toContain("\n")
  })

  it("rejects missing required settings", () => {
    expect(() => loadEnv({})).toThrow("DATABASE_URL")
  })

  it("uses balanced activation risk defaults", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\\nkey\\n-----END PUBLIC KEY-----",
      LICENSE_KEY_ID: "local-dev-key",
    })

    expect(env.activationAttemptRetentionDays).toBe(90)
    expect(env.activationRateWindowMinutes).toBe(15)
    expect(env.activationRateMaxFailuresPerIp).toBe(20)
    expect(env.activationRateMaxFailuresPerEmail).toBe(8)
    expect(env.activationRateMaxFailuresPerDevice).toBe(8)
    expect(env.activationRiskWindowMinutes).toBe(60)
    expect(env.activationRiskMaxDistinctIpsPerCode).toBe(6)
    expect(env.activationRiskMaxDistinctEmailsPerCode).toBe(4)
    expect(env.activationRiskMaxDistinctDevicesPerCode).toBe(4)
    expect(env.activationRiskMaxBoundConflictsPerCode).toBe(3)
  })

  it("parses custom activation risk settings", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\\nkey\\n-----END PUBLIC KEY-----",
      LICENSE_KEY_ID: "local-dev-key",
      ACTIVATION_ATTEMPT_RETENTION_DAYS: "45",
      ACTIVATION_RATE_WINDOW_MINUTES: "10",
      ACTIVATION_RATE_MAX_FAILURES_PER_IP: "12",
      ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL: "5",
      ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE: "6",
      ACTIVATION_RISK_WINDOW_MINUTES: "30",
      ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE: "4",
      ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE: "3",
      ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE: "3",
      ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE: "2",
    })

    expect(env.activationAttemptRetentionDays).toBe(45)
    expect(env.activationRateWindowMinutes).toBe(10)
    expect(env.activationRateMaxFailuresPerIp).toBe(12)
    expect(env.activationRateMaxFailuresPerEmail).toBe(5)
    expect(env.activationRateMaxFailuresPerDevice).toBe(6)
    expect(env.activationRiskWindowMinutes).toBe(30)
    expect(env.activationRiskMaxDistinctIpsPerCode).toBe(4)
    expect(env.activationRiskMaxDistinctEmailsPerCode).toBe(3)
    expect(env.activationRiskMaxDistinctDevicesPerCode).toBe(3)
    expect(env.activationRiskMaxBoundConflictsPerCode).toBe(2)
  })
})
