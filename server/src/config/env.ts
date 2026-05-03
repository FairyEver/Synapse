import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_JWT_SECRET: z.string().min(16),
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
  PORT: z.coerce.number().int().positive().default(3000),
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
  readonly port: number
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
    port: result.data.PORT,
  }
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n")
}
