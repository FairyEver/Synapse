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

const optionalEnvString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined
  }

  return value
}, z.string().optional())

const optionalEnvUrl = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined
  }

  return value
}, z.string().url().optional())

const highEntropyBase64UrlSecretSchema = z.string()
  .regex(/^[A-Za-z0-9_-]{43,}$/u, "must contain at least 43 Base64URL characters")
  .refine((value) => new Set(value).size >= 16, "must be a high-entropy random value")
  .refine((value) => !/(.)\1{7}/u.test(value), "must not contain repeated-character runs")

const cosConfigGroups = [
  {
    name: "DRIVE_COS",
    fields: ["DRIVE_COS_SECRET_ID", "DRIVE_COS_SECRET_KEY", "DRIVE_COS_BUCKET", "DRIVE_COS_REGION"],
  },
  {
    name: "SKILL_REPOSITORY_COS",
    fields: [
      "SKILL_REPOSITORY_COS_SECRET_ID",
      "SKILL_REPOSITORY_COS_SECRET_KEY",
      "SKILL_REPOSITORY_COS_BUCKET",
      "SKILL_REPOSITORY_COS_REGION",
    ],
  },
  {
    name: "PLATFORM_MEDIA_COS",
    fields: [
      "PLATFORM_MEDIA_COS_SECRET_ID",
      "PLATFORM_MEDIA_COS_SECRET_KEY",
      "PLATFORM_MEDIA_COS_BUCKET",
      "PLATFORM_MEDIA_COS_REGION",
    ],
  },
  {
    name: "BACKUP_COS",
    fields: ["BACKUP_COS_SECRET_ID", "BACKUP_COS_SECRET_KEY", "BACKUP_COS_BUCKET", "BACKUP_COS_REGION"],
  },
] as const

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_ACCESS_SECRET: highEntropyBase64UrlSecretSchema,
    USER_ACCESS_JWT_SECRET: z.string().min(32),
    DESKTOP_UPDATE_INTENT_SECRET: optionalEnvString,
    USER_ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
    USER_REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
    NODE_ENV: z.string().optional(),
    APP_PUBLIC_URL: z.string().url().optional(),
    DOCUMENT_PUBLIC_URL: optionalEnvUrl,
    TRUST_PROXY: z.string().optional(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    PORT: z.coerce.number().int().positive().default(3000),
    DRIVE_COS_SECRET_ID: optionalEnvString,
    DRIVE_COS_SECRET_KEY: optionalEnvString,
    DRIVE_COS_BUCKET: optionalEnvString,
    DRIVE_COS_REGION: optionalEnvString,
    SYNAPSE_DRIVE_LOCAL_ROOT: optionalEnvString,
    DRIVE_COLLABORATION_ENABLED: z.enum(["true", "false"]).default("false"),
    SKILL_REPOSITORY_COS_SECRET_ID: optionalEnvString,
    SKILL_REPOSITORY_COS_SECRET_KEY: optionalEnvString,
    SKILL_REPOSITORY_COS_BUCKET: optionalEnvString,
    SKILL_REPOSITORY_COS_REGION: optionalEnvString,
    PLATFORM_MEDIA_COS_SECRET_ID: optionalEnvString,
    PLATFORM_MEDIA_COS_SECRET_KEY: optionalEnvString,
    PLATFORM_MEDIA_COS_BUCKET: optionalEnvString,
    PLATFORM_MEDIA_COS_REGION: optionalEnvString,
    BACKUP_COS_SECRET_ID: optionalEnvString,
    BACKUP_COS_SECRET_KEY: optionalEnvString,
    BACKUP_COS_BUCKET: optionalEnvString,
    BACKUP_COS_REGION: optionalEnvString,
  })
  .superRefine((env, ctx) => {
    for (const group of cosConfigGroups) {
      const configuredFields = group.fields.filter((field) => !!env[field])
      if (configuredFields.length === 0 || configuredFields.length === group.fields.length) {
        continue
      }

      const missingFields = group.fields.filter((field) => !env[field])
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missingFields[0]],
        message: `${group.name} configuration is incomplete; missing ${missingFields.join(", ")}`,
      })
    }
  })
  .refine((env) => env.USER_ACCESS_JWT_SECRET !== env.ADMIN_ACCESS_SECRET, {
    path: ["USER_ACCESS_JWT_SECRET"],
    message: "USER_ACCESS_JWT_SECRET must be different from ADMIN_ACCESS_SECRET",
  })
  .refine((env) => env.NODE_ENV !== "production" || !!env.APP_PUBLIC_URL, {
    path: ["APP_PUBLIC_URL"],
    message: "APP_PUBLIC_URL is required in production",
  })
  .refine((env) => env.NODE_ENV !== "production" || !!env.DESKTOP_UPDATE_INTENT_SECRET, {
    path: ["DESKTOP_UPDATE_INTENT_SECRET"],
    message: "DESKTOP_UPDATE_INTENT_SECRET is required in production",
  })
  .refine((env) => {
    if (env.NODE_ENV !== "production" || !env.DESKTOP_UPDATE_INTENT_SECRET) return true
    return env.DESKTOP_UPDATE_INTENT_SECRET !== env.ADMIN_ACCESS_SECRET
      && env.DESKTOP_UPDATE_INTENT_SECRET !== env.USER_ACCESS_JWT_SECRET
  }, {
    path: ["DESKTOP_UPDATE_INTENT_SECRET"],
    message: "DESKTOP_UPDATE_INTENT_SECRET must be different from JWT secrets",
  })
  .refine((env) => env.NODE_ENV !== "production"
    || highEntropyBase64UrlSecretSchema.safeParse(env.DESKTOP_UPDATE_INTENT_SECRET).success, {
    path: ["DESKTOP_UPDATE_INTENT_SECRET"],
    message: "DESKTOP_UPDATE_INTENT_SECRET must be a high-entropy Base64URL value from at least 32 random bytes in production",
  })
  .refine((env) => {
    if (env.NODE_ENV !== "production") return true
    const hasDriveCos = !!(env.DRIVE_COS_SECRET_ID && env.DRIVE_COS_SECRET_KEY && env.DRIVE_COS_BUCKET && env.DRIVE_COS_REGION)
    return hasDriveCos || !!env.SYNAPSE_DRIVE_LOCAL_ROOT
  }, {
    path: ["SYNAPSE_DRIVE_LOCAL_ROOT"],
    message: "SYNAPSE_DRIVE_LOCAL_ROOT is required in production when Drive COS is not configured",
  })
  .refine((env) => {
    if (env.NODE_ENV !== "production") return true
    const hasSkillRepositoryCos = !!(env.SKILL_REPOSITORY_COS_SECRET_ID && env.SKILL_REPOSITORY_COS_SECRET_KEY && env.SKILL_REPOSITORY_COS_BUCKET && env.SKILL_REPOSITORY_COS_REGION)
    return hasSkillRepositoryCos
  }, {
    path: ["SKILL_REPOSITORY_COS_SECRET_ID"],
    message: "SKILL_REPOSITORY_COS_* is required in production",
  })
  .refine((env) => env.NODE_ENV !== "production"
    || !!(env.PLATFORM_MEDIA_COS_SECRET_ID && env.PLATFORM_MEDIA_COS_SECRET_KEY && env.PLATFORM_MEDIA_COS_BUCKET && env.PLATFORM_MEDIA_COS_REGION), {
    path: ["PLATFORM_MEDIA_COS_SECRET_ID"],
    message: "PLATFORM_MEDIA_COS_* is required in production",
  })
  .refine((env) => !env.APP_PUBLIC_URL || new URL(env.APP_PUBLIC_URL).pathname.replace(/\/+$/u, "") !== "/api", {
    path: ["APP_PUBLIC_URL"],
    message: "APP_PUBLIC_URL must be the public app root, not the /api URL",
  })

