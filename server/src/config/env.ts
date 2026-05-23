import { z } from "zod"

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(12),
    ADMIN_JWT_SECRET: z.string().min(32),
    USER_ACCESS_JWT_SECRET: z.string().min(32),
    USER_ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
    USER_REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
    APP_PUBLIC_URL: z.string().url().optional(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    PORT: z.coerce.number().int().positive().default(3000),
    COS_SECRET_ID: z.string().optional(),
    COS_SECRET_KEY: z.string().optional(),
    COS_BUCKET: z.string().optional(),
    COS_REGION: z.string().optional(),
  })
  .refine((env) => env.USER_ACCESS_JWT_SECRET !== env.ADMIN_JWT_SECRET, {
    path: ["USER_ACCESS_JWT_SECRET"],
    message: "USER_ACCESS_JWT_SECRET must be different from ADMIN_JWT_SECRET",
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
  readonly databasePoolSize: number
  readonly port: number
  readonly cosSecretId?: string
  readonly cosSecretKey?: string
  readonly cosBucket?: string
  readonly cosRegion?: string
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
    databasePoolSize: result.data.DATABASE_POOL_SIZE,
    port: result.data.PORT,
    cosSecretId: result.data.COS_SECRET_ID,
    cosSecretKey: result.data.COS_SECRET_KEY,
    cosBucket: result.data.COS_BUCKET,
    cosRegion: result.data.COS_REGION,
  }
}

export function isBackupConfigured(env: ServerEnv): boolean {
  return !!(env.cosSecretId && env.cosSecretKey && env.cosBucket && env.cosRegion)
}
