import { z } from "zod"

export type TrustProxySetting = boolean | number | string

function parseTrustProxySetting(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim()
  if (!normalized || normalized === "0") {
    return false
  }

  const lower = normalized.toLowerCase()
  if (lower === "false" || lower === "off" || lower === "no") {
    return false
  }

  if (lower === "true" || lower === "on" || lower === "yes") {
    return true
  }

  if (/^[1-9]\d*$/u.test(normalized)) {
    return Number(normalized)
  }

  return normalized
}

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(12),
    ADMIN_JWT_SECRET: z.string().min(32),
    USER_ACCESS_JWT_SECRET: z.string().min(32),
    USER_ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
    USER_REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
    NODE_ENV: z.string().optional(),
    APP_PUBLIC_URL: z.string().url().optional(),
    TRUST_PROXY: z.string().optional(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    PORT: z.coerce.number().int().positive().default(3000),
    DRIVE_COS_SECRET_ID: z.string().optional(),
    DRIVE_COS_SECRET_KEY: z.string().optional(),
    DRIVE_COS_BUCKET: z.string().optional(),
    DRIVE_COS_REGION: z.string().optional(),
    CONTENT_STORE_COS_SECRET_ID: z.string().optional(),
    CONTENT_STORE_COS_SECRET_KEY: z.string().optional(),
    CONTENT_STORE_COS_BUCKET: z.string().optional(),
    CONTENT_STORE_COS_REGION: z.string().optional(),
    BACKUP_COS_SECRET_ID: z.string().optional(),
    BACKUP_COS_SECRET_KEY: z.string().optional(),
    BACKUP_COS_BUCKET: z.string().optional(),
    BACKUP_COS_REGION: z.string().optional(),
  })
  .refine((env) => env.USER_ACCESS_JWT_SECRET !== env.ADMIN_JWT_SECRET, {
    path: ["USER_ACCESS_JWT_SECRET"],
    message: "USER_ACCESS_JWT_SECRET must be different from ADMIN_JWT_SECRET",
  })
  .refine((env) => env.NODE_ENV !== "production" || !!env.APP_PUBLIC_URL, {
    path: ["APP_PUBLIC_URL"],
    message: "APP_PUBLIC_URL is required in production",
  })
  .refine((env) => !env.APP_PUBLIC_URL || new URL(env.APP_PUBLIC_URL).pathname.replace(/\/+$/u, "") !== "/api", {
    path: ["APP_PUBLIC_URL"],
    message: "APP_PUBLIC_URL must be the public app root, not the /api URL",
  })

export interface ServerEnv {
  readonly databaseUrl: string
  readonly adminEmail: string
  readonly adminPassword: string
  readonly adminJwtSecret: string
  readonly userAccessJwtSecret: string
  readonly userAccessTokenMinutes: number
  readonly userRefreshTokenDays: number
  readonly appPublicUrl?: string
  readonly trustProxy: TrustProxySetting
  readonly databasePoolSize: number
  readonly port: number
  readonly driveCosSecretId?: string
  readonly driveCosSecretKey?: string
  readonly driveCosBucket?: string
  readonly driveCosRegion?: string
  readonly contentStoreCosSecretId?: string
  readonly contentStoreCosSecretKey?: string
  readonly contentStoreCosBucket?: string
  readonly contentStoreCosRegion?: string
  readonly backupCosSecretId?: string
  readonly backupCosSecretKey?: string
  readonly backupCosBucket?: string
  readonly backupCosRegion?: string
}

export function loadEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`服务端环境变量无效：${first?.path.join(".")}`)
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    adminEmail: result.data.ADMIN_EMAIL,
    adminPassword: result.data.ADMIN_PASSWORD,
    adminJwtSecret: result.data.ADMIN_JWT_SECRET,
    userAccessJwtSecret: result.data.USER_ACCESS_JWT_SECRET,
    userAccessTokenMinutes: result.data.USER_ACCESS_TOKEN_MINUTES,
    userRefreshTokenDays: result.data.USER_REFRESH_TOKEN_DAYS,
    appPublicUrl: result.data.APP_PUBLIC_URL,
    trustProxy: parseTrustProxySetting(result.data.TRUST_PROXY),
    databasePoolSize: result.data.DATABASE_POOL_SIZE,
    port: result.data.PORT,
    driveCosSecretId: result.data.DRIVE_COS_SECRET_ID,
    driveCosSecretKey: result.data.DRIVE_COS_SECRET_KEY,
    driveCosBucket: result.data.DRIVE_COS_BUCKET,
    driveCosRegion: result.data.DRIVE_COS_REGION,
    contentStoreCosSecretId: result.data.CONTENT_STORE_COS_SECRET_ID,
    contentStoreCosSecretKey: result.data.CONTENT_STORE_COS_SECRET_KEY,
    contentStoreCosBucket: result.data.CONTENT_STORE_COS_BUCKET,
    contentStoreCosRegion: result.data.CONTENT_STORE_COS_REGION,
    backupCosSecretId: result.data.BACKUP_COS_SECRET_ID,
    backupCosSecretKey: result.data.BACKUP_COS_SECRET_KEY,
    backupCosBucket: result.data.BACKUP_COS_BUCKET,
    backupCosRegion: result.data.BACKUP_COS_REGION,
  }
}

export function isDriveCosConfigured(env: ServerEnv): boolean {
  return !!(env.driveCosSecretId && env.driveCosSecretKey && env.driveCosBucket && env.driveCosRegion)
}

export function isContentStoreCosConfigured(env: ServerEnv): boolean {
  return !!(env.contentStoreCosSecretId && env.contentStoreCosSecretKey && env.contentStoreCosBucket && env.contentStoreCosRegion)
}

export function isBackupCosConfigured(env: ServerEnv): boolean {
  return !!(env.backupCosSecretId && env.backupCosSecretKey && env.backupCosBucket && env.backupCosRegion)
}
