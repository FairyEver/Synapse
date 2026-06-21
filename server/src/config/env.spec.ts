import { describe, expect, it } from "vitest"
import { isBackupCosConfigured, isContentStoreCosConfigured, isDriveCosConfigured, loadEnv } from "./env"

describe("loadEnv", () => {
  it("parses required production settings", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      APP_PUBLIC_URL: "https://synapse.test",
      SYNAPSE_DRIVE_LOCAL_ROOT: "/app/data/drive",
      SYNAPSE_CONTENT_STORE_LOCAL_ROOT: "/app/data/content-store",
      PORT: "3000",
    })

    expect(env.port).toBe(3000)
    expect(env.databasePoolSize).toBe(10)
    expect(env.adminEmail).toBe("admin@d2.com")
    expect(env.appPublicUrl).toBe("https://synapse.test")
    expect(env.driveLocalRoot).toBe("/app/data/drive")
    expect(env.contentStoreLocalRoot).toBe("/app/data/content-store")
    expect(env.trustProxy).toBe(false)
  })

  it("allows missing public app URL outside production", () => {
    const env = loadEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
    })

    expect(env.appPublicUrl).toBeUndefined()
  })

  it("rejects missing public app URL in production", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
        USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      }),
    ).toThrow("APP_PUBLIC_URL")
  })

  it("rejects public app URL values that point at the API path", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
        USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
        APP_PUBLIC_URL: "https://synapse.test/api/",
        SYNAPSE_DRIVE_LOCAL_ROOT: "/app/data/drive",
        SYNAPSE_CONTENT_STORE_LOCAL_ROOT: "/app/data/content-store",
      }),
    ).toThrow("APP_PUBLIC_URL")
  })

  it("rejects production Drive storage without COS or explicit local root", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
        USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
        APP_PUBLIC_URL: "https://synapse.test",
        SYNAPSE_CONTENT_STORE_LOCAL_ROOT: "/app/data/content-store",
      }),
    ).toThrow("SYNAPSE_DRIVE_LOCAL_ROOT")
  })

  it("allows production Drive storage with complete COS settings", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      APP_PUBLIC_URL: "https://synapse.test",
      DRIVE_COS_SECRET_ID: "drive-secret-id",
      DRIVE_COS_SECRET_KEY: "drive-secret-key",
      DRIVE_COS_BUCKET: "drive-bucket",
      DRIVE_COS_REGION: "ap-beijing",
      SYNAPSE_CONTENT_STORE_LOCAL_ROOT: "/app/data/content-store",
    })

    expect(isDriveCosConfigured(env)).toBe(true)
    expect(env.driveLocalRoot).toBeUndefined()
  })

  it("rejects production Content Store storage without COS or explicit local root", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
        ADMIN_EMAIL: "admin@d2.com",
        ADMIN_PASSWORD: "change-me-now!",
        ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
        USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
        APP_PUBLIC_URL: "https://synapse.test",
        SYNAPSE_DRIVE_LOCAL_ROOT: "/app/data/drive",
      }),
    ).toThrow("SYNAPSE_CONTENT_STORE_LOCAL_ROOT")
  })

  it("allows production Content Store storage with complete COS settings", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@d2.com",
      ADMIN_PASSWORD: "change-me-now!",
      ADMIN_JWT_SECRET: "a-secret-with-enough-length-32chars",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      APP_PUBLIC_URL: "https://synapse.test",
      SYNAPSE_DRIVE_LOCAL_ROOT: "/app/data/drive",
      CONTENT_STORE_COS_SECRET_ID: "content-store-secret-id",
      CONTENT_STORE_COS_SECRET_KEY: "content-store-secret-key",
      CONTENT_STORE_COS_BUCKET: "content-store-bucket",
      CONTENT_STORE_COS_REGION: "ap-beijing",
    })

    expect(isContentStoreCosConfigured(env)).toBe(true)
    expect(env.contentStoreLocalRoot).toBeUndefined()
  })

  it("rejects missing required settings", () => {
    expect(() => loadEnv({})).toThrow("DATABASE_URL")
  })

  it("keeps proxy trust disabled unless explicitly configured", () => {
    const env = loadEnv(baseEnv)

    expect(env.trustProxy).toBe(false)
  })

  it("parses explicit proxy trust settings", () => {
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: "true" }).trustProxy).toBe(true)
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: "1" }).trustProxy).toBe(1)
    expect(loadEnv({ ...baseEnv, TRUST_PROXY: "loopback,uniquelocal" }).trustProxy).toBe("loopback,uniquelocal")
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

  it("loads Drive and Backup COS settings independently", () => {
    const env = loadEnv({
      ...baseEnv,
      DRIVE_COS_SECRET_ID: "drive-secret-id",
      DRIVE_COS_SECRET_KEY: "drive-secret-key",
      DRIVE_COS_BUCKET: "drive-bucket",
      DRIVE_COS_REGION: "ap-beijing",
      BACKUP_COS_SECRET_ID: "backup-secret-id",
      BACKUP_COS_SECRET_KEY: "backup-secret-key",
      BACKUP_COS_BUCKET: "backup-bucket",
      BACKUP_COS_REGION: "ap-guangzhou",
    })

    expect(env.driveCosBucket).toBe("drive-bucket")
    expect(env.backupCosBucket).toBe("backup-bucket")
    expect(isDriveCosConfigured(env)).toBe(true)
    expect(isBackupCosConfigured(env)).toBe(true)
  })

  it("loads Content Store COS settings independently", () => {
    const env = loadEnv({
      ...baseEnv,
      CONTENT_STORE_COS_SECRET_ID: "content-store-secret-id",
      CONTENT_STORE_COS_SECRET_KEY: "content-store-secret-key",
      CONTENT_STORE_COS_BUCKET: "content-store-bucket",
      CONTENT_STORE_COS_REGION: "ap-beijing",
      DRIVE_COS_SECRET_ID: "drive-secret-id",
      DRIVE_COS_SECRET_KEY: "drive-secret-key",
      DRIVE_COS_BUCKET: "drive-bucket",
      DRIVE_COS_REGION: "ap-guangzhou",
    })

    expect(env.contentStoreCosBucket).toBe("content-store-bucket")
    expect(env.driveCosBucket).toBe("drive-bucket")
    expect(isContentStoreCosConfigured(env)).toBe(true)
    expect(isDriveCosConfigured(env)).toBe(true)
  })

  it.each([
    {
      name: "Drive",
      values: {
        DRIVE_COS_SECRET_ID: "drive-secret-id",
        DRIVE_COS_SECRET_KEY: "drive-secret-key",
        DRIVE_COS_BUCKET: "drive-bucket",
      },
      missing: "DRIVE_COS_REGION",
    },
    {
      name: "Content Store",
      values: {
        CONTENT_STORE_COS_SECRET_ID: "content-store-secret-id",
        CONTENT_STORE_COS_SECRET_KEY: "content-store-secret-key",
        CONTENT_STORE_COS_REGION: "ap-beijing",
      },
      missing: "CONTENT_STORE_COS_BUCKET",
    },
    {
      name: "Backup",
      values: {
        BACKUP_COS_SECRET_KEY: "backup-secret-key",
        BACKUP_COS_BUCKET: "backup-bucket",
        BACKUP_COS_REGION: "ap-guangzhou",
      },
      missing: "BACKUP_COS_SECRET_ID",
    },
  ])("rejects partial $name COS settings", ({ values, missing }) => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        ...values,
      }),
    ).toThrow(missing)
  })

  it("treats blank COS settings as missing", () => {
    const env = loadEnv({
      ...baseEnv,
      DRIVE_COS_SECRET_ID: "",
      DRIVE_COS_SECRET_KEY: "  ",
      DRIVE_COS_BUCKET: "",
      DRIVE_COS_REGION: "",
    })

    expect(env.driveCosSecretId).toBeUndefined()
    expect(isDriveCosConfigured(env)).toBe(false)
  })

  it("ignores legacy COS settings", () => {
    const env = loadEnv({
      ...baseEnv,
      COS_SECRET_ID: "legacy-secret-id",
      COS_SECRET_KEY: "legacy-secret-key",
      COS_BUCKET: "legacy-bucket",
      COS_REGION: "ap-shanghai",
    })

    expect(isDriveCosConfigured(env)).toBe(false)
    expect(isBackupCosConfigured(env)).toBe(false)
    expect(isContentStoreCosConfigured(env)).toBe(false)
  })
})

const baseEnv = {
  DATABASE_URL: "postgresql://synapse:secret@localhost:5432/synapse",
  ADMIN_EMAIL: "admin@synapse.com",
  ADMIN_PASSWORD: "admin-password-123",
  ADMIN_JWT_SECRET: "a".repeat(32),
  USER_ACCESS_JWT_SECRET: "b".repeat(32),
  APP_PUBLIC_URL: "http://localhost:3000",
}