export interface ServerEnv {
  readonly databaseUrl: string
  readonly adminAccessSecret: string
  readonly userAccessJwtSecret: string
  readonly desktopUpdateIntentSecret?: string
  readonly userAccessTokenMinutes: number
  readonly userRefreshTokenDays: number
  readonly appPublicUrl?: string
  readonly documentPublicUrl?: string
  readonly trustProxy: TrustProxySetting
  readonly databasePoolSize: number
  readonly port: number
  readonly driveCosSecretId?: string
  readonly driveCosSecretKey?: string
  readonly driveCosBucket?: string
  readonly driveCosRegion?: string
  readonly driveLocalRoot?: string
  readonly driveCollaborationEnabled: boolean
  readonly skillRepositoryCosSecretId?: string
  readonly skillRepositoryCosSecretKey?: string
  readonly skillRepositoryCosBucket?: string
  readonly skillRepositoryCosRegion?: string
  readonly platformMediaCosSecretId?: string
  readonly platformMediaCosSecretKey?: string
  readonly platformMediaCosBucket?: string
  readonly platformMediaCosRegion?: string
  readonly backupCosSecretId?: string
  readonly backupCosSecretKey?: string
  readonly backupCosBucket?: string
  readonly backupCosRegion?: string
}

export function loadEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`服务端环境变量无效：${first?.path.join(".")} ${first?.message ?? ""}`.trim())
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    adminAccessSecret: result.data.ADMIN_ACCESS_SECRET,
    userAccessJwtSecret: result.data.USER_ACCESS_JWT_SECRET,
    desktopUpdateIntentSecret: result.data.DESKTOP_UPDATE_INTENT_SECRET,
    userAccessTokenMinutes: result.data.USER_ACCESS_TOKEN_MINUTES,
    userRefreshTokenDays: result.data.USER_REFRESH_TOKEN_DAYS,
    appPublicUrl: result.data.APP_PUBLIC_URL,
    documentPublicUrl: result.data.DOCUMENT_PUBLIC_URL,
    trustProxy: parseTrustProxySetting(result.data.TRUST_PROXY),
    databasePoolSize: result.data.DATABASE_POOL_SIZE,
    port: result.data.PORT,
    driveCosSecretId: result.data.DRIVE_COS_SECRET_ID,
    driveCosSecretKey: result.data.DRIVE_COS_SECRET_KEY,
    driveCosBucket: result.data.DRIVE_COS_BUCKET,
    driveCosRegion: result.data.DRIVE_COS_REGION,
    driveLocalRoot: result.data.SYNAPSE_DRIVE_LOCAL_ROOT,
    driveCollaborationEnabled: result.data.DRIVE_COLLABORATION_ENABLED === "true",
    skillRepositoryCosSecretId: result.data.SKILL_REPOSITORY_COS_SECRET_ID,
    skillRepositoryCosSecretKey: result.data.SKILL_REPOSITORY_COS_SECRET_KEY,
    skillRepositoryCosBucket: result.data.SKILL_REPOSITORY_COS_BUCKET,
    skillRepositoryCosRegion: result.data.SKILL_REPOSITORY_COS_REGION,
    platformMediaCosSecretId: result.data.PLATFORM_MEDIA_COS_SECRET_ID,
    platformMediaCosSecretKey: result.data.PLATFORM_MEDIA_COS_SECRET_KEY,
    platformMediaCosBucket: result.data.PLATFORM_MEDIA_COS_BUCKET,
    platformMediaCosRegion: result.data.PLATFORM_MEDIA_COS_REGION,
    backupCosSecretId: result.data.BACKUP_COS_SECRET_ID,
    backupCosSecretKey: result.data.BACKUP_COS_SECRET_KEY,
    backupCosBucket: result.data.BACKUP_COS_BUCKET,
    backupCosRegion: result.data.BACKUP_COS_REGION,
  }
}

export function isDriveCosConfigured(env: ServerEnv): boolean {
  return !!(env.driveCosSecretId && env.driveCosSecretKey && env.driveCosBucket && env.driveCosRegion)
}

export function isSkillRepositoryCosConfigured(env: ServerEnv): boolean {
  return !!(env.skillRepositoryCosSecretId && env.skillRepositoryCosSecretKey && env.skillRepositoryCosBucket && env.skillRepositoryCosRegion)
}

export function isPlatformMediaCosConfigured(env: ServerEnv): boolean {
  return !!(env.platformMediaCosSecretId && env.platformMediaCosSecretKey && env.platformMediaCosBucket && env.platformMediaCosRegion)
}

export function isBackupCosConfigured(env: ServerEnv): boolean {
  return !!(env.backupCosSecretId && env.backupCosSecretKey && env.backupCosBucket && env.backupCosRegion)
}
