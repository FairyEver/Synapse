import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12),
  ADMIN_JWT_SECRET: z.string().min(32),
  LICENSE_PRIVATE_KEY: z.string().min(1),
  LICENSE_PUBLIC_KEY: z.string().min(1),
  LICENSE_KEY_ID: z.string().min(1),
  LICENSE_LEASE_DAYS: z.coerce.number().int().positive().default(7),
  ACTIVATION_ATTEMPT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  ACTIVATION_RATE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  ACTIVATION_RATE_MAX_FAILURES_PER_IP: z.coerce.number().int().positive().default(20),
  ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL: z.coerce.number().int().positive().default(8),
  ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE: z.coerce.number().int().positive().default(8),
  ACTIVATION_RISK_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE: z.coerce.number().int().positive().default(6),
  ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE: z.coerce.number().int().positive().default(4),
  ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE: z.coerce.number().int().positive().default(4),
  ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE: z.coerce.number().int().positive().default(3),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  PORT: z.coerce.number().int().positive().default(3000),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  BACKUP_ENCRYPT_KEY: z.string().length(64).regex(/^[0-9a-fA-F]+$/).optional(),
})

export interface ServerEnv {
  readonly databaseUrl: string
  readonly adminEmail: string
  readonly adminPassword: string
  readonly adminJwtSecret: string
  readonly licensePrivateKey: string
  readonly licensePublicKey: string
  readonly licenseKeyId: string
  readonly licenseLeaseDays: number
  readonly activationAttemptRetentionDays: number
  readonly activationRateWindowMinutes: number
  readonly activationRateMaxFailuresPerIp: number
  readonly activationRateMaxFailuresPerEmail: number
  readonly activationRateMaxFailuresPerDevice: number
  readonly activationRiskWindowMinutes: number
  readonly activationRiskMaxDistinctIpsPerCode: number
  readonly activationRiskMaxDistinctEmailsPerCode: number
  readonly activationRiskMaxDistinctDevicesPerCode: number
  readonly activationRiskMaxBoundConflictsPerCode: number
  readonly databasePoolSize: number
  readonly port: number
  readonly cosSecretId?: string
  readonly cosSecretKey?: string
  readonly cosBucket?: string
  readonly cosRegion?: string
  readonly backupEncryptKey?: string
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
    licensePrivateKey: normalizePem(result.data.LICENSE_PRIVATE_KEY),
    licensePublicKey: normalizePem(result.data.LICENSE_PUBLIC_KEY),
    licenseKeyId: result.data.LICENSE_KEY_ID,
    licenseLeaseDays: result.data.LICENSE_LEASE_DAYS,
    activationAttemptRetentionDays: result.data.ACTIVATION_ATTEMPT_RETENTION_DAYS,
    activationRateWindowMinutes: result.data.ACTIVATION_RATE_WINDOW_MINUTES,
    activationRateMaxFailuresPerIp: result.data.ACTIVATION_RATE_MAX_FAILURES_PER_IP,
    activationRateMaxFailuresPerEmail: result.data.ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL,
    activationRateMaxFailuresPerDevice: result.data.ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE,
    activationRiskWindowMinutes: result.data.ACTIVATION_RISK_WINDOW_MINUTES,
    activationRiskMaxDistinctIpsPerCode: result.data.ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE,
    activationRiskMaxDistinctEmailsPerCode: result.data.ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE,
    activationRiskMaxDistinctDevicesPerCode: result.data.ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE,
    activationRiskMaxBoundConflictsPerCode: result.data.ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE,
    databasePoolSize: result.data.DATABASE_POOL_SIZE,
    port: result.data.PORT,
    cosSecretId: result.data.COS_SECRET_ID,
    cosSecretKey: result.data.COS_SECRET_KEY,
    cosBucket: result.data.COS_BUCKET,
    cosRegion: result.data.COS_REGION,
    backupEncryptKey: result.data.BACKUP_ENCRYPT_KEY,
  }
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n")
}

export function isBackupConfigured(env: ServerEnv): boolean {
  return !!(env.cosSecretId && env.cosSecretKey && env.cosBucket && env.cosRegion)
}
